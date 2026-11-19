// 公式サイトの客室・プラン一覧の「お食事で絞り込む」。
// 以前はプランに手入力するタグ（highlight_tags）を並べていたが、入っていないプランが多く中身も重なるため、
// プラン設定の「お食事」（v_plans.includes_breakfast / has_dinner / dinner_course）から自動で作る（2026-11-19 指示）。
import type { RatePlan } from '$lib/types';

export type MealKind = 'half' | 'dinner' | 'breakfast' | 'none' | 'dayuse';

type MealPlanLike = Pick<RatePlan, 'mealPlan' | 'dinnerCourse' | 'includesBreakfast' | 'hasDinner'>;

/** プランの食事の区分。お食事の設定が読めない取得元（デモ等）は meal_plan の文字から判断する。判断できなければ null */
export function mealKind(plan: MealPlanLike): MealKind | null {
	const text = plan.mealPlan ?? '';
	if (text === '日帰り') return 'dayuse';
	let breakfast = plan.includesBreakfast;
	let dinner = plan.hasDinner;
	if (breakfast === undefined && dinner === undefined) {
		if (/2食|夕朝食/.test(text)) return 'half';
		if (text.includes('朝食')) return 'breakfast';
		if (text.includes('素泊')) return 'none';
		return null;
	}
	breakfast ??= false;
	dinner ??= false;
	if (dinner) return breakfast ? 'half' : 'dinner';
	return breakfast ? 'breakfast' : 'none';
}

/** 絞り込みのキー（URL の ?meal=）。夕食付きはコースごとに分ける（例: half:スタンダードコース） */
export function mealKey(plan: MealPlanLike): string | null {
	const kind = mealKind(plan);
	if (!kind) return null;
	const course = plan.dinnerCourse?.trim();
	return (kind === 'half' || kind === 'dinner') && course ? `${kind}:${course}` : kind;
}

export type MealOption = { key: string; kind: MealKind; course: string | null };

const ORDER: MealKind[] = ['half', 'dinner', 'breakfast', 'none', 'dayuse'];

/** 施設のプランにある食事の選択肢（2食付き（コース順はプランの並び順）→ 夕食付き → 朝食付き → 素泊まり → 日帰り） */
export function mealOptions(plans: MealPlanLike[]): MealOption[] {
	const seen = new Map<string, MealOption>();
	for (const plan of plans) {
		const key = mealKey(plan);
		const kind = mealKind(plan);
		if (!key || !kind || seen.has(key)) continue;
		const colon = key.indexOf(':');
		seen.set(key, { key, kind, course: colon >= 0 ? key.slice(colon + 1) : null });
	}
	return [...seen.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/** そのプランが選んだ食事に当てはまるか（未選択は全部）。「half」だけを指定したときはコースを問わない */
export function matchesMeal(plan: MealPlanLike, meal: string | undefined): boolean {
	if (!meal) return true;
	const key = mealKey(plan);
	if (!key) return false;
	return key === meal || (!meal.includes(':') && key.startsWith(`${meal}:`));
}
