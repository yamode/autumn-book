// 管理画面の二段階認証のコード入力（ログイン後・aal1 → aal2・docs/auth-hardening.md §7.2）。
// 第2要素を登録している admin / staff は、ここでコードを入れるまでほかの管理画面を開けない（hooks.server.ts の関所）。
import { fail, redirect } from '@sveltejs/kit';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { adminMfaErrorText, normalizeTotpCode, safeAdminNext } from '$lib/admin-mfa';
import { adminPasskeyAvailable } from '$lib/server/admin-passkeys';
import { RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';
import { logAccessEvent } from '$lib/server/access-log';
import type { Actions, PageServerLoad } from './$types';

// 制限中と間違いで同じ文言にする（制限中かを外から区別させない・ログイン画面と同じ考え方）
const MFA_FAILED_MESSAGE = 'コードが違うか、しばらくの間確認を制限しています。認証アプリの新しいコードで、数分おいてからお試しください。';

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const { locals, url } = event;
	const next = safeAdminNext(url.searchParams.get('next'));
	// demo・未ログインはこの画面に用が無い（レイアウトがログインへ送る）
	if (AUTH_MODE !== 'supabase' || !locals.adminAal) redirect(303, '/admin');
	if (locals.adminAal.verifiedFactors === 0) redirect(303, '/admin/security');
	if (locals.adminAal.current === 'aal2') redirect(303, next);

	// パスキー（登録していて、このアドレスで使えるとき）。認証アプリと両方あればどちらでも確認できる
	const passkeys = locals.adminAal.passkeys ?? 0;
	const passkey = { count: passkeys, usable: passkeys > 0 && adminPasskeyAvailable(event) };
	if ((locals.adminAal.totpFactors ?? locals.adminAal.verifiedFactors) === 0) {
		return { next, passkey, factors: [] as { id: string; friendlyName: string | null }[], loadError: null as string | null };
	}
	try {
		const { data, error } = await createSupabaseServerClient(event).auth.mfa.listFactors();
		if (error) throw error;
		return {
			next,
			passkey,
			factors: data.totp.map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null })),
			loadError: null as string | null
		};
	} catch (e) {
		return { next, passkey, factors: [], loadError: adminMfaErrorText(e as { code?: string; message?: string }) };
	}
};

export const actions: Actions = {
	verify: async (event) => {
		if (AUTH_MODE !== 'supabase' || !event.locals.adminAal) return fail(400, { message: 'この環境では使えません。' });
		const form = await event.request.formData();
		const factorId = String(form.get('factorId') ?? '');
		const code = normalizeTotpCode(String(form.get('code') ?? ''));
		const next = safeAdminNext(String(form.get('next') ?? ''));
		if (!factorId) return fail(400, { message: '認証アプリを選んでください。' });
		if (!code) return fail(400, { message: '認証アプリに表示されている 6 桁の数字を入力してください。' });

		// 1 ユーザー 10 分 5 回の失敗で 15 分止める（6 桁の総当たりを止める・2026-10-31）。ユーザーが分からなければ止めない側に倒す
		const userId = event.locals.user?.id ?? null;
		const user = userId ? { id: userId } : null;
		if (userId && (await rateCheck(event.platform, RATE_RULES.adminMfa, userId)).locked) {
			logAccessEvent(event, { event: 'login_failure', user, status: 429, detail: { reason: 'mfa_locked' } });
			return fail(429, { message: MFA_FAILED_MESSAGE });
		}

		const { error } = await createSupabaseServerClient(event).auth.mfa.challengeAndVerify({ factorId, code });
		if (error) {
			if (userId) await rateHit(event.platform, RATE_RULES.adminMfa, userId);
			logAccessEvent(event, { event: 'login_failure', user, status: 400, detail: { reason: 'mfa_invalid', code: error.code ?? null } });
			return fail(400, { message: adminMfaErrorText(error) });
		}
		if (userId) await rateReset(event.platform, RATE_RULES.adminMfa, userId);
		// 成功すると aal2 のトークンが cookie に書き戻される（createSupabaseServerClient の setAll）
		redirect(303, next);
	}
};
