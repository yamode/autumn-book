import { fail, redirect } from '@sveltejs/kit';
import { registerMember } from '$lib/server/store';
import { setSession } from '$lib/server/session';
import { AUTH_MODE, createSupabaseServerClient, getSupabaseUser } from '$lib/server/auth';
import { sbMyProfile, sbRegisterMember } from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OTP_COOLDOWN = 'ab_otp_cooldown';

export const load: PageServerLoad = async ({ locals, url }) => {
	// 既に会員ならマイページへ
	if (locals.user?.role === 'member') redirect(303, '/account');

	// 予約完了画面からの導線：入力済み情報をプリフィル（設計書 §3.6）
	const prefill = {
		email: url.searchParams.get('email') ?? '',
		name: url.searchParams.get('name') ?? ''
	};

	if (AUTH_MODE === 'supabase') {
		// OTP 認証済み・未登録なら、いきなりプロフィール入力から
		if (locals.pendingAuthUser) {
			return { authMode: AUTH_MODE, step: 'profile', email: locals.pendingAuthUser.email, prefill };
		}
		return { authMode: AUTH_MODE, step: 'email', email: '', prefill };
	}

	return { authMode: AUTH_MODE, step: 'demo', email: '', prefill };
};

export const actions: Actions = {
	// supabase: step1 メールアドレス → 8桁 OTP を送信（コード長は Supabase の Email OTP 設定に従う）
	sendCode: async (event) => {
		const { request, cookies } = event;
		if (AUTH_MODE !== 'supabase') return fail(400, { message: m.auth_otp_error_config() });
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		if (!EMAIL_RE.test(email)) return fail(400, { step: 'email', email, message: m.auth_otp_error_email_invalid() });
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

	// supabase: step2 コード検証 → 既存会員はマイページ、未登録はプロフィール入力へ
	verify: async (event) => {
		const { request } = event;
		if (AUTH_MODE !== 'supabase') return fail(400, { message: m.auth_otp_error_config() });
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const token = String(form.get('token') ?? '').trim();
		if (!EMAIL_RE.test(email) || !token) return fail(400, { step: 'code', email, message: m.auth_otp_error_code_invalid() });

		const client = createSupabaseServerClient(event);
		const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
		if (error || !data.user) return fail(401, { step: 'code', email, message: m.auth_otp_error_code_invalid() });

		// 既に会員か判定（my_profile が通れば book.members あり）
		let isMember = false;
		try {
			await sbMyProfile(client);
			isMember = true;
		} catch {
			isMember = false;
		}
		if (isMember) {
			// 既に会員なら（yamado-one 等）会員フラグを同期してマイページへ
			const meta = data.user.user_metadata as { member?: boolean } | null;
			if (meta?.member !== true) {
				await client.auth.updateUser({ data: { member: true } }).catch(() => {});
			}
			redirect(303, '/account');
		}
		// 未登録 → プロフィール入力ステップへ
		return { step: 'profile', email };
	},

	// 会員登録本体。supabase = プロフィール入力（OTP 済み）→ register_member。demo = 従来。
	register: async (event) => {
		const { request, cookies } = event;
		const form = await request.formData();

		if (AUTH_MODE === 'supabase') {
			const got = await getSupabaseUser(event);
			if (!got) return fail(401, { step: 'email', message: m.auth_otp_error_config() });
			const name = String(form.get('name') ?? '').trim();
			const kana = String(form.get('kana') ?? '').trim();
			const phone = String(form.get('phone') ?? '').trim();
			const mailOptIn = form.get('mailOptIn') === 'on';
			// email も持たせて demo フォームと values 型を揃える（プロフィール入力では email は編集不可）
			const values = { name, kana, phone, email: got.user.email ?? '' };
			const errors: Record<string, string> = {};
			if (!name) errors.name = m.error_name_required();
			if (!kana) errors.kana = m.error_kana_required();
			if (Object.keys(errors).length > 0) return fail(400, { step: 'profile', email: got.user.email, errors, values });

			let welcome = true;
			try {
				// member_code 採番・email 名寄せ・入会500pt は RPC が一元処理
				await sbRegisterMember(got.client, { name, kana, phone, mailOptIn, locale: getLocale() });
			} catch (e) {
				const msg = e instanceof Error ? e.message : '';
				if (msg.includes('already_registered')) {
					welcome = false; // 既に会員（別導線で登録済み）→ そのままマイページへ
				} else {
					return fail(400, { step: 'profile', email: got.user.email, errors: {}, values, message: m.auth_register_failed() });
				}
			}
			// hooks が会員と解決できるよう user_metadata を同期
			await got.client.auth.updateUser({ data: { name, member: true } }).catch(() => {});
			redirect(303, welcome ? '/account?welcome=1' : '/account');
		}

		// demo: email + パスワード + プロフィールを一括登録
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
		if (Object.keys(errors).length > 0) return fail(400, { step: 'demo', errors, values: input });

		const result = registerMember(input);
		if ('error' in result) {
			// LocalizedString は string の branded subtype のため、明示的に string へキャスト
			const dupErrors: Record<string, string> = { email: m.error_email_duplicate() as string };
			return fail(409, { step: 'demo', errors: dupErrors, values: input });
		}
		// 本実装：core.guest_identities 照合による既存ゲスト名寄せがここで走る（設計書 §3.2）
		setSession(cookies, { id: result.id, role: 'member', name: result.name });
		redirect(303, '/account?welcome=1');
	}
};
