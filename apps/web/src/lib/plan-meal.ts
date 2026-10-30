// 新規プラン（Book 先行）で選べる食事区分。booking.rate_plans.meal_plan の既存値と同じ（DB の book.admin_create_plan でも検査する）。
export const MEAL_PLANS = ['素泊まり', '朝食付', '夕食付', '2食付'] as const;
export type MealPlan = (typeof MEAL_PLANS)[number];

export function isMealPlan(v: string): v is MealPlan {
	return (MEAL_PLANS as readonly string[]).includes(v);
}

/** プラン名の長さの上限（DB と同じ） */
export const PLAN_NAME_MAX = 60;
