import { fail, redirect } from '@sveltejs/kit';
import { members } from '$lib/server/store';
import { setSession } from '$lib/server/session';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyProfile } from '$lib/server/supabase-data';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// OTP 再送クールダウン（cookie の存在＝クールダウン中。maxAge で自動失効）
const OTP_COOLDOWN = 'ab_otp_cooldown';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user?.role === 'member') redirect(303, url.searchParams.get('next') ?? '/account');
	return { authMode: AUTH_MODE };
};

export const actions: Actions = {
	// デモ: email + パスワード（AUTH_MODE=demo のときのみ）
	login: async ({ request, cookies, url }) => {
		if (AUTH_MODE !== 'demo') return fail(400, { message: m.auth_otp_error_config() });
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const member = members.find((me) => me.email === email && me.password === password);
		if (!member) return fail(401, { message: m.error_login_failed(), email });
		setSession(cookies, { id: member.id, role: 'member', name: member.name });
		redirect(303, url.searchParams.get('next') ?? '/account');
	},

	// supabase: step1 メールアドレス → 8桁 OTP を送信（コード長は Supabase の Email OTP 設定に従う）
	sendCode: async (event) => {
		const { request, cookies } = event;
		if (AUTH_MODE !== 'supabase') return fail(400, { message: m.auth_otp_error_config() });
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		if (!EMAIL_RE.test(email)) return fail(400, { step: 'email', email, message: m.auth_otp_error_email_invalid() });
		// 60秒クールダウン（再送含む）
		if (cookies.get(OTP_COOLDOWN)) return fail(429, { step: 'code', email, message: m.auth_otp_resend_wait() });
		let client;
		try {
			client = createSupabaseServerClient(event);
		} catch {
			return fail(503, { step: 'email', email, message: m.auth_otp_error_config() });
		}
		const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
		if (error) return fail(502, { step: 'email', email, message: m.auth_otp_error_send() });
		cookies.set(OTP_COOLDOWN, '1', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 });
		return { step: 'code', email };
	},

	// supabase: step2 8桁コードを検証 → 会員判定して遷移先を決める
	verify: async (event) => {
		const { request, url } = event;
		if (AUTH_MODE !== 'supabase') return fail(400, { message: m.auth_otp_error_config() });
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const token = String(form.get('token') ?? '').trim();
		if (!EMAIL_RE.test(email) || !token) return fail(400, { step: 'code', email, message: m.auth_otp_error_code_invalid() });

		const client = createSupabaseServerClient(event);
		const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
		if (error || !data.user) return fail(401, { step: 'code', email, message: m.auth_otp_error_code_invalid() });

		// 会員判定: my_profile が通れば book.members あり＝会員。
		let isMember = false;
		try {
			await sbMyProfile(client);
			isMember = true;
		} catch {
			isMember = false;
		}
		// 未登録は会員登録（プロフィール入力）へ。OTP セッションは維持される。
		if (!isMember) redirect(303, '/auth/register');

		// hooks が会員と解決できるよう user_metadata.member を同期（yamado-one 経由の会員含む）
		const meta = data.user.user_metadata as { member?: boolean } | null;
		if (meta?.member !== true) {
			try {
				await client.auth.updateUser({ data: { member: true } });
			} catch {
				/* 失敗しても次回ログイン/登録で再同期される */
			}
		}
		redirect(303, url.searchParams.get('next') ?? '/account');
	}
};
