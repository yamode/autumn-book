// HP 配布の検索バー（static/embed/search-bar.js）の純関数のテスト。
// 配布物そのもの（素の JS）を node の vm で読み込み、globalThis.__yamadoSearchBar に出した関数を検証する（DOM 部分は document が無いので走らない）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

type Api = {
	normalizeLang: (v: unknown) => string;
	resolveLang: (attr: unknown, html: unknown) => string;
	normalizeFacility: (v: unknown) => string;
	clampInt: (v: unknown, min: number, max: number, fallback: number) => number;
	clampSearch: (v: Record<string, unknown>) => { nights: number; adults: number; rooms: number };
	isIsoDate: (v: unknown) => boolean;
	apiOrigin: (src: unknown) => string;
	buildSearchUrl: (origin: string, o: Record<string, unknown>) => string;
	calendarUrl: (origin: string, facility: string, nights: unknown, adults: unknown) => string;
	todayJst: (nowMs?: number) => string;
	addDays: (iso: string, n: number) => string;
	shiftYm: (ym: string, d: number) => string;
	monthGrid: (ym: string) => { offset: number; dates: string[] };
	formatDate: (iso: string, lang: string) => string;
	formatMonth: (ym: string, lang: string) => string;
	formatPrice: (n: number, lang: string) => string;
	parseCalendar: (json: unknown) => { prices: Record<string, number>; closed: Record<string, boolean>; through: string } | null;
	dayState: (
		date: string,
		today: string,
		data: { prices: Record<string, number>; closed: Record<string, boolean>; through: string } | null
	) => { price: number | null; disabled: boolean; unavailable: boolean; closed: boolean };
	T: Record<string, Record<string, unknown>>;
};

const source = readFileSync(fileURLToPath(new URL('../../static/embed/search-bar.js', import.meta.url)), 'utf8');
// URL は ECMAScript の組み込みではない（ブラウザと Node の API）ので渡す
const sandbox: { URL: typeof URL; __yamadoSearchBar?: Api } = { URL };
runInNewContext(source, sandbox);
const sb = sandbox.__yamadoSearchBar as Api;
const O = 'https://book.yamado.app';

describe('検索の遷移先 URL（E2・契約書 v1.1）', () => {
	it('日本語・日付あり・1室は rooms を付けない', () => {
		expect(sb.buildSearchUrl(O, { facility: 'oga', lang: 'ja', checkin: '2026-12-20', nights: 2, adults: 3, rooms: 1, utmSource: 'hp_oga' })).toBe(
			'https://book.yamado.app/yamado/oga/plans?checkin=2026-12-20&nights=2&adults=3&utm_source=hp_oga&utm_medium=referral&utm_campaign=reserve&utm_content=search_bar'
		);
	});
	it('日付なしは checkin を付けない・2室以上は rooms を付ける・utm の既定は hp_<施設> / search_bar', () => {
		expect(sb.buildSearchUrl(O, { facility: 'nishiwaga', lang: 'ja', checkin: '', nights: 1, adults: 2, rooms: 3 })).toBe(
			'https://book.yamado.app/yamado/nishiwaga/plans?nights=1&adults=2&rooms=3&utm_source=hp_nishiwaga&utm_medium=referral&utm_campaign=reserve&utm_content=search_bar'
		);
	});
	it('言語プレフィックス: en → /en、zh-TW → /zh-TW、ko は /en', () => {
		expect(sb.buildSearchUrl(O, { facility: 'oga', lang: 'en' })).toMatch(/^https:\/\/book\.yamado\.app\/en\/yamado\/oga\/plans\?/);
		expect(sb.buildSearchUrl(O, { facility: 'oga', lang: 'zh-TW' })).toMatch(/^https:\/\/book\.yamado\.app\/zh-TW\/yamado\/oga\/plans\?/);
		expect(sb.buildSearchUrl(O, { facility: 'oga', lang: 'ko' })).toMatch(/\/en\/yamado\/oga\/plans\?/);
	});
	it('範囲外の値は Book と同じ範囲に丸める（泊数 1〜7・人数 1〜6・室数 1〜4）', () => {
		const url = new URL(sb.buildSearchUrl(O, { facility: 'oga', lang: 'ja', nights: 9, adults: 0, rooms: 8 }));
		expect(url.searchParams.get('nights')).toBe('7');
		expect(url.searchParams.get('adults')).toBe('1');
		expect(url.searchParams.get('rooms')).toBe('4');
	});
	it('不正な日付は付けない・utm は URL エンコードする・施設が不正なら空文字', () => {
		const url = new URL(sb.buildSearchUrl(O, { facility: 'oga', checkin: '2026-02-30', utmContent: 'top bar&x' }));
		expect(url.searchParams.has('checkin')).toBe(false);
		expect(url.searchParams.get('utm_content')).toBe('top bar&x');
		expect(sb.buildSearchUrl(O, { facility: 'tokyo' })).toBe('');
	});
	it('オリジン末尾のスラッシュは除く（ローカル開発のオリジンでも組める）', () => {
		expect(sb.buildSearchUrl('http://localhost:5173/', { facility: 'oga' })).toMatch(/^http:\/\/localhost:5173\/yamado\/oga\/plans\?nights=1&adults=2&/);
	});
});

describe('範囲の丸め', () => {
	it('clampInt: 数字でなければ既定値・小数は切り捨て', () => {
		expect(sb.clampInt('3', 1, 7, 1)).toBe(3);
		expect(sb.clampInt('abc', 1, 7, 1)).toBe(1);
		expect(sb.clampInt(undefined, 1, 6, 2)).toBe(2);
		expect(sb.clampInt(2.9, 1, 7, 1)).toBe(2);
		expect(sb.clampInt(-5, 1, 7, 1)).toBe(1);
		expect(sb.clampInt(99, 1, 7, 1)).toBe(7);
	});
	it('clampSearch: 既定は 1 泊・2 名・1 室', () => {
		expect(sb.clampSearch({})).toEqual({ nights: 1, adults: 2, rooms: 1 });
		expect(sb.clampSearch({ nights: 0, adults: 7, rooms: 5 })).toEqual({ nights: 1, adults: 6, rooms: 4 });
	});
});

describe('言語の判定', () => {
	it('要素の lang → <html lang> → ja', () => {
		expect(sb.resolveLang('en', 'ja')).toBe('en');
		expect(sb.resolveLang('', 'zh-Hant-TW')).toBe('zh-TW');
		expect(sb.resolveLang(null, 'zh-tw')).toBe('zh-TW');
		expect(sb.resolveLang(null, 'en-US')).toBe('en');
		expect(sb.resolveLang(null, 'ko')).toBe('en');
		expect(sb.resolveLang(null, 'fr')).toBe('ja');
		expect(sb.resolveLang(null, null)).toBe('ja');
	});
	it('3 言語の文言が同じキーを持つ', () => {
		const keys = Object.keys(sb.T.ja).sort();
		expect(Object.keys(sb.T.en).sort()).toEqual(keys);
		expect(Object.keys(sb.T['zh-TW']).sort()).toEqual(keys);
	});
});

describe('日付', () => {
	it('今日（JST）: UTC 15:00 で日付が変わる', () => {
		expect(sb.todayJst(Date.UTC(2026, 11, 19, 14, 59))).toBe('2026-12-19');
		expect(sb.todayJst(Date.UTC(2026, 11, 19, 15, 0))).toBe('2026-12-20');
	});
	it('表示: 言語ごとの日付・月', () => {
		expect(sb.formatDate('2026-12-20', 'ja')).toBe('12月20日（日）');
		expect(sb.formatDate('2026-12-20', 'zh-TW')).toBe('12月20日（日）');
		expect(sb.formatDate('2026-12-19', 'zh-TW')).toBe('12月19日（六）');
		expect(sb.formatDate('2026-12-19', 'en')).toBe('Sat, Dec 19');
		expect(sb.formatMonth('2026-12', 'ja')).toBe('2026年 12月');
		expect(sb.formatMonth('2026-12', 'en')).toBe('December 2026');
		expect(sb.formatPrice(12000, 'ja')).toBe('12,000円');
		expect(sb.formatPrice(12000, 'en')).toBe('¥12,000');
	});
	it('月送り・日付の加算・月のマス', () => {
		expect(sb.shiftYm('2026-12', 1)).toBe('2027-01');
		expect(sb.shiftYm('2026-01', -1)).toBe('2025-12');
		expect(sb.addDays('2026-12-30', 3)).toBe('2027-01-02');
		const feb = sb.monthGrid('2028-02');
		expect(feb.dates).toHaveLength(29);
		expect(feb.offset).toBe(2); // 2028-02-01 は火曜
	});
	it('isIsoDate は実在する日だけ', () => {
		expect(sb.isIsoDate('2026-12-20')).toBe(true);
		expect(sb.isIsoDate('2026-02-29')).toBe(false);
		expect(sb.isIsoDate('20261220')).toBe(false);
		expect(sb.isIsoDate(undefined)).toBe(false);
	});
});

describe('空き日', () => {
	it('取得先はスクリプトのオリジン＋施設 slug', () => {
		expect(sb.apiOrigin('https://book.yamado.app/embed/search-bar.js')).toBe('https://book.yamado.app');
		expect(sb.apiOrigin('http://localhost:5173/embed/search-bar.js?v=1')).toBe('http://localhost:5173');
		expect(sb.apiOrigin(undefined)).toBe('https://book.yamado.app');
		expect(sb.calendarUrl(O, 'oga', 3, 2)).toBe('https://book.yamado.app/api/stay-calendar?facility=oga&nights=3&adults=2&months=2');
		expect(sb.calendarUrl(O, 'oga', 10, 0)).toBe('https://book.yamado.app/api/stay-calendar?facility=oga&nights=7&adults=1&months=2');
	});
	it('応答の読み取りと日ごとの判定（取得範囲内で料金なし＝満室、休館日、範囲外は選べる、過去は選べない）', () => {
		const data = sb.parseCalendar({ days: [{ date: '2026-12-20', price: 15000, remaining: 2 }, { date: 'x', price: 1 }], through: '2026-12-31', closed: ['2026-12-22'] });
		expect(data).not.toBeNull();
		const today = '2026-12-19';
		expect(sb.dayState('2026-12-20', today, data)).toEqual({ price: 15000, disabled: false, unavailable: false, closed: false });
		expect(sb.dayState('2026-12-21', today, data)).toEqual({ price: null, disabled: true, unavailable: true, closed: false });
		expect(sb.dayState('2026-12-22', today, data)).toEqual({ price: null, disabled: true, unavailable: true, closed: true });
		expect(sb.dayState('2027-01-05', today, data)).toMatchObject({ price: null, disabled: false });
		expect(sb.dayState('2026-12-18', today, data)).toMatchObject({ disabled: true, unavailable: false });
	});
	it('取得失敗（data なし）でも今日以降は選べる', () => {
		expect(sb.dayState('2026-12-21', '2026-12-19', null)).toEqual({ price: null, disabled: false, unavailable: false, closed: false });
		expect(sb.parseCalendar({ error: 'unavailable' })).toBeNull();
	});
});
