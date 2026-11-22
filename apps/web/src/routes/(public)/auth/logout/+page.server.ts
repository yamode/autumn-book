import { redirect } from '@sveltejs/kit';
import { clearSession } from '$lib/server/session';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { pauseSharedSso } from '$lib/server/admin-shared-sso';
import { safeNext } from '$lib/safe-next';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		clearSession(event.cookies); // デモ会員セッション
		// 管理画面のログアウトは area=admin を送る（管理画面と会員は別の cookie・2026-11-22）。
		// 押した側のログインだけを終える（管理画面でログアウトしてもマイページのログインは残る。逆も同じ）
		const area = (await event.request.formData().catch(() => null))?.get('area') === 'admin' ? 'admin' : 'member';
		if (AUTH_MODE === 'supabase') {
			if (area === 'admin') {
				// PMS などの共有セッションが残っていても、すぐ管理画面に自動ログインし直さないよう印を付ける（docs/auth-hardening.md §7.6）
				await pauseSharedSso(event).catch(() => undefined);
			}
			try {
				await createSupabaseServerClient(event, area).auth.signOut();
			} catch {
				/* 未ログイン等は無視 */
			}
		}
		const next = safeNext(event.url.searchParams.get('next'), '');
		redirect(303, next ? `/auth/login?next=${encodeURIComponent(next)}` : '/');
	}
};
