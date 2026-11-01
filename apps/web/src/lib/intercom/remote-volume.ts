// 客室内線（ゲスト側）で、フロントの声の大きさを画面のスライダーで変える（0〜200%）。
//
// 相手の声はふだん、通話シートの非 muted の隠し <video> からそのまま鳴らす（iOS で無音にならない実績のある鳴らし方）。
// スライダーを 100% 以外にしたときだけ Web Audio（MediaStreamSource → Gain）経由に切り替える。
//   ・iOS は <video>.volume を変えられない（読み取り専用）ので、音量を変えるには Web Audio が要る
//   ・Gain は 1 を超えられるので、本体の最大音量より大きくできる
//   ・<video> は muted にして残す（Chrome は要素に付けていないリモートの音声を Web Audio に流さない）
// 機種によっては Web Audio 経由で無音になることがある。切り替えてから数秒、
// 「WebRTC の統計では声が届いているのに Web Audio の出力が無音」が続いたら元の鳴らし方に戻し、
// この端末では以後スライダーを声に効かせない（呼出音などにだけ効く）。
//
// AudioContext は iOS ではユーザー操作の中で作らないと動かないので、prime() を「フロントを呼ぶ」の押下で呼ぶ。

const STORE_KEY = 'ab-intercom-volume';
const BROKEN_KEY = 'ab-intercom-volume-broken';
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 2;

/** 保存した音量（0〜2）。読めなければ 1 */
export function loadVolume(): number {
	try {
		const v = Number(localStorage.getItem(STORE_KEY));
		return Number.isFinite(v) && v >= VOLUME_MIN && v <= VOLUME_MAX && localStorage.getItem(STORE_KEY) !== null ? v : 1;
	} catch {
		return 1;
	}
}

function saveVolume(v: number) {
	try {
		localStorage.setItem(STORE_KEY, String(v));
	} catch {
		/* 保存できない（プライベートブラウズ等）。この通話の間だけ効く */
	}
}

function loadBroken(): boolean {
	try {
		return localStorage.getItem(BROKEN_KEY) === '1';
	} catch {
		return false;
	}
}

function saveBroken() {
	try {
		localStorage.setItem(BROKEN_KEY, '1');
	} catch {
		/* 保存できなくても、この通話では元の鳴らし方に戻っている */
	}
}

type Probe = () => Promise<number | null>;

export class RemoteVolume {
	private el: HTMLMediaElement | null = null;
	private stream: MediaStream | null = null;
	private ctx: AudioContext | null = null;
	private src: MediaStreamAudioSourceNode | null = null;
	private gain: GainNode | null = null;
	private analyser: AnalyserNode | null = null;
	private watch: ReturnType<typeof setInterval> | null = null;
	private level = loadVolume();
	/** この端末では Web Audio 経由だと無音になった（声には効かせない） */
	broken = loadBroken();
	/** Web Audio 経由で鳴らしているか */
	private boosted = false;

	constructor(
		private probe: Probe,
		private onBroken: () => void = () => {}
	) {}

	get value(): number {
		return this.level;
	}

	/** 「フロントを呼ぶ」の押下（ユーザー操作の中）で呼ぶ。iOS で AudioContext を動かすため */
	prime(): void {
		if (this.broken || this.ctx) return;
		try {
			const AC: typeof AudioContext | undefined =
				window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AC) return;
			this.ctx = new AC();
			void this.ctx.resume().catch(() => {});
		} catch {
			this.ctx = null;
		}
	}

	/** 相手の声が届いた。まずは <video> からそのまま鳴らし、音量が 100% 以外なら Web Audio に切り替える */
	attach(el: HTMLMediaElement, stream: MediaStream): void {
		this.el = el;
		this.stream = stream;
		el.muted = false;
		el.srcObject = stream;
		void el.play().catch(() => {});
		if (this.level !== 1) this.boost();
	}

	/** スライダーが動いた */
	set(level: number): void {
		this.level = Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, level));
		saveVolume(this.level);
		// スライダー操作はユーザー操作なので、ここで AudioContext を作っても動く
		if (!this.ctx) this.prime();
		if (this.boosted && this.gain && this.ctx) {
			this.gain.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.02);
		} else if (this.level !== 1) {
			this.boost();
		}
	}

	private boost(): void {
		const el = this.el;
		const stream = this.stream;
		const ctx = this.ctx;
		if (this.broken || this.boosted || !el || !stream || !ctx || !stream.getAudioTracks().length) return;
		try {
			void ctx.resume().catch(() => {});
			const src = ctx.createMediaStreamSource(stream);
			const gain = ctx.createGain();
			gain.gain.value = this.level;
			const analyser = ctx.createAnalyser();
			analyser.fftSize = 512;
			src.connect(gain).connect(ctx.destination);
			src.connect(analyser);
			this.src = src;
			this.gain = gain;
			this.analyser = analyser;
			el.muted = true;
			this.boosted = true;
			this.startWatch();
		} catch {
			this.fallBack();
		}
	}

	/**
	 * 切り替えから 6 秒間、0.25 秒ごとに「統計では声が届いている（> 0.01）のに Web Audio の入力が無音」を数える。
	 * 1 秒（4 回連続）続いたら無音と判断して元に戻す。AudioContext が動いていない場合も同じ
	 */
	private startWatch(): void {
		if (this.watch) clearInterval(this.watch);
		const buf = new Float32Array(512);
		let silent = 0;
		let ticks = 0;
		this.watch = setInterval(async () => {
			ticks++;
			const a = this.analyser;
			const ctx = this.ctx;
			if (!a || !ctx || !this.boosted) return this.stopWatch();
			const inbound = await this.probe();
			a.getFloatTimeDomainData(buf);
			let sum = 0;
			for (const x of buf) sum += x * x;
			const rms = Math.sqrt(sum / buf.length);
			const heard = inbound !== null && inbound > 0.01;
			if (heard && (rms < 0.0005 || ctx.state !== 'running')) silent++;
			else if (heard) silent = 0;
			if (silent >= 4) {
				this.fallBack();
				return;
			}
			if (ticks >= 24) this.stopWatch();
		}, 250);
	}

	private stopWatch(): void {
		if (this.watch) clearInterval(this.watch);
		this.watch = null;
	}

	/** 元の鳴らし方（<video> から直接）に戻す。この端末では以後、声には効かせない */
	private fallBack(): void {
		this.stopWatch();
		try {
			this.src?.disconnect();
			this.gain?.disconnect();
		} catch {
			/* もう外れている */
		}
		this.src = null;
		this.gain = null;
		this.analyser = null;
		this.boosted = false;
		if (this.el) {
			this.el.muted = false;
			void this.el.play().catch(() => {});
		}
		this.broken = true;
		saveBroken();
		this.onBroken();
	}

	/** 通話の終わり */
	dispose(): void {
		this.stopWatch();
		try {
			this.src?.disconnect();
			this.gain?.disconnect();
		} catch {
			/* もう外れている */
		}
		this.src = null;
		this.gain = null;
		this.analyser = null;
		this.boosted = false;
		if (this.el) {
			this.el.srcObject = null;
			this.el.muted = false;
		}
		this.el = null;
		this.stream = null;
		const c = this.ctx;
		this.ctx = null;
		void c?.close().catch(() => {});
	}
}
