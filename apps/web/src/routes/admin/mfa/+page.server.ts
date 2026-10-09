// 管理画面の二段階認証のコード入力（ログイン後・aal1 → aal2・docs/auth-hardening.md §7.2）。
// 第2要素を登録している admin / staff は、ここでコードを入れるまでほかの管理画面を開けない（hooks.server.ts の関所）。
import { fail, redirect } from '@sveltejs/kit';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { adminMfaErrorText, normalizeTotpCode, safeAdminNext } from '$lib/admin-mfa';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const { locals, url } = event;
	const next = safeAdminNext(url.searchParams.get('next'));
	// demo・未ログインはこの画面に用が無い（レイアウトがログインへ送る）
	if (AUTH_MODE !== 'supabase' || !locals.adminAal) redirect(303, '/admin');
	if (locals.adminAal.verifiedFactors === 0) redirect(303, '/admin/security');
	if (locals.adminAal.current === 'aal2') redirect(303, next);

	try {
		const { data, error } = await createSupabaseServerClient(event).auth.mfa.listFactors();
		if (error) throw error;
		return {
			next,
			factors: data.totp.map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null })),
			loadError: null as string | null
		};
	} catch (e) {
		return { next, factors: [], loadError: adminMfaErrorText(e as { code?: string; message?: string }) };
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

		const { error } = await createSupabaseServerClient(event).auth.mfa.challengeAndVerify({ factorId, code });
		if (error) return fail(400, { message: adminMfaErrorText(error) });
		// 成功すると aal2 のトークンが cookie に書き戻される（createSupabaseServerClient の setAll）
		redirect(303, next);
	}
};
