import { describe, expect, it } from 'vitest';
import { matchesMeal, mealKey, mealOptions } from './meal-filter';

const plan = (mealPlan: string, extra: { dinnerCourse?: string; includesBreakfast?: boolean; hasDinner?: boolean } = {}) => ({ mealPlan, ...extra });

describe('meal-filter', () => {
	const serenade = plan('2食', { includesBreakfast: true, hasDinner: true, dinnerCourse: 'スタンダードコース' });
	const minuet = plan('2食', { includesBreakfast: true, hasDinner: true, dinnerCourse: 'カジュアルコース' });
	const breakfast = plan('朝食', { includesBreakfast: true, hasDinner: false });
	const roomOnly = plan('素泊', { includesBreakfast: false, hasDinner: false });

	it('お食事の設定から区分とコースを作る', () => {
		expect(mealKey(serenade)).toBe('half:スタンダードコース');
		expect(mealKey(breakfast)).toBe('breakfast');
		expect(mealKey(roomOnly)).toBe('none');
	});

	it('設定が読めないときは meal_plan の文字から判断する', () => {
		expect(mealKey(plan('夕朝食付'))).toBe('half');
		expect(mealKey(plan('素泊まり'))).toBe('none');
		expect(mealKey(plan('不明'))).toBeNull();
	});

	it('選択肢は重複なく 2食付き → 朝食付き → 素泊まりの順', () => {
		const options = mealOptions([roomOnly, serenade, breakfast, minuet, { ...serenade }]);
		expect(options.map((o) => o.key)).toEqual(['half:スタンダードコース', 'half:カジュアルコース', 'breakfast', 'none']);
	});

	it('絞り込み', () => {
		expect(matchesMeal(serenade, undefined)).toBe(true);
		expect(matchesMeal(serenade, 'half:スタンダードコース')).toBe(true);
		expect(matchesMeal(minuet, 'half:スタンダードコース')).toBe(false);
		expect(matchesMeal(minuet, 'half')).toBe(true);
		expect(matchesMeal(breakfast, 'none')).toBe(false);
	});
});
