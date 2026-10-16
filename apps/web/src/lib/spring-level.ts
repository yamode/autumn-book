// 全館の湯量の「表現」（段階ごとの言葉・色）。2026-10-17 指示（0% で「少なめ」はおかしい・表現を管理画面で決めたい）。
// 施設ごとに book.inroom_settings.spring_level_bands で持つ。null なら下の既定。
// 残量 >= min のうち min がいちばん大きい段階を使う。en / zh が空なら ja を出す。

// 段階の色（2026-10-17 指示「残量に応じて色が変わるように。何%以下ならオレンジ、みたいに」）
export const SPRING_TONES = ['blue', 'green', 'yellow', 'orange', 'red', 'gray'] as const;
export type SpringTone = (typeof SPRING_TONES)[number];
export type SpringBand = { min: number; ja: string; en: string; zh: string; tone: SpringTone };

export const SPRING_TONE_LABEL: Record<SpringTone, string> = {
	blue: '青',
	green: '緑',
	yellow: '黄',
	orange: 'オレンジ',
	red: '赤',
	gray: '灰'
};
// バーの色（控えめ・SpringLevelBand と管理画面の見本で使う）
export const SPRING_TONE_BAR: Record<SpringTone, string> = {
	blue: 'bg-sky-400/80',
	green: 'bg-emerald-400/80',
	yellow: 'bg-yellow-400/90',
	orange: 'bg-orange-400/90',
	red: 'bg-red-400/90',
	gray: 'bg-stone-300'
};

export const DEFAULT_SPRING_BANDS: SpringBand[] = [
	{ min: 0, ja: 'お湯がありません', en: 'Currently empty', zh: '目前無溫泉水', tone: 'gray' },
	{ min: 1, ja: '少なめ', en: 'Low', zh: '偏少', tone: 'orange' },
	{ min: 30, ja: 'ふつう', en: 'Normal', zh: '普通', tone: 'green' },
	{ min: 60, ja: 'たっぷり', en: 'Plenty', zh: '充足', tone: 'blue' }
];

const MAX_BANDS = 10;
const MAX_LABEL = 40;

/** DB・フォームから来た値を整える。使えない値なら null（＝既定を使う） */
export function normalizeSpringBands(raw: unknown): SpringBand[] | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const out: SpringBand[] = [];
	for (const r of raw.slice(0, MAX_BANDS)) {
		if (!r || typeof r !== 'object') continue;
		const o = r as Record<string, unknown>;
		const min = Number(o.min);
		const ja = String(o.ja ?? '').trim().slice(0, MAX_LABEL);
		if (!Number.isInteger(min) || min < 0 || min > 100 || !ja) continue;
		const tone = SPRING_TONES.includes(o.tone as SpringTone) ? (o.tone as SpringTone) : 'green';
		out.push({
			min,
			ja,
			en: String(o.en ?? '').trim().slice(0, MAX_LABEL),
			zh: String(o.zh ?? '').trim().slice(0, MAX_LABEL),
			tone
		});
	}
	if (!out.length) return null;
	// 同じ min は後のものを残す・小さい順
	const byMin = new Map(out.map((b) => [b.min, b]));
	return [...byMin.values()].sort((a, b) => a.min - b.min);
}

/** 残量（%）に当たる段階。どれにも当たらない（いちばん小さい min より下）ときはいちばん小さい段階 */
export function springBandFor(percent: number, bands: SpringBand[] | null | undefined): SpringBand {
	const list = bands?.length ? bands : DEFAULT_SPRING_BANDS;
	const sorted = [...list].sort((a, b) => a.min - b.min);
	let hit = sorted[0];
	for (const b of sorted) if (percent >= b.min) hit = b;
	return hit;
}

/** 管理画面に出す各段階の範囲（「1〜29%」「60〜100%」）。並びは小さい順 */
export function springBandRange(bands: SpringBand[], i: number): string {
	const sorted = [...bands].sort((a, b) => a.min - b.min);
	const b = sorted[i];
	const next = sorted[i + 1];
	const max = next ? next.min - 1 : 100;
	return b.min === max ? `${b.min}%` : max < b.min ? '—' : `${b.min}〜${max}%`;
}

/** 表示する言葉（言語に合わせる・空なら日本語） */
export function springBandLabel(band: SpringBand, locale: string): string {
	if (locale === 'en') return band.en || band.ja;
	if (locale === 'zh-TW') return band.zh || band.ja;
	return band.ja;
}
