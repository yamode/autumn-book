// 客室内線のゲスト側通話エンジン（ブラウザ・発信専用・音声のみ）。
// 契約書 autumn_book_intercom_contract.md の §3（状態機械）・§4（store-and-forward）・§9（異常系）に従う。
//
//   1. マイク許可 → /r/api/intercom start（呼を作る。受電アプリが鳴る）
//   2. fetch をポーリングして呼の状態を見る。スタッフが応答（active）したら offer を作って送る
//      （受電側の購読が確立してから offer を流す＝契約 §4.2 の順序規約）
//   3. answer / ice を受けて P2P 接続。ICE は remoteDescription 前に来たら保留キューへ
//   4. 呼出 ring_timeout_sec で timeout（missed）。declined / ended / bye で片付け
//
// シグナルの配送は DB が正（fetch）。Realtime の broadcast は使わず、接続までは 1 秒、
// 通話中は 2 秒間隔のポーリングだけで成立させている（ゲストのブラウザに Supabase クライアントを持たせない）。
//
// taskul-one（app/src/lib/talk/call.ts・HANDOFF v0.15.0）で踏んだ轍への対策:
//   ・broadcast だけのシグナリング → 受端の購読前に offer/ICE が消えて「鳴るのに無音」 → DB 永続（store-and-forward）
//   ・disconnected で即切断 → Wi-Fi の AP 移動で即切れ → 6 秒グレース後、発信側（＝ゲスト）主導で ICE restart（上限 3 回）
//   ・パケットロスで途切れる → Opus の in-band FEC / DTX を SDP で強制
//   ・音声を出す要素が無い／muted で無音 → 通話シート側で非 muted の隠し <video playsinline autoplay> に結線
//   ・STUN だけでは対称 NAT（モバイル回線など）で繋がらない → TURN（Cloudflare Realtime）を /r/api/intercom が発行。未設定なら STUN のみ

export type GuestCallState =
	| 'idle'
	| 'starting' // マイク許可・呼の作成中
	| 'ringing' // 受電アプリを鳴らしている
	| 'connecting' // 応答済み・音声を接続中
	| 'active' // 通話中
	| 'ended';

export type GuestCallEnd =
	| 'hangup' // 自分で切った
	| 'remote' // フロントが切った
	| 'declined'
	| 'missed'
	| 'failed' // 接続できなかった・切れた
	| 'mic' // マイクを使えない
	| 'out_of_hours'
	| 'busy'
	| 'rate_limited'
	| 'disabled'
	| 'offline' // 受電端末が 1 台も動いていない
	| 'error';

const STUN_FALLBACK: RTCIceServer[] = [{ urls: 'stun:stun.cloudflare.com:3478' }];
const CONNECT_TIMEOUT_MS = 20_000; // 応答後、この時間で音声が繋がらなければ終了
const DISCONNECT_GRACE_MS = 6_000; // disconnected をこの時間許容してから ICE restart
const MAX_ICE_RESTARTS = 3;

/** Opus に in-band FEC / DTX を強制する（taskul-one call.ts の tuneOpus と同じ） */
export function tuneOpus(sdp: string | undefined): string | undefined {
	if (!sdp) return sdp;
	const ptMatch = sdp.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
	if (!ptMatch) return sdp;
	const pt = ptMatch[1];
	const fmtpRe = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
	if (fmtpRe.test(sdp)) {
		return sdp.replace(fmtpRe, (_m, params: string) => {
			let p = params;
			if (!/useinbandfec=/.test(p)) p += ';useinbandfec=1';
			if (!/usedtx=/.test(p)) p += ';usedtx=1';
			if (!/minptime=/.test(p)) p += ';minptime=10';
			return `a=fmtp:${pt} ${p}`;
		});
	}
	return sdp.replace(
		new RegExp(`(a=rtpmap:${pt}\\s+opus/48000[^\\r\\n]*\\r?\\n)`, 'i'),
		`$1a=fmtp:${pt} useinbandfec=1;usedtx=1;minptime=10\r\n`
	);
}

type Signal = { id: number; kind: 'offer' | 'answer' | 'ice' | 'bye'; payload: Record<string, unknown>; sender: string };

export type GuestCallEvents = {
	onState: (state: GuestCallState, end?: GuestCallEnd) => void;
	onRemoteStream: (stream: MediaStream) => void;
	/** 回線の一時断から再接続を試みている間 true */
	onReconnecting?: (reconnecting: boolean) => void;
};

async function api(body: Record<string, unknown>): Promise<Record<string, unknown>> {
	const res = await fetch('/r/api/intercom', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	if (!res.ok) throw new Error(String(data.error ?? 'error'));
	return data;
}

export class GuestCall {
	state: GuestCallState = 'idle';
	private ev: GuestCallEvents;
	private callId = '';
	private secret = '';
	private local: MediaStream | null = null;
	private pc: RTCPeerConnection | null = null;
	private lastId = 0;
	private pendingIce: RTCIceCandidateInit[] = [];
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private ringTimer: ReturnType<typeof setTimeout> | null = null;
	private connectTimer: ReturnType<typeof setTimeout> | null = null;
	private wakeLock: { release: () => Promise<void> } | null = null;
	private graceTimer: ReturnType<typeof setTimeout> | null = null;
	private iceRestarts = 0;
	private iceServers: Promise<RTCIceServer[]> | null = null;
	private offered = false;
	private closed = false;

	constructor(ev: GuestCallEvents) {
		this.ev = ev;
	}

	private set(state: GuestCallState, end?: GuestCallEnd) {
		this.state = state;
		this.ev.onState(state, end);
	}

	/** ボタン押下から呼ぶ（getUserMedia はユーザー操作の中で呼ぶ必要がある） */
	async start(): Promise<void> {
		if (this.state !== 'idle') return;
		this.set('starting');
		try {
			this.local = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
		} catch {
			return this.finish('mic');
		}
		void this.lockScreen();
		let r: Record<string, unknown>;
		try {
			r = await api({ action: 'start' });
		} catch (e) {
			const code = e instanceof Error ? e.message : 'error';
			const known: GuestCallEnd[] = ['out_of_hours', 'busy', 'rate_limited', 'disabled', 'offline'];
			return this.finish(known.includes(code as GuestCallEnd) ? (code as GuestCallEnd) : 'error');
		}
		this.callId = String(r.callId);
		this.secret = String(r.callSecret);
		this.set('ringing');
		// 応答を待つ間に TURN クレデンシャルを取っておく（応答後の接続を速くする）
		this.iceServers = api({ action: 'ice', callId: this.callId, callSecret: this.secret })
			.then((r) => ((r.iceServers as RTCIceServer[] | undefined)?.length ? (r.iceServers as RTCIceServer[]) : STUN_FALLBACK))
			.catch(() => STUN_FALLBACK);
		const ringMs = (Number(r.ringTimeoutSec) || 30) * 1000;
		this.ringTimer = setTimeout(() => void this.ringTimeout(), ringMs);
		this.poll();
	}

	/** 自分で切る（呼出中＝取消・通話中＝終話） */
	async hangup(): Promise<void> {
		if (this.closed) return;
		if (this.callId) void api({ action: 'hangup', callId: this.callId, callSecret: this.secret }).catch(() => {});
		this.finish('hangup');
	}

	setMuted(muted: boolean) {
		this.local?.getAudioTracks().forEach((t) => (t.enabled = !muted));
	}

	private async ringTimeout() {
		if (this.state !== 'ringing' || this.closed) return;
		try {
			const r = await api({ action: 'timeout', callId: this.callId, callSecret: this.secret });
			// 時間切れ直前に応答されていたら続行する
			if (r.status === 'active') return this.onActive();
		} catch {
			// timeout が通らなかった（直前に応答された等）。状態を 1 回だけ確かめて、通話中なら続ける
			try {
				const r = await api({ action: 'fetch', callId: this.callId, callSecret: this.secret, after: this.lastId });
				if (r.status === 'active') return this.onActive();
			} catch {
				/* 取れなければ missed 扱いで閉じる */
			}
		}
		this.finish('missed');
	}

	private poll() {
		if (this.closed) return;
		const delay = this.state === 'active' ? 2000 : 1000;
		this.pollTimer = setTimeout(async () => {
			try {
				const r = await api({ action: 'fetch', callId: this.callId, callSecret: this.secret, after: this.lastId });
				await this.onFetch(String(r.status ?? ''), (r.signals as Signal[]) ?? []);
			} catch {
				/* 一時的な失敗は次のポーリングで取り戻す（正は DB） */
			}
			this.poll();
		}, delay);
	}

	private async onFetch(status: string, signals: Signal[]) {
		if (this.closed) return;
		if (status === 'declined') return this.finish('declined');
		if (status === 'missed') return this.finish('missed');
		if (status === 'ended' || status === 'canceled') return this.finish('remote');
		if (status === 'active' && !this.offered) await this.onActive();
		for (const s of signals) {
			if (s.id <= this.lastId) continue;
			this.lastId = s.id;
			await this.onSignal(s);
			if (this.closed) return;
		}
	}

	private async onActive() {
		if (this.offered || this.closed) return;
		this.offered = true;
		if (this.ringTimer) clearTimeout(this.ringTimer);
		this.set('connecting');
		const servers = (await this.iceServers) ?? STUN_FALLBACK;
		if (this.closed) return;
		const pc = new RTCPeerConnection({ iceServers: servers, iceCandidatePoolSize: 1 });
		this.pc = pc;
		this.local?.getTracks().forEach((t) => pc.addTrack(t, this.local!));
		pc.ontrack = (e) => this.ev.onRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
		pc.onicecandidate = (e) => {
			if (e.candidate) void this.send('ice', { candidate: e.candidate.toJSON() });
		};
		pc.onconnectionstatechange = () => {
			const st = pc.connectionState;
			if (st === 'connected') {
				if (this.connectTimer) clearTimeout(this.connectTimer);
				this.clearGrace();
				this.iceRestarts = 0;
				this.ev.onReconnecting?.(false);
				if (this.state !== 'active') this.set('active');
			} else if (st === 'disconnected') {
				this.startGrace();
			} else if (st === 'failed') {
				if (this.state === 'active') void this.restartIce();
				else void this.fail();
			}
		};
		this.connectTimer = setTimeout(() => {
			if (this.state !== 'active') void this.fail();
		}, CONNECT_TIMEOUT_MS);
		await this.makeOffer(false);
	}

	private async makeOffer(iceRestart: boolean) {
		const pc = this.pc;
		if (!pc) return;
		try {
			const offer = await pc.createOffer(iceRestart ? { iceRestart: true } : { offerToReceiveAudio: true });
			offer.sdp = tuneOpus(offer.sdp);
			await pc.setLocalDescription(offer);
			await this.send('offer', { sdp: { type: offer.type, sdp: offer.sdp } });
		} catch {
			if (!iceRestart) void this.fail();
		}
	}

	// 一時的な経路断は即切らない。グレース後も戻らなければ ICE restart（発信側＝ゲストが主導・glare 回避）
	private startGrace() {
		if (this.graceTimer || this.state !== 'active') return;
		this.ev.onReconnecting?.(true);
		this.graceTimer = setTimeout(() => {
			this.graceTimer = null;
			const st = this.pc?.connectionState;
			if (st === 'disconnected' || st === 'failed') void this.restartIce();
		}, DISCONNECT_GRACE_MS);
	}

	private clearGrace() {
		if (this.graceTimer) clearTimeout(this.graceTimer);
		this.graceTimer = null;
	}

	private async restartIce() {
		this.clearGrace();
		if (!this.pc || this.closed) return;
		if (this.iceRestarts >= MAX_ICE_RESTARTS) return this.fail();
		this.iceRestarts++;
		this.ev.onReconnecting?.(true);
		await this.makeOffer(true);
		// 次のグレースで戻らなければもう一度
		this.graceTimer = setTimeout(() => {
			this.graceTimer = null;
			if (this.pc?.connectionState !== 'connected') void this.restartIce();
		}, DISCONNECT_GRACE_MS * 2);
	}

	private async onSignal(s: Signal) {
		const pc = this.pc;
		if (s.kind === 'bye') return this.finish('remote');
		if (!pc) return;
		if (s.kind === 'answer') {
			const sdp = (s.payload.sdp ?? s.payload) as RTCSessionDescriptionInit | undefined;
			// have-local-offer のときだけ受ける（初回・ICE restart 後の再 answer。重複した answer は捨てる）
			if (!sdp?.sdp || pc.signalingState !== 'have-local-offer') return;
			await pc.setRemoteDescription(sdp).catch(() => {});
			for (const c of this.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => {});
		} else if (s.kind === 'ice') {
			const c = s.payload.candidate as RTCIceCandidateInit | undefined;
			if (!c) return;
			if (pc.remoteDescription) await pc.addIceCandidate(c).catch(() => {});
			else this.pendingIce.push(c);
		}
	}

	private async send(kind: 'offer' | 'ice' | 'bye', payload: Record<string, unknown>) {
		try {
			await api({ action: 'send', callId: this.callId, callSecret: this.secret, kind, payload });
		} catch {
			/* 呼が閉じた等。状態は fetch で拾う */
		}
	}

	private async fail() {
		if (this.closed) return;
		void api({ action: 'hangup', callId: this.callId, callSecret: this.secret }).catch(() => {});
		this.finish('failed');
	}

	private async lockScreen() {
		try {
			const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
			this.wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
		} catch {
			this.wakeLock = null;
		}
	}

	private finish(end: GuestCallEnd) {
		if (this.closed) return;
		this.closed = true;
		for (const t of [this.pollTimer, this.ringTimer, this.connectTimer, this.graceTimer]) if (t) clearTimeout(t);
		this.pc?.close();
		this.pc = null;
		this.local?.getTracks().forEach((t) => t.stop());
		this.local = null;
		void this.wakeLock?.release().catch(() => {});
		this.wakeLock = null;
		this.set('ended', end);
	}
}
