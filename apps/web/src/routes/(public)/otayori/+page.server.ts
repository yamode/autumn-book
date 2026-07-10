import { fail } from '@sveltejs/kit';
import { otayoriSubmit } from '$lib/server/store';
import { submitOtayori as sbSubmitOtayori } from '$lib/server/supabase-data';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
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
	submit: async (event) => {
		const { request, locals } = event;
		// 会員（member）のみ投稿可。staff/admin・未ログインは拒否（設計書 §2）
		if (!locals.user) return fail(401, { message: m.otayori_error_not_member() });
		if (locals.user.role !== 'member') return fail(403, { message: m.otayori_staff_no_post() });

		const form = await request.formData();
		const body = String(form.get('body') ?? '');
		const radioName = String(form.get('radioName') ?? '');

		if (MEMBER_SUPABASE) {
			try {
				await sbSubmitOtayori(createSupabaseServerClient(event), body, radioName || undefined);
			} catch (e) {
				const msg = e instanceof Error ? e.message : '';
				const message = msg.includes('too_many_pending')
					? m.otayori_error_too_many_pending()
					: msg.includes('not_member')
						? m.otayori_error_not_member()
						: m.otayori_error_invalid();
				return fail(400, { message, body, radioName });
			}
			return { submitted: true };
		}

		const res = otayoriSubmit(locals.user.id, body, radioName);
		if ('error' in res) {
			const message = res.error === 'too_many_pending' ? m.otayori_error_too_many_pending() : m.otayori_error_invalid();
			return fail(400, { message, body, radioName });
		}
		return { submitted: true };
	}
};
