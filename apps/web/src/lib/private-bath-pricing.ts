// 貸切風呂の料金設定（施設ごと）。純関数だけ（DB を見ない）。
//
// ■ 保存先（SoT は PMS の施設設定）
//   pms.facility_billing_settings.metadata.private_bath.public の
//     price（円・税込・0＝無料）/ freeChannels（無料にする経路の channel_code）/
//     freeFmCodes（FileMaker 由来の予約の2桁経路コード）
//   判定の正は autumn-pms の $lib/private-bath-pricing（isFreeBathChannel）。
//   Book はこの画面で値を書くだけで、金額の判定は DB（book._pb_price）と PMS が行う。
//
// ■ freeFmCodes を経路の選択から作る理由
//   FileMaker から移した予約は channel_code が空で、経路は2桁コードにしか無い。
//   「直販を無料」と選んだのに FM 由来の直販予約だけ有料、を起こさないよう、
//   選んだ経路に対応する2桁コードを一緒に保存する（一覧に無いコードはそのまま残す）。

export type BathChannelOption = {
	/** core.stays.channel_code（'direct' は 'direct-<会社>-<営業所>' も含む）。 */
	code: string;
	name: string;
	/** FileMaker の2桁経路コード。 */
	fm?: string;
	/** 公式サイト系（自社経路）か。画面で上にまとめる。 */
	own?: boolean;
};

/** 画面に出す経路の一覧。PMS の $lib/channels（CHANNELS）の主なものと同じコード。 */
export const BATH_CHANNEL_OPTIONS: BathChannelOption[] = [
	{ code: 'direct', name: '直販', fm: '00', own: true },
	{ code: 'phone', name: '電話', own: true },
	{ code: 'tripla', name: '公式サイト（tripla）', fm: '52', own: true },
	{ code: 'autumn_booking', name: '自社ポータル（Book）', own: true },
	{ code: 'rms_partner', name: '取引先（RMS）', own: true },
	{ code: 'ikkyu', name: '一休.com', fm: '80' },
	{ code: 'rakuten', name: '楽天トラベル', fm: '61' },
	{ code: 'jalan', name: 'じゃらん', fm: '66' },
	{ code: 'rurubu', name: 'るるぶトラベル', fm: '51' },
	{ code: 'relux', name: 'Relux', fm: '50' },
	{ code: 'jtb', name: 'JTB', fm: '03' },
	{ code: 'jalpak', name: 'ジャルパック', fm: '76' },
	{ code: 'ana', name: 'ANAセールス', fm: '45' },
	{ code: 'booking', name: 'Booking.com', fm: '30' },
	{ code: 'expedia', name: 'Expedia', fm: '47' },
	{ code: 'agoda', name: 'Agoda', fm: '46' },
	{ code: 'yukoyuko', name: 'ゆこゆこ', fm: '73' },
	{ code: 'staff', name: '従業員', fm: '10' }
];

/** PMS の既定（2026-08-31 決定）。設定が未保存の施設はこれで動いている。 */
export const DEFAULT_FREE_CHANNELS = ['direct', 'phone', 'tripla', 'autumn_booking'];
export const DEFAULT_FREE_FM_CODES = ['00', '52'];

/** 料金の上限（円）。PMS の BATH_PUBLIC_MAX_PRICE と同じ。桁違いを弾く。 */
export const BATH_MAX_PRICE = 1_000_000;

export type BathPricing = {
	/** 1枠の利用料（円・税込）。0＝無料の施設。 */
	price: number;
	freeChannels: string[];
	freeFmCodes: string[];
};

const codeList = (v: unknown, fallback: string[]): string[] => {
	if (!Array.isArray(v)) return [...fallback];
	return [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 50);
};

/** 保存値（metadata.private_bath.public）を読める形に。未設定は PMS の既定と同じ。 */
export function normalizeBathPricing(v: unknown): BathPricing {
	const o = (v ?? {}) as Record<string, unknown>;
	const n = Number(o.price);
	const price = Number.isFinite(n) ? Math.min(BATH_MAX_PRICE, Math.max(0, Math.trunc(n))) : 0;
	return {
		price,
		freeChannels: codeList(o.freeChannels, DEFAULT_FREE_CHANNELS),
		freeFmCodes: codeList(o.freeFmCodes, DEFAULT_FREE_FM_CODES).map((c) => c.padStart(2, '0'))
	};
}

/**
 * 画面で選んだ経路から、保存する freeChannels / freeFmCodes を作る。
 * 一覧に無いコード（以前に直接書いた値など）は消さずに残す。
 */
export function buildBathPricing(
	price: number,
	chosen: readonly string[],
	prev: BathPricing
): BathPricing {
	const known = new Set(BATH_CHANNEL_OPTIONS.map((c) => c.code));
	const knownFm = new Set(BATH_CHANNEL_OPTIONS.map((c) => c.fm).filter(Boolean) as string[]);
	const picked = new Set(chosen.filter((c) => known.has(c)));
	const freeChannels = [
		...BATH_CHANNEL_OPTIONS.filter((c) => picked.has(c.code)).map((c) => c.code),
		...prev.freeChannels.filter((c) => !known.has(c))
	];
	const freeFmCodes = [
		...new Set([
			...BATH_CHANNEL_OPTIONS.filter((c) => picked.has(c.code) && c.fm).map((c) => c.fm as string),
			...prev.freeFmCodes.filter((c) => !knownFm.has(c))
		])
	];
	return {
		price: Math.min(BATH_MAX_PRICE, Math.max(0, Math.trunc(price))),
		freeChannels,
		freeFmCodes
	};
}

/** フォームの金額欄を読む（「2,200」「¥2200」も可）。読めなければ null。 */
export function parseBathPrice(v: unknown): number | null {
	const s = String(v ?? '').replace(/[,\s¥円￥]/g, '');
	if (!/^\d{1,7}$/.test(s)) return null;
	const n = Number(s);
	return n <= BATH_MAX_PRICE ? n : null;
}

/** 一覧の名前（知らないコードはコードのまま）。 */
export function bathChannelName(code: string): string {
	return BATH_CHANNEL_OPTIONS.find((c) => c.code === code)?.name ?? code;
}
