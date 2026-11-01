import { describe, expect, it } from 'vitest';
import { planLimitsFromForm, planLimitsOf, stayClosedFromForm, stayClosedOf } from './plan-limits';

function form(o: Record<string, string | string[]>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(o)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
	return f;
}

describe('planLimitsFromForm', () => {
	it('すべて空欄なら制限なし', () => {
		expect(planLimitsFromForm(form({}))).toEqual({
			limits: { salesStart: null, salesEnd: null, minGuests: null, maxGuests: null, roomTypeIds: [] }
		});
	});
	it('値を読み取る（部屋タイプの重複は除く）', () => {
		const r = planLimitsFromForm(form({ sales_start: '2026-12-01', sales_end: '2027-03-31', min_guests: '2', max_guests: '4', room_type_ids: ['a', 'a', 'b'] }));
		expect(r).toEqual({ limits: { salesStart: '2026-12-01', salesEnd: '2027-03-31', minGuests: 2, maxGuests: 4, roomTypeIds: ['a', 'b'] } });
	});
	it('開始が終了より後ならエラー', () => {
		expect('error' in planLimitsFromForm(form({ sales_start: '2027-01-02', sales_end: '2027-01-01' }))).toBe(true);
	});
	it('最小が最大より多いとエラー', () => {
		expect('error' in planLimitsFromForm(form({ min_guests: '5', max_guests: '3' }))).toBe(true);
	});
	it('人数は 1〜6 の整数だけ', () => {
		for (const v of ['0', '7', '2.5', 'x']) expect('error' in planLimitsFromForm(form({ min_guests: v }))).toBe(true);
	});
	it('片側だけの期間・人数は許す', () => {
		expect('limits' in planLimitsFromForm(form({ sales_start: '2026-12-01', max_guests: '3' }))).toBe(true);
	});
	it('日付の形式が不正ならエラー', () => {
		expect('error' in planLimitsFromForm(form({ sales_end: '2026/12/01' }))).toBe(true);
	});
});

describe('planLimitsOf', () => {
	it('DB の行を読む', () => {
		expect(planLimitsOf({ sales_start: '2026-12-01', sales_end: null, min_guests: 2, max_guests: null, room_type_ids: ['x'] })).toEqual({
			salesStart: '2026-12-01', salesEnd: null, minGuests: 2, maxGuests: null, roomTypeIds: ['x']
		});
	});
	it('行が無い・null なら制限なし', () => {
		expect(planLimitsOf(undefined).roomTypeIds).toEqual([]);
		expect(planLimitsOf({ room_type_ids: null }).minGuests).toBeNull();
	});
});

describe('stayClosedFromForm', () => {
	it('何も無ければ制限なし', () => {
		expect(stayClosedFromForm(form({}))).toEqual({ stayClosed: { blackouts: [], dows: [] } });
	});
	it('複数の期間を開始日順に読む（空の行は捨てる）', () => {
		const r = stayClosedFromForm(form({ blackout_start: ['2027-02-10', '', '2026-12-29'], blackout_end: ['2027-02-12', '', '2027-01-03'] }));
		expect(r).toEqual({
			stayClosed: {
				blackouts: [
					{ start: '2026-12-29', end: '2027-01-03' },
					{ start: '2027-02-10', end: '2027-02-12' }
				],
				dows: []
			}
		});
	});
	it('片方だけなら 1 日だけ', () => {
		expect(stayClosedFromForm(form({ blackout_start: ['2026-12-31'], blackout_end: [''] }))).toEqual({
			stayClosed: { blackouts: [{ start: '2026-12-31', end: '2026-12-31' }], dows: [] }
		});
	});
	it('開始が終了より後・日付でない値はエラー', () => {
		expect('error' in stayClosedFromForm(form({ blackout_start: ['2027-01-05'], blackout_end: ['2027-01-01'] }))).toBe(true);
		expect('error' in stayClosedFromForm(form({ blackout_start: ['x'], blackout_end: ['2027-01-01'] }))).toBe(true);
	});
	it('曜日は 0〜6 を重複なしで並べる', () => {
		expect(stayClosedFromForm(form({ closed_dows: ['6', '2', '2'] }))).toEqual({ stayClosed: { blackouts: [], dows: [2, 6] } });
		expect('error' in stayClosedFromForm(form({ closed_dows: ['7'] }))).toBe(true);
	});
});

describe('stayClosedOf', () => {
	it('DB の値を読み、壊れた要素は捨てる', () => {
		expect(
			stayClosedOf({ stay_blackouts: [{ start: '2026-12-29', end: '2027-01-03' }, { start: 'x' }, null], stay_closed_dows: [3, 1, 9] })
		).toEqual({ blackouts: [{ start: '2026-12-29', end: '2027-01-03' }], dows: [1, 3] });
		expect(stayClosedOf(undefined)).toEqual({ blackouts: [], dows: [] });
	});
});
