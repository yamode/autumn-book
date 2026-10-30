import { describe, expect, it } from 'vitest';
import { MEAL_PLANS, isMealPlan } from './plan-meal';

describe('新規プランの食事区分', () => {
	it('選べる区分だけを通す', () => {
		for (const m of MEAL_PLANS) expect(isMealPlan(m)).toBe(true);
		expect(isMealPlan('')).toBe(false);
		expect(isMealPlan('3食付')).toBe(false);
	});
});
