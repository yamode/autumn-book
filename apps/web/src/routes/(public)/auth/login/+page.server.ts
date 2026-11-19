import { legacyMigrationOpen } from '$lib/server/legacy-migration-flag';
import { fail, redirect } from '@sveltejs/kit';
import { members, withdrawnMembers } from '$lib/server/store';
import { setSession } from '$lib/server/session';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyProfile } from '$lib/server/supabase-data';
import * as m from '$lib/paraglide/messages';
import { clientIp, hashKeyPart, ipKey, RATE_RULES, rateCheck, rateHit, rateReset, memberOtpSendAllowed, memberOtpVerifyLocked, memberOtpVerifyResult } from '$lib/server/login-rate-limit';
import { checkTurnstile } from '$lib/server/turnstile';
import { signCookieValue, verifyCookieValue } from '$lib/server/signed-cookie';
import { safeNext } from '$lib/safe-next';
import { bookingConsentNext } from '$lib/server/booking-mcp/oauth';
import { MEMBER_LOGIN_METHODS, memberLoginDestination, memberMfaPath, memberPasskeysAvailable } from '$lib/server/member-login';
import { smsTarget } from '$lib/precheckin-sms';
import { loginMemberBySms, memberSmsAvailable, memberSmsDefault, memberSmsSendAllowed, rememberMemberSmsDefault, startMemberSms } from '$lib/server/member-sms';
import { memberLoginCopy } from '$lib/member-login-copy';
import { getLocale } from '$lib/paraglide/runtime';
import type { Actions, PageServerLoad } from './$types';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
// OTP 再送クールダウン（cookie の存在＝クールダウン中。maxAge で自動失効）
const OTP_COOLDOWN = 'ab_otp_cooldown';
// 最初の画面で Turnstile を通ったメールアドレス（署名付き）。コード入力画面の再送で Turnstile を出さないために使う
const OTP_HUMAN = 'ab_otp_human';
const USE_BOOK_MEMBER = 'このメールアドレスは運営用アカウントです。YAMADOに連携する山人Book会員のメールアドレスを入力してください。';

export const load: PageServerLoad = async (event) => {
	const { locals, url } = event;
	if (locals.memberMfaPending) redirect(303, memberMfaPath(url.searchParams.get('next') ?? ''));
	if (locals.user?.role === 'member') redirect(303, safeNext(url.searchParams.get('next'), '/account'));
	const role = locals.user?.role;
	const showMemberNotice = (role === 'admin' || role === 'staff') && Boolean(bookingConsentNext(url));
	const smsAvailable = memberSmsAvailable(url);
	if (smsAvailable) event.setHeaders({ 'cache-control': 'private, no-store' });
	return {
		authMode: AUTH_MODE, accountNotice: showMemberNotice ? USE_BOOK_MEMBER : null, memberLoginMethods: MEMBER_LOGIN_METHODS,
		passkeys: memberPasskeysAvailable(url), smsAvailable, smsDefault: await memberSmsDefault(event),
		// 旧会員の会員移行の入口（閉じている間はリンクを出さない）
		migrationOpen: legacyMigrationOpen()
	};
};

export const actions: Actions = {
	sendSms: async (event) => {
		const step = 'sms' as const;
		const t = memberLoginCopy(getLocale());
		if (!memberSmsAvailable(event.url) || event.locals.user || event.locals.memberMfaPending) {
			return fail(404, { step, message: m.auth_otp_error_config() });
		}
		const form = await event.request.formData();
		const raw = String(form.get('phone') ?? '').trim();
		const phone = raw.length <= 30 ? smsTarget(raw) : null;
		if (!phone) return fail(400, { step, message: t.smsPhoneInvalid });
		if (!(await checkTurnstile(form, clientIp(event.request), { action: 'member-sms', hostname: event.url.hostname })).ok) {
			return fail(400, { step, message: m.auth_turnstile_failed() });
		}
		if (!(await memberSmsSendAllowed(event))) return fail(429, { step, message: m.auth_otp_rate_limited() });
		if (!(await startMemberSms(event, phone).catch(() => false))) return fail(503, { step, message: m.auth_otp_error_send() });
		return { step: 'smsCode' as const };
	},
	verifySms: async (event) => {
		if (!memberSmsAvailable(event.url) || event.locals.user || event.locals.memberMfaPending) {
			return fail(404, { step: 'sms' as const, message: m.auth_otp_error_config() });
		}
		const form = await event.request.formData();
		const destination = await loginMemberBySms(event, form.get('token')).catch(() => null);
		if (!destination) return fail(401, { step: 'smsCode' as const, message: m.auth_otp_error_code_invalid() });
		redirect(303, destination);
	},
	password: async (event) => {
		if (!MEMBER_LOGIN_METHODS) return fail(404, { step: 'password', message: m.auth_otp_error_config() });
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const rejected = { step: 'password', email, message: m.error_login_failed() };
		if (!EMAIL_RE.test(email) || email.length > 254 || !password || password.length > 1024) return fail(400, rejected);
		const ip = clientIp(event.request);
		if (!(await checkTurnstile(form, ip, { action: 'member-password', hostname: event.url.hostname })).ok) {
			return fail(400, { ...rejected, message: m.auth_turnstile_failed() });
		}
		const ipId = ipKey(ip);
		const emailId = await hashKeyPart(email);
		const limits = [[RATE_RULES.memberPasswordIp, ipId], [RATE_RULES.memberPasswordEmail, emailId]] as const;
		if ((await Promise.all(limits.map(([rule, key]) => rateCheck(event.platform, rule, key)))).some((r) => r.locked)) return fail(429, rejected);
		const client = createSupabaseServerClient(event);
		const { data, error } = await client.auth.signInWithPassword({ email, password });
		let next: string | null = null;
		if (!error && data.session && data.user) {
			next = await memberLoginDestination(data.user, data.session.access_token, event.url.searchParams.get('next') ?? '').catch(() => null);
		}
		if (!next) {
			if (data.session) await client.auth.signOut({ scope: 'local' });
			await Promise.all(limits.map(([rule, key]) => rateHit(event.platform, rule, key)));
			return fail(401, rejected);
		}
		await Promise.all(limits.map(([rule, key]) => rateReset(event.platform, rule, key)));
		if (data.user) await rememberMemberSmsDefault(event, data.user.id);
		redirect(303, next);
	},
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
		// Turnstile（未設定なら素通り）と、サーバ側の送信数の制限（Cookie を捨てても効く・未登録メールでも同じ応答）。
		// コード入力画面からの再送は、最初の画面で Turnstile を通ったこと（同じメールアドレスの署名付き Cookie）で代える
		// （同じ画面で2回目の確認を出さない・2026-11-02）。送信数の制限とクールダウンは再送にも効く
		const ip = clientIp(request);
		const passedFor = await verifyCookieValue(OTP_HUMAN, cookies.get(OTP_HUMAN));
		// コードを実際に要求済みの宛先だけをコード入力へ戻す（別の宛先の送信済み表示を防ぐ）。
		if (cookies.get(OTP_COOLDOWN) && passedFor === email.toLowerCase()) {
			return fail(429, { step: 'code', email, message: m.auth_otp_resend_wait() });
		}
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
		if (error) {
			console.warn('[member-otp] Supabase rejected send', { status: error.status, code: error.code });
			return fail(502, { step: 'email', email, message: m.auth_otp_error_send() });
		}
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

		const consentNext = bookingConsentNext(url);
		const role = data.user.app_metadata.role;
		if (consentNext && (role === 'admin' || role === 'staff')) {
			return fail(403, { step: 'email', email: '', message: USE_BOOK_MEMBER });
		}
		const next = url.searchParams.get('next') ?? '';
		let memberDestination: string | null = null;
		if (MEMBER_LOGIN_METHODS && data.session && role !== 'admin' && role !== 'staff') {
			const destination = await memberLoginDestination(data.user, data.session.access_token, next).catch(() => undefined);
			if (destination === undefined) {
				await client.auth.signOut({ scope: 'local' });
				return fail(503, { step: 'email', email, message: m.auth_otp_error_config() });
			}
			memberDestination = destination;
			if (destination) await rememberMemberSmsDefault(event, data.user.id);
			// 二段階認証が済むまで会員RPCを呼べないため、プロフィール参照より先に誘導する。
			if (destination === memberMfaPath(next)) redirect(303, destination);
		}
		// 会員判定: my_profile が通れば book.members あり＝会員。
		let isMember = false;
		try {
			await sbMyProfile(client);
			isMember = true;
		} catch (cause) {
			if (consentNext && (cause as { message?: unknown } | null)?.message !== 'not_member') {
				return fail(503, { step: 'email', email, message: '会員情報を確認できませんでした。時間をおいてやり直してください。' });
			}
			isMember = false;
		}
		// 未登録は会員登録（プロフィール入力）へ。OTP セッションは維持される。
		if (!isMember) redirect(303, consentNext ? `/auth/register?next=${encodeURIComponent(consentNext)}` : '/auth/register');

		// hooks が会員と解決できるよう user_metadata.member を同期（yamado-one 経由の会員含む）
		const meta = data.user.user_metadata as { member?: boolean } | null;
		if (meta?.member !== true) {
			try {
				await client.auth.updateUser({ data: { member: true } });
			} catch {
				/* 失敗しても次回ログイン/登録で再同期される */
			}
		}
		redirect(303, memberDestination ?? safeNext(next, '/account'));
	}
};
