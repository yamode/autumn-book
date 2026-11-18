import { redirect } from '@sveltejs/kit';
import { clearSession } from '$lib/server/session';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { pauseSharedSso } from '$lib/server/admin-shared-sso';
import { safeNext } from '$lib/safe-next';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		clearSession(event.cookies); // デモ会員セッション
		if (AUTH_MODE === 'supabase') {
			// PMS などの共有セッションが残っていても、すぐ管理画面に自動ログインし直さないよう印を付ける（docs/auth-hardening.md §7.6）
			await pauseSharedSso(event).catch(() => undefined);
			// Supabase Auth セッション（管理者）も破棄
			try {
				await createSupabaseServerClient(event).auth.signOut();
			} catch {
				/* 未ログイン等は無視 */
			}
		}
		const next = safeNext(event.url.searchParams.get('next'), '');
		redirect(303, next ? `/auth/login?next=${encodeURIComponent(next)}` : '/');
	}
};
