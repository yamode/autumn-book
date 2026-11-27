// Autumn Live の画面の「数字の読み替え」（純関数）。描画（engine.ts）とテスト（model.test.ts）から使う。
// 設計: docs/autumn-live.md §7・試作 docs/prototypes/autumn-live/index.html（v13）

export type LiveToday = {
	day: string;
	generatedAt: string;
	src: Partial<Record<'nishiwaga_hp' | 'oga_hp' | 'search' | 'sns' | 'direct', number>>;
	stages: [number, number];
	lanes: { nishiwaga: [number, number, number, number]; oga: [number, number, number, number] };
	by30: number[];
	live: { k: string; s: number; f: 'nishiwaga' | 'oga' | null; src: string }[];
	bookings: { today: number; recent: { k: string; at: string; facility: string; ym: string; nights: number; guests: number; amount: number }[] };
};

export type LiveTotals = {
	generatedAt: string;
	onhand: { months: { ym: string; amount: number; ly: number }[]; pickup7: number; pickup7prev: number };
	members: { total: number; today: number; new7: number; new28: number; new28prev: number; withdrawn7: number };
	usual: { days: number; p25: number[]; p50: number[]; p75: number[] } | null;
	rates28: Record<'s1' | 's2' | 'n3' | 'n4' | 'n5' | 'n6' | 'o3' | 'o4' | 'o5' | 'o6', number> | null;
	cvr7: { visits: number; bookings: number } | null;
};

export const SOURCE_KEYS = ['nishiwaga_hp', 'oga_hp', 'search', 'sns', 'direct'] as const;
/** 率を出すのに要る、前の段の人数（これより少なければ「集計中」） */
export const MIN_FOR_RATE = 50;

/** 30 分ごとの値を、h 時（小数）までの累計にする */
export function cumulativeUntil(by30: number[], hour: number): number {
	let s = 0;
	for (let i = 0; i < 48; i++) {
		const a = i / 2;
		if (a + 0.5 <= hour) s += by30[i] ?? 0;
		else if (a < hour) s += ((by30[i] ?? 0) * (hour - a)) / 0.5;
	}
	return s;
}

/** いつもの 1 日のうち、h 時までに来る割合（p50 から）。いつもが無ければ null */
export function usualFraction(p50: number[] | null | undefined, hour: number): number | null {
	if (!p50) return null;
	const total = p50.reduce((a, b) => a + b, 0);
	if (total <= 0) return null;
	return cumulativeUntil(p50, hour) / total;
}

/** 28 日の率: 前の段がしきい値に満たなければ null */
export function rate28(next: number | undefined, prev: number | undefined): number | null {
	if (!prev || prev < MIN_FOR_RATE || next == null) return null;
	return next / prev;
}

/** 金額を「1.84億円」「4,630万円」「38,400円」の形に */
export function yenShort(v: number): string {
	if (v >= 1e8) return `${(v / 1e8).toFixed(2)}億円`;
	if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString('ja-JP')}万円`;
	return `${Math.round(v).toLocaleString('ja-JP')}円`;
}

/** 前の値との差の割合（％・小数 1 桁）。比べる値が 0 なら null */
export function pctChange(now: number, before: number): number | null {
	if (!before) return null;
	return Math.round(((now / before - 1) * 1000)) / 10;
}

/**
 * 粒（いまいる人）の並びを前回と比べる。
 *   added   … 新しく来た人（段つき）
 *   moved   … 段か施設が変わった人
 *   left    … いなくなった人（前回の段つき。6＝予約まで行っていれば done、それ以外は離れた）
 */
export function diffGrains(prev: Map<string, { s: number; f: string | null }>, next: LiveToday['live']) {
	const added: LiveToday['live'] = [];
	const moved: { k: string; from: number; to: number; f: string | null }[] = [];
	const seen = new Set<string>();
	for (const g of next) {
		seen.add(g.k);
		const p = prev.get(g.k);
		if (!p) added.push(g);
		else if (p.s !== g.s || (g.f && p.f !== g.f)) moved.push({ k: g.k, from: p.s, to: g.s, f: g.f ?? p.f });
	}
	const left: { k: string; s: number }[] = [];
	for (const [k, p] of prev) if (!seen.has(k)) left.push({ k, s: p.s });
	return { added, moved, left };
}
