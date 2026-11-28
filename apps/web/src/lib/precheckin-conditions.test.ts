import { describe, expect, it } from 'vitest';
import { describeConditions, normalizeConditions } from './precheckin';
import { autosendDecision } from './precheckin-sms';

describe('出し分けの条件（2026-11-28）', () => {
	it('知らない項目・空・形の違う値は捨てる', () => {
		expect(
			normalizeConditions({
				transport: ['車', 'JR', '自転車', 'JR'],
				group: 'multi',
				routes: ['ikkyu', 'Bad Code', ''],
				nights: 'x',
				visit: 'first',
				member: 'member',
				ranks: ['gold'],
				r_min: '2',
				r_max: 0,
				foo: 1
			})
		).toEqual({ transport: ['車', 'JR'], group: 'multi', routes: ['ikkyu'], visit: 'first', member: 'member', ranks: ['gold'], r_min: 2 });
		expect(normalizeConditions(null)).toEqual({});
		expect(normalizeConditions({ transport: [], group: '' })).toEqual({});
	});
	it('短い説明にする（条件が無ければ空）', () => {
		expect(describeConditions({})).toBe('');
		expect(describeConditions({ transport: ['JR'], group: 'multi', nights: 'multi', visit: 'first' })).toBe('交通手段: JR ／ 2室以上 ／ 連泊 ／ 初めての利用');
		expect(describeConditions({ routes: ['ikkyu'] }, (c) => (c === 'ikkyu' ? '一休' : c))).toBe('経路: 一休');
		expect(describeConditions({ r_min: 2, r_max: 5 })).toBe('R2〜R5');
	});
});

describe('自動送信の判定と絞り込み（2026-11-28）', () => {
	const st = { enabled: true, routes: ['ikkyu'] };
	it('経路が選ばれていて絞り込みに当てはまれば送る', () => {
		expect(autosendDecision('ikkyu', st, null, true)).toEqual({ send: true, by: 'route' });
	});
	it('経路が選ばれていても絞り込みに当てはまらなければ送らない', () => {
		expect(autosendDecision('ikkyu', st, null, false)).toEqual({ send: false, by: 'filter' });
	});
	it('個別の「送る」は絞り込みより優先', () => {
		expect(autosendDecision('ikkyu', st, true, false)).toEqual({ send: true, by: 'override' });
	});
	it('経路が選ばれていなければ、絞り込みに関係なく送らない', () => {
		expect(autosendDecision('rakuten', st, null, true)).toEqual({ send: false, by: 'route' });
	});
});
