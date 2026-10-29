// 検索バー（取引先ページと HP 配布の <yamado-search-bar> の共通部品）まわりの純関数のテスト。
// 旧 embed-search-bar.test.ts（配布 JS を vm で読み込んでいた）の検査を引き継ぐ。
// 配布物は Svelte の部品をビルドした生成物になったので、元の TS を直接テストする。
import { describe, expect, it } from 'vitest';
import { STAY_SEARCH_LABELS } from './labels';
import {
	addDays,
	apiOrigin,
	buildSearchUrl,
	calendarUrl,
	clampInt,
	clampSearch,
	dayState,
	formatDate,
	formatMonth,
	formatPrice,
	formatShortDate,
	isIsoDate,
	monthGrid,
	normalizeFacility,
	parseCalendar,
	resolveLang,
	searchEvent,
	shiftYm,
	todayJst
} from './params';
import { shadowCss } from './shadow-css';

const O = 'https://book.yamado.app';

describe('検索の遷移先 URL（E2・契約書 v1.1）', () => {
	it('日本語・日付あり・1室は rooms を付けない', () => {
		expect(buildSearchUrl(O, { facility: 'oga', lang: 'ja', checkin: '2026-12-20', nights: 2, adults: 3, rooms: 1, utmSource: 'hp_oga' })).toBe(
			'https://book.yamado.app/yamado/oga/plans?checkin=2026-12-20&nights=2&adults=3&utm_source=hp_oga&utm_medium=referral&utm_campaign=reserve&utm_content=search_bar'
		);
	});
	it('日付なしは checkin を付けない・2室以上は rooms を付ける・utm の既定は hp_<施設> / search_bar', () => {
		expect(buildSearchUrl(O, { facility: 'nishiwaga', lang: 'ja', checkin: '', nights: 1, adults: 2, rooms: 3 })).toBe(
			'https://book.yamado.app/yamado/nishiwaga/plans?nights=1&adults=2&rooms=3&utm_source=hp_nishiwaga&utm_medium=referral&utm_campaign=reserve&utm_content=search_bar'
		);
	});
	it('言語プレフィックス: en → /en、zh-TW → /zh-TW、ko は /en', () => {
		expect(buildSearchUrl(O, { facility: 'oga', lang: 'en' })).toMatch(/^https:\/\/book\.yamado\.app\/en\/yamado\/oga\/plans\?/);
		expect(buildSearchUrl(O, { facility: 'oga', lang: 'zh-TW' })).toMatch(/^https:\/\/book\.yamado\.app\/zh-TW\/yamado\/oga\/plans\?/);
		expect(buildSearchUrl(O, { facility: 'oga', lang: 'ko' })).toMatch(/\/en\/yamado\/oga\/plans\?/);
	});
	it('範囲外の値は Book と同じ範囲に丸める（泊数 1〜7・人数 1〜6・室数 1〜4）', () => {
		const url = new URL(buildSearchUrl(O, { facility: 'oga', lang: 'ja', nights: 9, adults: 0, rooms: 8 }));
		expect(url.searchParams.get('nights')).toBe('7');
		expect(url.searchParams.get('adults')).toBe('1');
		expect(url.searchParams.get('rooms')).toBe('4');
	});
	it('不正な日付は付けない・utm は URL エンコードする・施設が不正なら空文字', () => {
		const url = new URL(buildSearchUrl(O, { facility: 'oga', checkin: '2026-02-30', utmContent: 'top bar&x' }));
		expect(url.searchParams.has('checkin')).toBe(false);
		expect(url.searchParams.get('utm_content')).toBe('top bar&x');
		expect(buildSearchUrl(O, { facility: 'tokyo' })).toBe('');
	});
	it('オリジン末尾のスラッシュは除く（ローカル開発のオリジンでも組める）', () => {
		expect(buildSearchUrl('http://localhost:5173/', { facility: 'oga' })).toMatch(/^http:\/\/localhost:5173\/yamado\/oga\/plans\?nights=1&adults=2&/);
	});
	it('dataLayer に積む search_submit（範囲に丸め、日付が無ければ空文字）', () => {
		expect(searchEvent('oga', { checkin: '2026-12-20', nights: 2, adults: 3, rooms: 1 })).toEqual({
			event: 'search_submit',
			facility: 'oga',
			checkin: '2026-12-20',
			nights: 2,
			adults: 3,
			rooms: 1
		});
		expect(searchEvent('oga', { checkin: '', nights: 99, adults: 2, rooms: 2 })).toMatchObject({ checkin: '', nights: 7, rooms: 2 });
	});
});

describe('範囲の丸め', () => {
	it('clampInt: 数字でなければ既定値・小数は切り捨て', () => {
		expect(clampInt('3', 1, 7, 1)).toBe(3);
		expect(clampInt('abc', 1, 7, 1)).toBe(1);
		expect(clampInt(undefined, 1, 6, 2)).toBe(2);
		expect(clampInt(2.9, 1, 7, 1)).toBe(2);
		expect(clampInt(-5, 1, 7, 1)).toBe(1);
		expect(clampInt(99, 1, 7, 1)).toBe(7);
	});
	it('clampSearch: 既定は 1 泊・2 名・1 室', () => {
		expect(clampSearch({})).toEqual({ nights: 1, adults: 2, rooms: 1 });
		expect(clampSearch({ nights: 0, adults: 7, rooms: 5 })).toEqual({ nights: 1, adults: 6, rooms: 4 });
	});
});

describe('言語・施設の判定', () => {
	it('要素の lang → <html lang> → ja', () => {
		expect(resolveLang('en', 'ja')).toBe('en');
		expect(resolveLang('', 'zh-Hant-TW')).toBe('zh-TW');
		expect(resolveLang(null, 'zh-tw')).toBe('zh-TW');
		expect(resolveLang(null, 'en-US')).toBe('en');
		expect(resolveLang(null, 'ko')).toBe('en');
		expect(resolveLang(null, 'fr')).toBe('ja');
		expect(resolveLang(null, null)).toBe('ja');
	});
	it('施設は nishiwaga / oga だけ（大文字・空白は許す）', () => {
		expect(normalizeFacility(' OGA ')).toBe('oga');
		expect(normalizeFacility('nishiwaga')).toBe('nishiwaga');
		expect(normalizeFacility('yamado')).toBe('');
		expect(normalizeFacility(null)).toBe('');
	});
	it('3 言語の文言が同じキーを持ち、ja は取引先ページの文言のまま', () => {
		const keys = Object.keys(STAY_SEARCH_LABELS.ja).sort();
		expect(Object.keys(STAY_SEARCH_LABELS.en).sort()).toEqual(keys);
		expect(Object.keys(STAY_SEARCH_LABELS['zh-TW']).sort()).toEqual(keys);
		const ja = STAY_SEARCH_LABELS.ja;
		expect(ja.guestsVal(2, 1)).toBe('大人2名・1室');
		expect(ja.guestsVal(2, 3)).toBe('大人2名 × 3室');
		expect(ja.priceNote(2, 3)).toBe('大人2名×3室・1名あたりの最安');
		expect(ja.roomsTitle(true)).toBe('必要な室数');
		expect(ja.roomsTitle(false)).toBe('室数');
	});
});

describe('日付', () => {
	it('今日（JST）: UTC 15:00 で日付が変わる', () => {
		expect(todayJst(Date.UTC(2026, 11, 19, 14, 59))).toBe('2026-12-19');
		expect(todayJst(Date.UTC(2026, 11, 19, 15, 0))).toBe('2026-12-20');
	});
	it('表示: 言語ごとの日付・月・料金', () => {
		expect(formatDate('2026-12-20', 'ja')).toBe('12月20日（日）');
		expect(formatDate('2026-12-20', 'zh-TW')).toBe('12月20日（日）');
		expect(formatDate('2026-12-19', 'zh-TW')).toBe('12月19日（六）');
		expect(formatDate('2026-12-19', 'en')).toBe('Sat, Dec 19');
		expect(formatShortDate('2026-12-20', 'ja')).toBe('12/20（日）');
		expect(formatShortDate('2026-12-19', 'en')).toBe('Sat, Dec 19');
		expect(formatMonth('2026-12', 'ja')).toBe('2026年 12月');
		expect(formatMonth('2026-12', 'en')).toBe('December 2026');
		expect(formatPrice(12000, 'ja')).toBe('12,000円');
		expect(formatPrice(12000, 'en')).toBe('¥12,000');
	});
	it('月送り・日付の加算・月のマス', () => {
		expect(shiftYm('2026-12', 1)).toBe('2027-01');
		expect(shiftYm('2026-01', -1)).toBe('2025-12');
		expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
		const feb = monthGrid('2028-02');
		expect(feb.dates).toHaveLength(29);
		expect(feb.offset).toBe(2); // 2028-02-01 は火曜
	});
	it('isIsoDate は実在する日だけ', () => {
		expect(isIsoDate('2026-12-20')).toBe(true);
		expect(isIsoDate('2026-02-29')).toBe(false);
		expect(isIsoDate('20261220')).toBe(false);
		expect(isIsoDate(undefined)).toBe(false);
	});
});

describe('空き日', () => {
	it('取得先はスクリプトのオリジン＋施設 slug', () => {
		expect(apiOrigin('https://book.yamado.app/embed/search-bar.js')).toBe('https://book.yamado.app');
		expect(apiOrigin('http://localhost:5173/embed/search-bar.js?v=1')).toBe('http://localhost:5173');
		expect(apiOrigin(undefined)).toBe('https://book.yamado.app');
		expect(calendarUrl(O, 'oga', 3, 2)).toBe('https://book.yamado.app/api/stay-calendar?facility=oga&nights=3&adults=2&months=2');
		expect(calendarUrl(O, 'oga', 10, 0)).toBe('https://book.yamado.app/api/stay-calendar?facility=oga&nights=7&adults=1&months=2');
	});
	it('応答の読み取りと日ごとの判定（取得範囲内で料金なし＝満室、休館日、範囲外は選べる、過去は選べない）', () => {
		const data = parseCalendar({
			days: [
				{ date: '2026-12-20', price: 15000, remaining: 2 },
				{ date: 'x', price: 1 }
			],
			through: '2026-12-31',
			closed: ['2026-12-22']
		});
		expect(data).not.toBeNull();
		const today = '2026-12-19';
		expect(dayState('2026-12-20', today, data)).toEqual({ price: 15000, disabled: false, unavailable: false, closed: false });
		expect(dayState('2026-12-21', today, data)).toEqual({ price: null, disabled: true, unavailable: true, closed: false });
		expect(dayState('2026-12-22', today, data)).toEqual({ price: null, disabled: true, unavailable: true, closed: true });
		expect(dayState('2027-01-05', today, data)).toMatchObject({ price: null, disabled: false });
		expect(dayState('2026-12-18', today, data)).toMatchObject({ disabled: true, unavailable: false });
	});
	it('取得失敗（data なし）でも今日以降は選べる', () => {
		expect(dayState('2026-12-21', '2026-12-19', null)).toEqual({ price: null, disabled: false, unavailable: false, closed: false });
		expect(parseCalendar({ error: 'unavailable' })).toBeNull();
	});
});

describe('Shadow DOM 用の CSS の書き換え（embed のビルド）', () => {
	it('rem は 18px 基準の px に、画面幅の @media はホスト幅の @container に（メディアクエリの rem は 16px）', () => {
		const out = shadowCss(
			'.a{font-size:.75rem;padding:calc(var(--spacing)*4)}:root{--spacing:.25rem}@media (width >= 48rem){.md\\:flex{display:flex}}@media (min-width:40rem){.b{x:1}}@media (prefers-reduced-motion:reduce){.c{y:1}}'
		);
		expect(out).toContain('font-size:13.5px');
		expect(out).toContain('--spacing:4.5px');
		expect(out).toContain('@container (min-width: 900px)'); // PC の 1 本バーは HP の 1 カラム幅では 900px から
		expect(out).toContain('@container (min-width: 640px)');
		expect(out).toContain('@media (prefers-reduced-motion:reduce)');
		expect(out).not.toMatch(/\drem/);
	});
	it('@property は外し、初期値を :host と全要素に置く（初期値の無いものは initial）', () => {
		const out = shadowCss('@property --tw-shadow{syntax:"*";inherits:false;initial-value:0 0 #0000}@property --tw-leading{syntax:"*";inherits:false}.x{a:b}');
		expect(out).not.toContain('@property');
		expect(out.startsWith('@layer properties{:host,*,::before,::after,::backdrop{--tw-shadow:0 0 #0000;--tw-leading:initial}}')).toBe(true);
	});
});
