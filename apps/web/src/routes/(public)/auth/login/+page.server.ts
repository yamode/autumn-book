import { fail, redirect } from '@sveltejs/kit';
import { members, withdrawnMembers } from '$lib/server/store';
import { setSession } from '$lib/server/session';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyProfile } from '$lib/server/supabase-data';
import * as m from '$lib/paraglide/messages';
import { clientIp, memberOtpSendAllowed, memberOtpVerifyLocked, memberOtpVerifyResult } from '$lib/server/login-rate-limit';
import { checkTurnstile } from '$lib/server/turnstile';
import { signCookieValue, verifyCookieValue } from '$lib/server/signed-cookie';
import { safeNext } from '$lib/safe-next';
import type { Actions, PageServerLoad } from './$types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// OTP 再送クールダウン（cookie の存在＝クールダウン中。maxAge で自動失効）
const OTP_COOLDOWN = 'ab_otp_cooldown';
// 最初の画面で Turnstile を通ったメールアドレス（署名付き）。コード入力画面の再送で Turnstile を出さないために使う
const OTP_HUMAN = 'ab_otp_human';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user?.role === 'member') redirect(303, safeNext(url.searchParams.get('next'), '/account'));
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
		// 退会済み（論理削除）はログイン不可
		if (!member || withdrawnMembers.has(member.id)) return fail(401, { message: m.error_login_failed(), email });
		await setSession(cookies, { id: member.id, role: 'member', name: member.name });
		redirect(303, safeNext(url.searchParams.get('next'), '/account'));
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
		// Turnstile（未設定なら素通り）と、サーバ側の送信数の制限（Cookie を捨てても効く・未登録メールでも同じ応答）。
		// コード入力画面からの再送は、最初の画面で Turnstile を通ったこと（同じメールアドレスの署名付き Cookie）で代える
		// （同じ画面で2回目の確認を出さない・2026-11-02）。送信数の制限とクールダウンは再送にも効く
		const ip = clientIp(request);
		const passedFor = await verifyCookieValue(OTP_HUMAN, cookies.get(OTP_HUMAN));
		const resend = form.get('resend') === '1' && passedFor === email.toLowerCase();
		if (!resend && !(await checkTurnstile(form, ip)).ok) return fail(400, { step: 'email', email, message: m.auth_turnstile_failed() });
		if (!(await memberOtpSendAllowed(event.platform, email, ip))) return fail(429, { step: 'email', email, message: m.auth_otp_rate_limited() });
		let client;
		try {
			client = createSupabaseServerClient(event);
		} catch {
			return fail(503, { step: 'email', email, message: m.auth_otp_error_config() });
		}
		const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
		if (error) return fail(502, { step: 'email', email, message: m.auth_otp_error_send() });
		cookies.set(OTP_COOLDOWN, '1', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 });
		// 再送で Turnstile を省くための印（このメールアドレスで確認済み・15分）。最初の送信のときだけ付け、再送では延ばさない
		if (!resend) {
			cookies.set(OTP_HUMAN, await signCookieValue(OTP_HUMAN, email.toLowerCase()), {
				path: '/auth',
				httpOnly: true,
				secure: true,
				sameSite: 'lax',
				maxAge: 15 * 60
			});
		}
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

		// 同じメールへの検証の失敗が続いたら止める（10 分 10 回）
		if (await memberOtpVerifyLocked(event.platform, email)) return fail(429, { step: 'code', email, message: m.auth_otp_rate_limited() });
		const client = createSupabaseServerClient(event);
		const { data, error } = await client.auth.verifyOtp({ email, token, type: 'email' });
		await memberOtpVerifyResult(event.platform, email, !error && Boolean(data.user));
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
		redirect(303, safeNext(url.searchParams.get('next'), '/account'));
	}
};
