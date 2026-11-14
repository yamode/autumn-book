import { fail, redirect } from '@sveltejs/kit';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { DEMO_PRECHECKIN_CODE, answersFromForm, missingGuestField, missingQuestion, type PcGuestInfo } from '$lib/precheckin';
import { pcGuestProfile, pcQuestions, pcSaveAnswers, resolvePrecheckin } from '$lib/server/precheckin';
import type { Actions, PageServerLoad } from './$types';

// ① ご予約内容の確認・修正（連絡先・到着予定時刻・宿からの質問への回答）。
// 修正は book.precheckins.answers に保存するだけで、PMS の顧客マスタ（core.guests）は書き換えない（スタッフが確認して反映・P5）。
// 顧客マスタの 郵便番号・住所・生年月日・領収書宛名（欄に最初から入れる）
export const load: PageServerLoad = async (event) => {
	const r = await resolvePrecheckin(event);
	const empty: PcGuestInfo = {};
	return { profile: 'ctx' in r ? await pcGuestProfile(r.token).catch(() => empty) : empty };
};

export const actions: Actions = {
	save: async (event) => {
		const r = await resolvePrecheckin(event);
		if (!('ctx' in r)) return fail(400, { error: r.error as string, field: null as string | null });
		if (!r.ctx.editable) return fail(400, { error: 'closed', field: null });
		const form = await event.request.formData();
		const answers = answersFromForm(form, getLocale());
		// 住所・生年月日は必須（最終判定は RPC）
		// 変更していない欄（送られてこない）は顧客マスタのとおり
		const profile = await pcGuestProfile(r.token).catch((): PcGuestInfo => ({}));
		const missingGuest = missingGuestField({
			address: answers.guest.address || profile.address,
			birthdate: answers.guest.birthdate || profile.birthdate
		});
		if (missingGuest) return fail(400, { error: 'guest_required', field: missingGuest as string | null });
		// 宿からの質問は必須（最終判定は RPC。ここは分かりやすい文言のため・見本も同じ）
		const questions = await pcQuestions(r.ctx.facility.id, r.ctx.bookingCode === DEMO_PRECHECKIN_CODE).catch(() => []);
		const missing = missingQuestion(questions, answers.questions);
		if (missing) return fail(400, { error: 'question_required', field: missing as string | null });
		const res = await pcSaveAnswers(r.token, answers);
		if (!res.ok) return fail(400, { error: res.error, field: res.field ?? null });
		redirect(303, localizeHref('/ci/meals'));
	}
};
