import { fail, redirect } from '@sveltejs/kit';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { answersFromForm } from '$lib/precheckin';
import { pcSaveAnswers, resolvePrecheckin } from '$lib/server/precheckin';
import type { Actions } from './$types';

// ① ご予約内容の確認・修正（基本情報・到着予定時刻・同伴人数・アレルギー・ご要望）。
// 修正は book.precheckins.answers に保存するだけで、PMS の顧客マスタ（core.guests）は書き換えない（スタッフが確認して反映・P5）。
export const actions: Actions = {
	save: async (event) => {
		const r = await resolvePrecheckin(event);
		if (!('ctx' in r)) return fail(400, { error: r.error as string, field: null as string | null });
		if (!r.ctx.editable) return fail(400, { error: 'closed', field: null });
		const form = await event.request.formData();
		const res = await pcSaveAnswers(r.token, answersFromForm(form, getLocale()));
		if (!res.ok) return fail(400, { error: res.error, field: res.field ?? null });
		redirect(303, localizeHref('/ci/meals'));
	}
};
