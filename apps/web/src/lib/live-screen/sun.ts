// Autumn Live の空を、その日の日の出・日の入りに合わせる（冬は早く暮れ、夏は遅くまで明るい）。
// 空の色・星・太陽の位置は「標準の一日」（日の出 6:00・日の入り 17:50 ごろ）で作ってあるので、
// 実際の時刻を標準の一日の時刻へ読み替える（skyClock）。日の出・南中・日の入りがそれぞれ標準の時刻に重なる。
// 計算は NOAA の簡易式（誤差は数分）。場所は西和賀と男鹿のあいだ（秋田・岩手の県境あたり）。

export const SKY_PLACE = { lat: 39.6, lon: 140.3 } as const;
/** 標準の一日での日の出・日の入り（engine.ts の SKY・dayLight・太陽の通り道がこの時刻を前提にしている） */
export const CANON = { rise: 6.0, set: 17.8 } as const;

export type SunTimes = { rise: number; noon: number; set: number };

/** その日（日本時間）の日の出・南中・日の入り（日本時間の時。6.5＝6:30） */
export function sunTimes(date: Date, lat: number = SKY_PLACE.lat, lon: number = SKY_PLACE.lon): SunTimes {
	const j = new Date(date.getTime() + 9 * 3600_000); // 日本時間の暦日
	const y = j.getUTCFullYear();
	const doy = Math.floor((Date.UTC(y, j.getUTCMonth(), j.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400_000) + 1;
	const days = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
	const g = ((2 * Math.PI) / days) * (doy - 1); // 正午の時点で十分
	const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
	const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
	const rad = Math.PI / 180, phi = lat * rad;
	const cosH = Math.cos(90.833 * rad) / (Math.cos(phi) * Math.cos(decl)) - Math.tan(phi) * Math.tan(decl);
	const ha = Math.acos(Math.max(-1, Math.min(1, cosH))) / rad; // 度
	const jstH = (minUtc: number) => (minUtc + 540) / 60;
	return { rise: jstH(720 - 4 * (lon + ha) - eq), noon: jstH(720 - 4 * lon - eq), set: jstH(720 - 4 * (lon - ha) - eq) };
}

/** 実際の時刻 h（0〜24）を、標準の一日の時刻へ読み替える（日の出→6:00・南中→その中間・日の入り→17:48） */
export function skyClock(h: number, s: SunTimes): number {
	const cNoon = (CANON.rise + CANON.set) / 2;
	const pts: [number, number][] = [[0, 0], [s.rise, CANON.rise], [s.noon, cNoon], [s.set, CANON.set], [24, 24]];
	for (let i = 0; i < pts.length - 1; i++) {
		const [a, ca] = pts[i], [b, cb] = pts[i + 1];
		if (h >= a && h <= b) return b === a ? ca : ca + ((h - a) / (b - a)) * (cb - ca);
	}
	return h;
}
