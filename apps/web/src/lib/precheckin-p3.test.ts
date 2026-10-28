import { describe, expect, it } from 'vitest';
import {
	ciBathRows,
	ciBathState,
	ciGoPath,
	ciGoTarget,
	normalizeStayTokenResult,
	otaBannerHref,
	portalSlugOf,
	showOtaBanner,
	withPrecheckinUtm
} from './precheckin-p3';
import { demoPrecheckinContext, normalizePrecheckinContext } from './precheckin';

describe('OTA 誘導バナーの出し分け', () => {
	it('OTA（tripla も）には出す', () => {
		expect(showOtaBanner({ isOfficial: false, isPartner: false })).toBe(true);
	});
	it('公式サイト予約・取引先経由・不明（DB 適用前）には出さない', () => {
		expect(showOtaBanner({ isOfficial: true, isPartner: false })).toBe(false);
		expect(showOtaBanner({ isOfficial: false, isPartner: true })).toBe(false);
		expect(showOtaBanner({ isOfficial: null, isPartner: false })).toBe(false);
	});
	it('context の is_official / is_partner / portal_slug を読む（無ければ不明・null）', () => {
		const base = { ok: true, facility: { id: 'f', slug: 'oga', name: '男鹿' }, rooms: [], slots: {} };
		const a = normalizePrecheckinContext({ ...base, is_official: false, is_partner: false, facility: { ...base.facility, portal_slug: 'oga' } });
		if ('error' in a) throw new Error('unexpected');
		expect([a.isOfficial, a.isPartner, a.facility.portalSlug]).toEqual([false, false, 'oga']);
		const b = normalizePrecheckinContext(base);
		if ('error' in b) throw new Error('unexpected');
		expect([b.isOfficial, b.isPartner, b.facility.portalSlug]).toEqual([null, false, null]);
	});
	it('見本は OTA 扱いでバナーが出る', () => {
		expect(showOtaBanner(demoPrecheckinContext())).toBe(true);
	});
});

describe('予約トップへのリンク', () => {
	it('portal_slug を優先し、無ければ既知の施設を対応表で引く（西和賀は core が yamado）', () => {
		expect(portalSlugOf({ slug: 'yamado', portalSlug: 'nishiwaga' })).toBe('nishiwaga');
		expect(portalSlugOf({ slug: 'yamado', portalSlug: null })).toBe('nishiwaga');
		expect(portalSlugOf({ slug: 'oga', portalSlug: null })).toBe('oga');
		expect(portalSlugOf({ slug: 'unknown', portalSlug: null })).toBeNull();
		expect(portalSlugOf({ slug: 'oga', portalSlug: 'Bad Slug' })).toBe('oga');
	});
	it('UTM を付ける（既存のクエリと # は残し、同名の UTM は置き換える）', () => {
		expect(withPrecheckinUtm('/yamado/oga', 'oga')).toBe('/yamado/oga?utm_source=precheckin&utm_medium=ota&utm_campaign=oga');
		expect(withPrecheckinUtm('/yamado/oga?adults=2&utm_source=x#top', 'oga')).toBe(
			'/yamado/oga?adults=2&utm_source=precheckin&utm_medium=ota&utm_campaign=oga#top'
		);
	});
	it('言語の接頭辞を付けたうえで UTM を付ける', () => {
		expect(otaBannerHref({ slug: 'yamado', portalSlug: 'nishiwaga' }, (p) => `/en${p}`)).toBe(
			'/en/yamado/nishiwaga?utm_source=precheckin&utm_medium=ota&utm_campaign=nishiwaga'
		);
		expect(otaBannerHref({ slug: 'x', portalSlug: null })).toBeNull();
	});
});

describe('滞在トークン（precheckin_stay_token）', () => {
	it('成功は token と期間を返す', () => {
		const t = 'a'.repeat(64);
		expect(normalizeStayTokenResult({ ok: true, token: t, valid_from: 'F', valid_to: 'T', reused: true })).toEqual({
			ok: true,
			token: t,
			validFrom: 'F',
			validTo: 'T'
		});
	});
	it('理由は知っているものだけ。形の違うトークンは server', () => {
		expect(normalizeStayTokenResult({ ok: false, error: 'closed' })).toEqual({ ok: false, error: 'closed' });
		expect(normalizeStayTokenResult({ ok: false, error: 'boom' })).toEqual({ ok: false, error: 'server' });
		expect(normalizeStayTokenResult({ ok: true, token: '../x' })).toEqual({ ok: false, error: 'server' });
		expect(normalizeStayTokenResult(null)).toEqual({ ok: false, error: 'server' });
	});
	it('/ci/go の行き先は貸切風呂か客室案内だけ', () => {
		expect(ciGoPath(ciGoTarget('bath'))).toBe('/r/bath');
		expect(ciGoPath(ciGoTarget('inroom'))).toBe('/r');
		expect(ciGoPath(ciGoTarget('https://evil.example'))).toBe('/r');
		expect(ciGoPath(ciGoTarget(null))).toBe('/r');
	});
});

describe('貸切風呂のステップの状態', () => {
	const ok = { ok: true as const, token: 'a'.repeat(64), validFrom: '2026-11-01T00:00:00Z', validTo: '2026-11-02T02:00:00Z' };
	const now = new Date('2026-11-01T01:00:00Z'); // 当日 10:00 JST
	it('期限後は closed、未回答は not_answered', () => {
		expect(ciBathState({ answered: true, editable: false, token: null, bathOpen: null, now })).toBe('closed');
		expect(ciBathState({ answered: false, editable: true, token: null, bathOpen: null, now })).toBe('not_answered');
	});
	it('9:00 より前は not_yet、受付していなければ unavailable、あとは ready', () => {
		expect(ciBathState({ answered: true, editable: true, token: ok, bathOpen: true, now: new Date('2026-10-31T23:00:00Z') })).toBe('not_yet');
		expect(ciBathState({ answered: true, editable: true, token: ok, bathOpen: false, now })).toBe('unavailable');
		expect(ciBathState({ answered: true, editable: true, token: ok, bathOpen: true, now })).toBe('ready');
	});
	it('トークンを受け取れない理由をそのまま状態にする', () => {
		expect(ciBathState({ answered: true, editable: true, token: { ok: false, error: 'closed' }, bathOpen: null, now })).toBe('closed');
		expect(ciBathState({ answered: true, editable: true, token: { ok: false, error: 'server' }, bathOpen: null, now })).toBe('unavailable');
	});
	it('予約済みの枠は日付・時刻の順で、浴室名を付ける', () => {
		const rows = ciBathRows(
			[
				{ id: '2', date: '2026-11-01', from: '20:00', to: '20:45', bath_id: 'b2' },
				{ id: '1', date: '2026-11-01', from: '16:00', to: null, bath_id: 'b1' }
			],
			[
				{ bath_id: 'b1', bath_name: '檜' },
				{ bath_id: 'b2', bath_name: '岩' }
			]
		);
		expect(rows.map((r) => [r.key, r.bathName])).toEqual([
			['1', '檜'],
			['2', '岩']
		]);
		expect(ciBathRows(undefined, undefined)).toEqual([]);
	});
});
