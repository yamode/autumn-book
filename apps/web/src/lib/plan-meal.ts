// 新規プラン（Book 先行）で選べる食事区分。booking.rate_plans.meal_plan の既存値と同じ（DB の book.admin_create_plan でも検査する）。
export const MEAL_PLANS = ['素泊まり', '朝食付', '夕食付', '2食付'] as const;
export type MealPlan = (typeof MEAL_PLANS)[number];

export function isMealPlan(v: string): v is MealPlan {
	return (MEAL_PLANS as readonly string[]).includes(v);
}

/** プラン名の長さの上限（DB と同じ） */
export const PLAN_NAME_MAX = 60;

/**
 * 公式サイトのプラン一覧で使う食事の区分（2026-11-18）。
 * 表示順の「おすすめ順」で、同じ表示順のプランは 2食付き → 夕食のみ → 朝食付き → 素泊まり の順に並べ、
 * 「食事」の絞り込みにも使う。プランのお食事設定（hasDinner / includesBreakfast）を優先し、無ければ meal_plan の文字で判定する。
 */
export type MealKind = 'both' | 'dinner' | 'breakfast' | 'none';
export const MEAL_KINDS: readonly MealKind[] = ['both', 'dinner', 'breakfast', 'none'];

export function mealKindOf(plan: { hasDinner?: boolean; includesBreakfast?: boolean; mealPlan?: string }): MealKind {
	let dinner = plan.hasDinner;
	let breakfast = plan.includesBreakfast;
	const text = plan.mealPlan ?? '';
	if (dinner === undefined) dinner = /2食|二食|夕食|夕朝/.test(text);
	if (breakfast === undefined) breakfast = /2食|二食|朝食|夕朝/.test(text);
	if (dinner) return breakfast ? 'both' : 'dinner';
	return breakfast ? 'breakfast' : 'none';
}

export function isMealKind(v: string | null | undefined): v is MealKind {
	return !!v && (MEAL_KINDS as readonly string[]).includes(v);
}
