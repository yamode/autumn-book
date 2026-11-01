// プランの「お食事」設定（2026-11-01・v0.231.0）。朝食が付くか、夕食は RMS のどの食事コースか。
// DB は book.plan_contents.meals（jsonb・null＝料金テンプレートどおり）。公式サイトは book.v_plans の
// includes_breakfast / has_dinner / dinner_course を読む（autumn-shared 20261101132329）。
// 料金（rms の meal_plan）はこの設定で変わらない。表示と申し送りのための設定。

export type PlanMeals = {
	breakfast: boolean;
	/** 夕食のコース（public.rms_meal_rates.id・同じ施設の「夕食」）。null は夕食なし */
	dinnerRateId: string | null;
};

/** RMS の夕食コース（選択肢） */
export type DinnerCourseOption = { id: string; name: string; description: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** DB の jsonb → 設定（形が違えば null＝未設定） */
export function planMealsOf(v: unknown): PlanMeals | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const o = v as Record<string, unknown>;
	const rate = typeof o.dinnerRateId === 'string' && UUID_RE.test(o.dinnerRateId) ? o.dinnerRateId : null;
	return { breakfast: o.breakfast === true, dinnerRateId: rate };
}

/** 未設定のときに編集欄へ出す初期値（料金テンプレートの meal_plan と、名前の合う夕食コースから推定） */
export function defaultPlanMeals(mealPlan: string, autoCourse: string | null, courses: DinnerCourseOption[]): PlanMeals {
	const breakfast = mealPlan === '2食' || mealPlan === '朝食';
	if (mealPlan !== '2食') return { breakfast, dinnerRateId: null };
	// 「スタンダードコース」→ スタンダード、「フルコース」はそのまま、「特日スタンダードコース」→ 末尾が合うスタンダード
	const auto = autoCourse ?? '';
	const base = auto.replace(/コース$/, '');
	const hit =
		courses.find((c) => c.name === auto || c.name === base) ??
		courses.find((c) => c.name && (auto.endsWith(c.name) || (base && base.endsWith(c.name))));
	return { breakfast, dinnerRateId: hit?.id ?? null };
}

/** フォーム → 設定。夕食コースは選択肢にあるものだけ。auto=on なら null（料金テンプレートどおりに戻す） */
export function planMealsFromForm(form: FormData, courses: DinnerCourseOption[]): { meals: PlanMeals | null } | { error: string } {
	if (form.get('auto') === 'on') return { meals: null };
	const dinner = String(form.get('dinner') ?? '');
	if (dinner && !courses.some((c) => c.id === dinner)) return { error: '夕食のコースを選び直してください（RMS の食事コースにありません）。' };
	return { meals: { breakfast: form.get('breakfast') === 'on', dinnerRateId: dinner || null } };
}
