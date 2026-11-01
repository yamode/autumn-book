import { describe, expect, it } from 'vitest';
import { defaultPlanMeals, planMealsFromForm, planMealsOf } from './plan-meals';

const STD = '11111111-1111-4111-8111-111111111111';
const FULL = '22222222-2222-4222-8222-222222222222';
const courses = [
	{ id: STD, name: 'スタンダード', description: '全8皿' },
	{ id: FULL, name: 'フルコース', description: '' }
];

describe('planMealsOf', () => {
	it('未設定・形の違う値は null', () => {
		expect(planMealsOf(null)).toBeNull();
		expect(planMealsOf('x')).toBeNull();
		expect(planMealsOf([])).toBeNull();
	});
	it('夕食コースは uuid だけ受け付ける', () => {
		expect(planMealsOf({ breakfast: true, dinnerRateId: STD })).toEqual({ breakfast: true, dinnerRateId: STD });
		expect(planMealsOf({ breakfast: 'yes', dinnerRateId: 'abc' })).toEqual({ breakfast: false, dinnerRateId: null });
	});
});

describe('defaultPlanMeals', () => {
	it('2食は朝食付き・自動判定のコース名から選ぶ', () => {
		expect(defaultPlanMeals('2食', 'スタンダードコース', courses)).toEqual({ breakfast: true, dinnerRateId: STD });
		expect(defaultPlanMeals('2食', 'フルコース', courses)).toEqual({ breakfast: true, dinnerRateId: FULL });
		expect(defaultPlanMeals('2食', '特日スタンダードコース', courses)).toEqual({ breakfast: true, dinnerRateId: STD });
	});
	it('合うコースが無ければ夕食なし', () => {
		expect(defaultPlanMeals('2食', null, courses)).toEqual({ breakfast: true, dinnerRateId: null });
	});
	it('朝食・素泊は夕食なし', () => {
		expect(defaultPlanMeals('朝食', 'スタンダードコース', courses)).toEqual({ breakfast: true, dinnerRateId: null });
		expect(defaultPlanMeals('素泊', null, courses)).toEqual({ breakfast: false, dinnerRateId: null });
	});
});

describe('planMealsFromForm', () => {
	const fd = (o: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.set(k, v);
		return f;
	};
	it('朝食のチェックと夕食コース', () => {
		expect(planMealsFromForm(fd({ breakfast: 'on', dinner: STD }), courses)).toEqual({ meals: { breakfast: true, dinnerRateId: STD } });
		expect(planMealsFromForm(fd({ dinner: '' }), courses)).toEqual({ meals: { breakfast: false, dinnerRateId: null } });
	});
	it('選択肢に無いコースは断る', () => {
		expect(planMealsFromForm(fd({ dinner: '33333333-3333-4333-8333-333333333333' }), courses)).toHaveProperty('error');
	});
	it('auto=on は未設定に戻す', () => {
		expect(planMealsFromForm(fd({ auto: 'on', breakfast: 'on' }), courses)).toEqual({ meals: null });
	});
});
