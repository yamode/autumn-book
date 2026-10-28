import { fail, redirect } from '@sveltejs/kit';
import { localizeHref } from '$lib/paraglide/runtime';
import { checkMealChoices, mealChoicesFromForm } from '$lib/precheckin';
import { pcSaveMeals, resolvePrecheckin } from '$lib/server/precheckin';
import type { Actions } from './$types';

// ② 夕食・朝食の時間（送信後は ③ 貸切風呂へ）。承認なしで PMS の食事（pms.stay_meals.meal_time）に確定する（docs/pre-checkin.md §5.2）。
// 受付上限はここでも見るが（分かりやすい文言のため）、最終判定は RPC book.precheckin_save_meals の中（同時送信を lock で防ぐ）。
export const actions: Actions = {
	save: async (event) => {
		const r = await resolvePrecheckin(event);
		if (!('ctx' in r)) return fail(400, { error: r.error as string, time: null as string | null });
		if (!r.ctx.editable) return fail(400, { error: 'closed', time: null });
		const choices = mealChoicesFromForm(await event.request.formData());
		const check = checkMealChoices(r.ctx, choices);
		if (!check.ok) return fail(400, { error: check.error, time: check.time ?? null });
		const res = await pcSaveMeals(r.token, choices.filter((c) => c.time));
		if (!res.ok) return fail(400, { error: res.error, time: res.time ?? null });
		redirect(303, localizeHref('/ci/bath'));
	}
};
