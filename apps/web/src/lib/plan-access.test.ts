import { describe, expect, it } from 'vitest';
import { canBookPlan, isOpenPlan, listPlanFor, planAccessOf, planAccessSummaryJa, planGateFor, rankMeets, type PlanAccess, type PlanViewer } from './plan-access';

const guest: PlanViewer = { isMember: false, rank: null };
const standard: PlanViewer = { isMember: true, rank: 'standard' };
const gold: PlanViewer = { isMember: true, rank: 'gold' };

const open: PlanAccess = { audience: 'public', minRank: null, linkOnly: false };
const linkAnyone: PlanAccess = { audience: 'public', minRank: null, linkOnly: true };
const members: PlanAccess = { audience: 'members', minRank: null, linkOnly: false };
const goldUp: PlanAccess = { audience: 'members', minRank: 'gold', linkOnly: false };
const goldUpLink: PlanAccess = { audience: 'members', minRank: 'gold', linkOnly: true };

describe('planAccessOf', () => {
	it('列が無い・不正値は普通のプラン', () => {
		expect(planAccessOf({})).toEqual(open);
		expect(planAccessOf({ audience: 'x', min_rank: 'gold', link_only: 'yes' })).toEqual(open);
	});
	it('グレードは会員限定のときだけ', () => {
		expect(planAccessOf({ audience: 'public', min_rank: 'gold' }).minRank).toBeNull();
		expect(planAccessOf({ audience: 'members', min_rank: 'gold', link_only: true })).toEqual(goldUpLink);
	});
});

describe('rankMeets', () => {
	it('会員でなければ常に false・グレード指定なしは会員なら true', () => {
		expect(rankMeets(guest, null)).toBe(false);
		expect(rankMeets(standard, null)).toBe(true);
	});
	it('指定グレード以上', () => {
		expect(rankMeets(standard, 'gold')).toBe(false);
		expect(rankMeets(gold, 'gold')).toBe(true);
		expect(rankMeets({ isMember: true, rank: 'platinum' }, 'gold')).toBe(true);
	});
});

describe('一覧に出すか', () => {
	it('普通のプランは誰にでも、URL 限定は誰にも出さない', () => {
		expect(listPlanFor(open, guest)).toBe(true);
		expect(listPlanFor(linkAnyone, gold)).toBe(false);
		expect(listPlanFor(goldUpLink, gold)).toBe(false);
	});
	it('会員限定は対象の会員にだけ', () => {
		expect(listPlanFor(members, guest)).toBe(false);
		expect(listPlanFor(members, standard)).toBe(true);
		expect(listPlanFor(goldUp, standard)).toBe(false);
		expect(listPlanFor(goldUp, gold)).toBe(true);
	});
});

describe('予約できるか・詳細の扱い', () => {
	it('URL 限定（誰でも）: URL を開いていれば非会員でも予約できる。開いていなければ 404', () => {
		expect(canBookPlan(linkAnyone, guest, true)).toBe(true);
		expect(canBookPlan(linkAnyone, guest, false)).toBe(false);
		expect(planGateFor(linkAnyone, guest, false)).toBe('hidden');
		expect(planGateFor(linkAnyone, guest, true)).toBe('ok');
	});
	it('会員限定: 非会員はログインの案内、グレード不足はグレードの案内', () => {
		expect(planGateFor(members, guest, false)).toBe('login');
		expect(planGateFor(goldUp, standard, false)).toBe('rank');
		expect(planGateFor(goldUp, gold, false)).toBe('ok');
		expect(canBookPlan(goldUp, standard, true)).toBe(false);
	});
	it('URL 限定＋グレード: URL を開いていなければ会員でも 404、開いていても条件は外れない', () => {
		expect(planGateFor(goldUpLink, gold, false)).toBe('hidden');
		expect(planGateFor(goldUpLink, standard, true)).toBe('rank');
		expect(planGateFor(goldUpLink, guest, true)).toBe('login');
		expect(canBookPlan(goldUpLink, gold, true)).toBe(true);
	});
	it('公開範囲が無いプラン（デモ・旧データ）は普通のプラン', () => {
		expect(isOpenPlan(undefined)).toBe(true);
		expect(planGateFor(undefined, guest, false)).toBe('ok');
	});
});

describe('planAccessSummaryJa', () => {
	it('管理画面の短い説明', () => {
		expect(planAccessSummaryJa(open)).toBeNull();
		expect(planAccessSummaryJa(members)).toBe('会員限定');
		expect(planAccessSummaryJa(goldUp)).toBe('ゴールド以上の会員限定');
		expect(planAccessSummaryJa(linkAnyone)).toBe('URL限定・誰でも');
		expect(planAccessSummaryJa(goldUpLink)).toBe('URL限定・ゴールド以上の会員');
	});
});
