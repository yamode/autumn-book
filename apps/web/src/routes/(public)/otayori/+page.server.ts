import { fail } from '@sveltejs/kit';
import { otayoriSubmit } from '$lib/server/store';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// ロール別の表示分岐（設計書 §6 / §2）:
	//   未ログイン → 会員登録 CTA、member → 投稿フォーム、staff/admin → 運営アカウント案内
	return {
		isLoggedIn: !!locals.user,
		role: locals.user?.role ?? null
	};
};

export const actions: Actions = {
	submit: async ({ request, locals }) => {
		// 会員（member）のみ投稿可。staff/admin・未ログインは拒否（設計書 §2）
		if (!locals.user) return fail(401, { message: m.otayori_error_not_member() });
		if (locals.user.role !== 'member') return fail(403, { message: m.otayori_staff_no_post() });

		const form = await request.formData();
		const body = String(form.get('body') ?? '');
		const radioName = String(form.get('radioName') ?? '');

		const res = otayoriSubmit(locals.user.id, body, radioName);
		if ('error' in res) {
			const message = res.error === 'too_many_pending' ? m.otayori_error_too_many_pending() : m.otayori_error_invalid();
			return fail(400, { message, body, radioName });
		}
		return { submitted: true };
	}
};
