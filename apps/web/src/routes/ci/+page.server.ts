import { fail, redirect } from '@sveltejs/kit';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { answersFromForm, type PcProfile } from '$lib/precheckin';
import { pcGuestProfile, pcNotifyFacility, pcSaveAnswers, resolvePrecheckin } from '$lib/server/precheckin';
import type { Actions, PageServerLoad } from './$types';

// ① ご予約内容の確認・修正（連絡先・到着予定時刻・宿からの質問への回答）。
// 修正は book.precheckins.answers に保存するだけで、PMS の顧客マスタ（core.guests）は書き換えない（スタッフが確認して反映・P5）。
// 顧客マスタの 郵便番号・住所・生年月日・領収書宛名（欄に最初から入れる）
export const load: PageServerLoad = async (event) => {
	const r = await resolvePrecheckin(event);
	const empty: PcProfile = {};
	return { profile: 'ctx' in r ? await pcGuestProfile(r.token).catch(() => empty) : empty };
};

export const actions: Actions = {
	save: async (event) => {
		const r = await resolvePrecheckin(event);
		if (!('ctx' in r)) return fail(400, { error: r.error as string, field: null as string | null });
		if (!r.ctx.editable) return fail(400, { error: 'closed', field: null });
		const form = await event.request.formData();
		const answers = answersFromForm(form, getLocale());
		// 伺い項目（住所・生年月日・男女人数）はどれも任意（2026-11-28 指示）。形の確かめは RPC
		// 宿からの質問もどれも任意（2026-11-28 指示）。選択肢形式の答えが選択肢にあるかは RPC が確かめる
		const res = await pcSaveAnswers(r.token, answers, event.cookies);
		// DB の男女人数の不足は field = 'gender' で返る。画面の文言は gender_required にそろえる
		if (!res.ok) return fail(400, { error: res.field === 'gender' ? 'gender_required' : res.error, field: res.field ?? null });
		// 回答済み（② まで送信済み）のあとの修正なら宿へ知らせる（未回答のうちは DB が何もしない・失敗しても保存は成功のまま）
		await pcNotifyFacility(event, r.token);
		redirect(303, localizeHref('/ci/meals'));
	}
};
