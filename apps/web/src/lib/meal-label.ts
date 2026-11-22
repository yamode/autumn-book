// プランの食事の札（「2食」「朝食」「素泊」）を表示中の言語で出す（2026-11-22）。
// DB の meal_plan は日本語の短い言葉なので、日本語はそのまま、他の言語は食事の区分から訳す。
import { m } from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import { mealKind } from '$lib/meal-filter';
import type { RatePlan } from '$lib/types';

export function mealChipLabel(plan: Pick<RatePlan, 'mealPlan' | 'dinnerCourse' | 'includesBreakfast' | 'hasDinner'>): string {
	if (getLocale() === 'ja') return plan.mealPlan;
	switch (mealKind(plan)) {
		case 'half': return m.meal_filter_half();
		case 'dinner': return m.plan_meal_dinner();
		case 'breakfast': return m.plan_meal_breakfast();
		case 'none': return m.meal_filter_none();
		case 'dayuse': return m.meal_filter_dayuse();
		default: return plan.mealPlan;
	}
}
