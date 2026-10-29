// 検索バー（共通コンポーネント $lib/components/stay-search/*）まわりの純関数。
// 取引先ページ（/p/[token]）と HP 配布の <yamado-search-bar>（static/embed/search-bar.js）の両方で使う。
// DOM・SvelteKit（$app/*）・paraglide に依存しない（embed のビルドに同梱するため）。
// 遷移先 URL の仕様は docs/hp-book-integration.md §3.8（E2・契約書 v1.1）。
import { PARTNER_ACCENTS, type PartnerAccent } from '$lib/partner-theme';

export type StaySearchLang = 'ja' | 'en' | 'zh-TW';

export const DEFAULT_ORIGIN = 'https://book.yamado.app';

/** HP の施設 slug（Book の URL /yamado/<slug>/plans）と差し色。nishiwaga は取引先ページの yamado と同じ色 */
export const EMBED_FACILITIES: Record<string, PartnerAccent> = {
	nishiwaga: PARTNER_ACCENTS.yamado,
	oga: PARTNER_ACCENTS.oga
};

/** Book 側（plans/+page.server.ts・/api/stay-calendar）の範囲と既定値 */
export const LIMITS = {
	nights: { min: 1, max: 7, def: 1 },
	adults: { min: 1, max: 6, def: 2 },
	rooms: { min: 1, max: 4, def: 1 }
} as const;

/** 月送りの上限（今月＋11か月。StayDatePanel と同じ） */
export const MONTHS_AHEAD = 11;

const pad = (n: number) => String(n).padStart(2, '0');

/** 言語の表記ゆれを Book の言語に直す（分からなければ空文字） */
export function normalizeLang(value: unknown): StaySearchLang | '' {
	const s = String(value ?? '').trim().toLowerCase();
	if (!s) return '';
	if (s.startsWith('zh')) return 'zh-TW'; // HP の中国語は繁体字（簡体字ページは無い）
	if (s.startsWith('en')) return 'en';
	if (s.startsWith('ko')) return 'en'; // Book に韓国語が無いあいだは英語（設計書 §3.1）
	if (s.startsWith('ja')) return 'ja';
	return '';
}

/** 要素の lang 属性 → <html lang> → ja の順で決める */
export function resolveLang(attr: unknown, htmlLang: unknown): StaySearchLang {
	return normalizeLang(attr) || normalizeLang(htmlLang) || 'ja';
}

/** HP の施設 slug（nishiwaga | oga）。それ以外は空文字 */
export function normalizeFacility(value: unknown): string {
	const s = String(value ?? '').trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(EMBED_FACILITIES, s) ? s : '';
}

/** 整数にして範囲に丸める（数字でなければ fallback） */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === 'number' ? Math.trunc(value) : Number.parseInt(String(value ?? ''), 10);
	if (!Number.isFinite(n)) return fallback;
	return Math.min(max, Math.max(min, n));
}

/** 泊数・人数・室数を Book の範囲に丸める */
export function clampSearch(values: { nights?: unknown; adults?: unknown; rooms?: unknown } = {}) {
	return {
		nights: clampInt(values.nights, LIMITS.nights.min, LIMITS.nights.max, LIMITS.nights.def),
		adults: clampInt(values.adults, LIMITS.adults.min, LIMITS.adults.max, LIMITS.adults.def),
		rooms: clampInt(values.rooms, LIMITS.rooms.min, LIMITS.rooms.max, LIMITS.rooms.def)
	};
}

/** 実在する YYYY-MM-DD か */
export function isIsoDate(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const t = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === value;
}

/** スクリプトの src のオリジン（取れなければ本番） */
export function apiOrigin(src: unknown): string {
	try {
		const u = new URL(String(src));
		if (u.protocol === 'https:' || u.protocol === 'http:') return u.origin;
	} catch {
		// 取れなければ本番
	}
	return DEFAULT_ORIGIN;
}

const langPrefix = (lang: StaySearchLang) => (lang === 'en' ? '/en' : lang === 'zh-TW' ? '/zh-TW' : '');

export type SearchUrlOptions = {
	facility: unknown;
	lang?: unknown;
	checkin?: unknown;
	nights?: unknown;
	adults?: unknown;
	rooms?: unknown;
	utmSource?: string;
	utmContent?: string;
};

/**
 * 検索の遷移先（Book のプラン一覧 E2・契約書 v1.1）。
 * checkin は未選択（または不正）なら付けない。rooms は 1 のとき付けない。施設が不正なら空文字。
 */
export function buildSearchUrl(origin: string, o: SearchUrlOptions): string {
	const facility = normalizeFacility(o.facility);
	if (!facility) return '';
	const lang = normalizeLang(o.lang) || 'ja';
	const v = clampSearch(o);
	const q: [string, string | number][] = [];
	if (isIsoDate(o.checkin)) q.push(['checkin', o.checkin]);
	q.push(['nights', v.nights], ['adults', v.adults]);
	if (v.rooms > 1) q.push(['rooms', v.rooms]);
	q.push(
		['utm_source', o.utmSource || `hp_${facility}`],
		['utm_medium', 'referral'],
		['utm_campaign', 'reserve'],
		['utm_content', o.utmContent || 'search_bar']
	);
	const base = String(origin || DEFAULT_ORIGIN).replace(/\/+$/, '');
	return `${base}${langPrefix(lang)}/yamado/${facility}/plans?${q.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`;
}

/** 空き日の取得先（/api/stay-calendar は施設 slug を受ける） */
export function calendarUrl(origin: string, facility: string, nights: unknown, adults: unknown): string {
	const v = clampSearch({ nights, adults });
	return `${String(origin || DEFAULT_ORIGIN).replace(/\/+$/, '')}/api/stay-calendar?facility=${encodeURIComponent(facility)}&nights=${v.nights}&adults=${v.adults}&months=2`;
}

/** 検索の直前に dataLayer へ積む中身（Shadow DOM の中の操作は GTM の自動計測に乗らないため・設計書 §3.5） */
export function searchEvent(facility: string, values: { checkin?: unknown; nights?: unknown; adults?: unknown; rooms?: unknown }) {
	const v = clampSearch(values);
	return { event: 'search_submit', facility, checkin: isIsoDate(values.checkin) ? values.checkin : '', nights: v.nights, adults: v.adults, rooms: v.rooms };
}

/** 今日（JST） */
export function todayJst(nowMs: number = Date.now()): string {
	return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
	const t = new Date(`${iso}T00:00:00Z`);
	t.setUTCDate(t.getUTCDate() + days);
	return t.toISOString().slice(0, 10);
}

/** 'YYYY-MM' を delta か月ずらす */
export function shiftYm(ym: string, delta: number): string {
	const [y, m] = ym.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1 + delta, 1));
	return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

/** 月のカレンダー: 1日の曜日（日=0）と日付の並び */
export function monthGrid(ym: string): { offset: number; dates: string[] } {
	const [y, m] = ym.split('-').map(Number);
	const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
	const dates = Array.from({ length: count }, (_, i) => `${ym}-${pad(i + 1)}`);
	return { offset: new Date(Date.UTC(y, m - 1, 1)).getUTCDay(), dates };
}

export const weekdayOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

export const WEEKDAYS: Record<StaySearchLang, string[]> = {
	ja: ['日', '月', '火', '水', '木', '金', '土'],
	en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
	'zh-TW': ['日', '一', '二', '三', '四', '五', '六']
};
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 12月20日（土）／Sat, Dec 20／12月20日（六） */
export function formatDate(iso: string, lang: StaySearchLang): string {
	const [, m, d] = iso.split('-').map(Number);
	const w = WEEKDAYS[lang][weekdayOf(iso)];
	if (lang === 'en') return `${w}, ${EN_MONTHS[m - 1].slice(0, 3)} ${d}`;
	return `${m}月${d}日（${w}）`;
}

/** 12/20（土）／Sat, Dec 20（日付パネルの下の行） */
export function formatShortDate(iso: string, lang: StaySearchLang): string {
	if (lang === 'en') return formatDate(iso, lang);
	const [, m, d] = iso.split('-').map(Number);
	return `${m}/${d}（${WEEKDAYS[lang][weekdayOf(iso)]}）`;
}

/** 2026年 12月／December 2026 */
export function formatMonth(ym: string, lang: StaySearchLang): string {
	const [y, m] = ym.split('-').map(Number);
	if (lang === 'en') return `${EN_MONTHS[m - 1]} ${y}`;
	return `${y}年 ${m}月`;
}

/** 料金の表示（ja・zh-TW は「12,000円」、en は「¥12,000」） */
export function formatPrice(price: number, lang: StaySearchLang): string {
	const s = Math.round(price).toLocaleString('ja-JP');
	return lang === 'en' ? `¥${s}` : `${s}円`;
}

export type StayCalendarData = { prices: Record<string, number>; closed: Record<string, boolean>; through: string };

/** /api/stay-calendar の応答 → { prices: {日付: 1名1泊の最安}, closed: {日付: true}, through }。形が違えば null */
export function parseCalendar(json: unknown): StayCalendarData | null {
	const j = json as { days?: unknown; closed?: unknown; through?: unknown } | null;
	if (!j || !Array.isArray(j.days)) return null;
	const prices: Record<string, number> = {};
	const closed: Record<string, boolean> = {};
	for (const d of j.days as { date?: unknown; price?: unknown }[]) {
		if (d && isIsoDate(d.date) && typeof d.price === 'number' && d.price > 0) prices[d.date] = d.price;
	}
	for (const d of Array.isArray(j.closed) ? j.closed : []) if (isIsoDate(d)) closed[d] = true;
	return { prices, closed, through: isIsoDate(j.through) ? j.through : '' };
}

/**
 * 1 日分の表示（StayDatePanel と同じ判定）。
 * data が無い（取得中・失敗）ときは今日以降をすべて選べる＝フォールバック。
 * 取得範囲（through）を過ぎた日は料金なしで選べる。
 */
export function dayState(date: string, today: string, data: StayCalendarData | null) {
	const price = data && Object.prototype.hasOwnProperty.call(data.prices, date) ? data.prices[date] : null;
	const known = !!(data && data.through && date <= data.through && price == null);
	return {
		price,
		disabled: date < today || known,
		unavailable: known && date >= today,
		closed: !!(known && data?.closed[date])
	};
}
