// 客室内線（ゲスト側）の呼出音・応答音・終話音。音のファイルは使わず Web Audio で作る。
//
// 発信側に音が無いと「呼べているのか」「フロントが出たのか」が分からない（2026-11-01 現場の声）。
// 電話と同じ合図を出す：
//   ・呼出中   … 日本の呼出音（400Hz を 16Hz で揺らす・1 秒鳴って 2 秒休む）
//   ・応答     … 短い「ポーン」（2 音）。Android は少し振動も
//   ・切られた・繋がらない … 話中音「プー・プー・プー」（400Hz・0.5 秒おき 3 回）
//
// iOS Safari は AudioContext をユーザー操作の中で作って resume しないと鳴らない。
// → 「フロントを呼ぶ」の押下（GuestCall.start の最初・await より前）で new する。
// どの操作も失敗しても通話は止めない（音は補助）。
type Ctx = AudioContext;

const RING_FREQ = 400;
const RING_MOD = 16;
const RING_ON = 1.0;
const RING_CYCLE = 3.0;
// 音量（0〜1）。呼出音は 16Hz で揺らすぶん実効が半分になるので大きめ
const RING_VOLUME = 0.45;
const VOLUME = 0.3;

export class CallTones {
	private ctx: Ctx | null = null;
	private ringTimer: ReturnType<typeof setInterval> | null = null;
	private ringNodes: AudioNode[] = [];
	private ringGate: GainNode | null = null;

	constructor() {
		try {
			const AC: typeof AudioContext | undefined =
				typeof window === 'undefined'
					? undefined
					: (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
			if (!AC) return;
			this.ctx = new AC();
			void this.ctx.resume().catch(() => {});
		} catch {
			this.ctx = null;
		}
	}

	/** マイク許可などで止められていたら起こす（iOS はマイク取得のあと suspended / interrupted になることがある） */
	private wake(): Ctx | null {
		const c = this.ctx;
		if (!c || c.state === 'closed') return null;
		if (c.state !== 'running') void c.resume().catch(() => {});
		return c;
	}

	/** 呼出音を鳴らし始める（stopRing まで繰り返す） */
	startRing(): void {
		const c = this.wake();
		if (!c || this.ringTimer) return;
		try {
			const carrier = c.createOscillator();
			carrier.frequency.value = RING_FREQ;
			// 16Hz で振幅を揺らす（0〜1）：am.gain = 0.5 + 0.5·sin
			const am = c.createGain();
			am.gain.value = 0.5;
			const lfo = c.createOscillator();
			lfo.frequency.value = RING_MOD;
			const lfoDepth = c.createGain();
			lfoDepth.gain.value = 0.5;
			lfo.connect(lfoDepth).connect(am.gain);
			// 1 秒鳴って 2 秒休むゲート
			const gate = c.createGain();
			gate.gain.value = 0;
			carrier.connect(am).connect(gate).connect(c.destination);
			carrier.start();
			lfo.start();
			this.ringNodes = [carrier, lfo, am, lfoDepth, gate];
			this.ringGate = gate;
			const burst = () => {
				const g = this.ringGate;
				const cc = this.wake();
				if (!g || !cc) return;
				const t = cc.currentTime + 0.02;
				g.gain.cancelScheduledValues(t);
				g.gain.setValueAtTime(0, t);
				g.gain.linearRampToValueAtTime(RING_VOLUME, t + 0.02);
				g.gain.setValueAtTime(RING_VOLUME, t + RING_ON - 0.02);
				g.gain.linearRampToValueAtTime(0, t + RING_ON);
			};
			burst();
			this.ringTimer = setInterval(burst, RING_CYCLE * 1000);
		} catch {
			this.stopRing();
		}
	}

	stopRing(): void {
		if (this.ringTimer) clearInterval(this.ringTimer);
		this.ringTimer = null;
		for (const n of this.ringNodes) {
			try {
				if (n instanceof OscillatorNode) n.stop();
				n.disconnect();
			} catch {
				/* もう止まっている */
			}
		}
		this.ringNodes = [];
		this.ringGate = null;
	}

	/** 短い音を並べて鳴らす（[周波数, 開始秒, 長さ秒]） */
	private beeps(list: [number, number, number][]): number {
		const c = this.wake();
		if (!c) return 0;
		let end = 0;
		try {
			const t0 = c.currentTime + 0.03;
			for (const [freq, at, len] of list) {
				const o = c.createOscillator();
				o.frequency.value = freq;
				const g = c.createGain();
				const s = t0 + at;
				g.gain.setValueAtTime(0, s);
				g.gain.linearRampToValueAtTime(VOLUME, s + 0.015);
				g.gain.setValueAtTime(VOLUME, s + len - 0.03);
				g.gain.linearRampToValueAtTime(0, s + len);
				o.connect(g).connect(c.destination);
				o.start(s);
				o.stop(s + len + 0.02);
				end = Math.max(end, at + len);
			}
		} catch {
			/* 鳴らせなくても通話は続ける */
		}
		return end;
	}

	/** フロントが応答した */
	answered(): void {
		this.stopRing();
		this.beeps([
			[880, 0, 0.12],
			[1320, 0.14, 0.22]
		]);
		try {
			navigator.vibrate?.(80);
		} catch {
			/* 振動できない端末 */
		}
	}

	/** 通話の終わり。自分で切ったとき以外は話中音を出してから閉じる */
	end(byMe: boolean): void {
		this.stopRing();
		const len = byMe
			? 0
			: this.beeps([
					[RING_FREQ, 0, 0.5],
					[RING_FREQ, 1.0, 0.5],
					[RING_FREQ, 2.0, 0.5]
				]);
		const c = this.ctx;
		this.ctx = null;
		if (!c) return;
		setTimeout(() => void c.close().catch(() => {}), (len + 0.3) * 1000);
	}
}
