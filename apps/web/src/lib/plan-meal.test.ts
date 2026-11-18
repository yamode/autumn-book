import { mealKindOf } from './plan-meal';
import { describe, expect, it } from 'vitest';
import { MEAL_PLANS, isMealPlan } from './plan-meal';

describe('新規プランの食事区分', () => {
	it('選べる区分だけを通す', () => {
		for (const m of MEAL_PLANS) expect(isMealPlan(m)).toBe(true);
		expect(isMealPlan('')).toBe(false);
		expect(isMealPlan('3食付')).toBe(false);
	});
});

// mealKindOf（公式サイトのプラン一覧の食事区分・2026-11-18）
describe('mealKindOf', () => {
	it('お食事設定を優先する', () => {
		expect(mealKindOf({ hasDinner: true, includesBreakfast: true, mealPlan: '素泊' })).toBe('both');
		expect(mealKindOf({ hasDinner: false, includesBreakfast: true })).toBe('breakfast');
		expect(mealKindOf({ hasDinner: false, includesBreakfast: false })).toBe('none');
		expect(mealKindOf({ hasDinner: true, includesBreakfast: false })).toBe('dinner');
	});
	it('設定が無ければ meal_plan の文字で判定する', () => {
		expect(mealKindOf({ mealPlan: '2食' })).toBe('both');
		expect(mealKindOf({ mealPlan: '朝食付' })).toBe('breakfast');
		expect(mealKindOf({ mealPlan: '夕食付' })).toBe('dinner');
		expect(mealKindOf({ mealPlan: '素泊まり' })).toBe('none');
	});
});
