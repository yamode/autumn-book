// 客室内線のゲスト側エンジンの順序（2026-11-01・応答から話せるまでのラグ対策）
//   ・offer は呼出中に（応答より前に）候補入りで DB に置く
//   ・応答（status=active）では呼出音を止めるだけ。応答音と「通話中」は音声が繋がった（connected）とき
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallTones } from './call-tones';
import { GuestCall, type GuestCallState } from './guest-call';

type Sent = { action: string; kind?: string; payload?: Record<string, unknown> };

class FakePc {
	static last: FakePc | null = null;
	iceGatheringState: RTCIceGatheringState = 'new';
	connectionState: RTCPeerConnectionState = 'new';
	signalingState: RTCSignalingState = 'stable';
	localDescription: RTCSessionDescriptionInit | null = null;
	remoteDescription: RTCSessionDescriptionInit | null = null;
	ontrack: ((e: unknown) => void) | null = null;
	onicecandidate: ((e: { candidate: { toJSON: () => unknown } | null }) => void) | null = null;
	onconnectionstatechange: (() => void) | null = null;
	private listeners: (() => void)[] = [];
	constructor() {
		FakePc.last = this;
	}
	addTrack() {}
	addEventListener(_t: string, f: () => void) {
		this.listeners.push(f);
	}
	removeEventListener(_t: string, f: () => void) {
		this.listeners = this.listeners.filter((x) => x !== f);
	}
	async createOffer() {
		return { type: 'offer' as const, sdp: 'v=0\r\na=rtpmap:111 opus/48000/2\r\n' };
	}
	async setLocalDescription(d: RTCSessionDescriptionInit) {
		this.localDescription = { ...d };
		this.signalingState = 'have-local-offer';
		this.iceGatheringState = 'gathering';
		// 候補が 1 つ出て収集完了（SDP に入る）
		setTimeout(() => {
			this.localDescription = { type: 'offer', sdp: d.sdp + 'a=candidate:1 1 udp 1 192.168.0.2 5000 typ host\r\n' };
			this.onicecandidate?.({ candidate: { toJSON: () => ({ candidate: 'candidate:1' }) } });
			this.iceGatheringState = 'complete';
			this.listeners.forEach((f) => f());
		}, 50);
	}
	async setRemoteDescription(d: RTCSessionDescriptionInit) {
		this.remoteDescription = d;
		this.signalingState = 'stable';
	}
	async addIceCandidate() {}
	connect() {
		this.connectionState = 'connected';
		this.onconnectionstatechange?.();
	}
	close() {}
}

describe('GuestCall の先置き offer と合図', () => {
	let sent: Sent[];
	let status: string;
	let answerQueued: boolean;

	beforeEach(() => {
		vi.useFakeTimers();
		sent = [];
		status = 'ringing';
		answerQueued = false;
		FakePc.last = null;
		vi.stubGlobal('navigator', {
			userAgent: 'test',
			mediaDevices: { getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) }
		});
		vi.stubGlobal('RTCPeerConnection', FakePc);
		vi.stubGlobal('MediaStream', class {});
		vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
			const b = JSON.parse(init.body) as Sent;
			sent.push(b);
			let data: unknown = {};
			if (b.action === 'start') data = { callId: '00000000-0000-0000-0000-000000000000', callSecret: 'a'.repeat(64), ringTimeoutSec: 30 };
			if (b.action === 'ice') data = { iceServers: [{ urls: 'stun:x' }] };
			if (b.action === 'fetch') {
				const signals = answerQueued ? [{ id: 10, kind: 'answer', sender: 'staff', payload: { sdp: { type: 'answer', sdp: 'v=0' } } }] : [];
				answerQueued = false;
				data = { status, signals };
			}
			return { ok: true, json: async () => data } as Response;
		});
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('呼出中に候補入りの offer を送り、応答音は connected まで鳴らさない', async () => {
		const answered = vi.spyOn(CallTones.prototype, 'answered');
		const stopRing = vi.spyOn(CallTones.prototype, 'stopRing');
		const states: GuestCallState[] = [];
		const call = new GuestCall({ onState: (s) => states.push(s), onRemoteStream: () => {} });
		await call.start();
		await vi.advanceTimersByTimeAsync(200);

		// まだ ringing のうちに offer が送られている（候補を SDP に含み、収集前の候補は trickle しない）
		const offer = sent.find((s) => s.action === 'send' && s.kind === 'offer');
		expect(call.state).toBe('ringing');
		expect(offer).toBeTruthy();
		expect(JSON.stringify(offer!.payload)).toContain('a=candidate:1');
		expect(sent.some((s) => s.action === 'send' && s.kind === 'ice')).toBe(false);

		// スタッフが応答 → connecting（呼出音を止めるだけ・応答音はまだ）
		status = 'active';
		await vi.advanceTimersByTimeAsync(1_000);
		expect(call.state).toBe('connecting');
		expect(stopRing).toHaveBeenCalled();
		expect(answered).not.toHaveBeenCalled();

		// answer を受けたあと 250ms 間隔で拾う
		answerQueued = true;
		const before = sent.filter((s) => s.action === 'fetch').length;
		await vi.advanceTimersByTimeAsync(600);
		expect(sent.filter((s) => s.action === 'fetch').length - before).toBeGreaterThanOrEqual(2);
		expect(FakePc.last!.remoteDescription).toBeTruthy();
		expect(answered).not.toHaveBeenCalled();

		// 音声が繋がって初めて active と応答音
		FakePc.last!.connect();
		expect(call.state).toBe('active');
		expect(answered).toHaveBeenCalledTimes(1);
		expect(states).toEqual(['starting', 'ringing', 'connecting', 'active']);
		await call.hangup();
	});

	it('応答を検知したら ICE 収集を待たずに offer を送る', async () => {
		// 収集が終わらない PeerConnection
		vi.spyOn(FakePc.prototype, 'setLocalDescription').mockImplementation(async function (this: FakePc, d: RTCSessionDescriptionInit) {
			this.localDescription = d;
			this.signalingState = 'have-local-offer';
			this.iceGatheringState = 'gathering';
		});
		status = 'active'; // 最初の fetch で応答済み
		const call = new GuestCall({ onState: () => {}, onRemoteStream: () => {} });
		await call.start();
		await vi.advanceTimersByTimeAsync(1_100);
		expect(call.state).toBe('connecting');
		expect(sent.some((s) => s.action === 'send' && s.kind === 'offer')).toBe(true);
		await call.hangup();
	});
});
