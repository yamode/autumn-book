import { fail, redirect } from '@sveltejs/kit';
import { registerMember } from '$lib/server/store';
import { setSession } from '$lib/server/session';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// 予約完了画面からの導線：入力済み情報をプリフィル（設計書 §3.6）
	return {
		prefill: {
			email: url.searchParams.get('email') ?? '',
			name: url.searchParams.get('name') ?? ''
		}
	};
};

export const actions: Actions = {
	register: async ({ request, cookies }) => {
		const form = await request.formData();
		const input = {
			email: String(form.get('email') ?? '').trim(),
			password: String(form.get('password') ?? ''),
			name: String(form.get('name') ?? '').trim(),
			kana: String(form.get('kana') ?? '').trim(),
			phone: String(form.get('phone') ?? '').trim(),
			mailOptIn: form.get('mailOptIn') === 'on'
		};
		const errors: Record<string, string> = {};
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) errors.email = m.error_email_invalid();
		if (input.password.length < 8) errors.password = m.error_password_short();
		if (!input.name) errors.name = m.error_name_required();
		if (!input.kana) errors.kana = m.error_kana_required();
		if (Object.keys(errors).length > 0) return fail(400, { errors, values: input });

		const result = registerMember(input);
		if ('error' in result) {
			// LocalizedString は string の branded subtype のため、明示的に string へキャスト
			const dupErrors: Record<string, string> = { email: m.error_email_duplicate() as string };
			return fail(409, { errors: dupErrors, values: input });
		}
		// 本実装：core.guest_identities 照合による既存ゲスト名寄せがここで走る（設計書 §3.2）
		setSession(cookies, { id: result.id, role: 'member', name: result.name });
		redirect(303, '/account?welcome=1');
	}
};
