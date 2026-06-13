import { redirect } from '@sveltejs/kit';
import { clearSession } from '$lib/server/session';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		clearSession(event.cookies); // デモ会員セッション
		if (AUTH_MODE === 'supabase') {
			// Supabase Auth セッション（管理者）も破棄
			try {
				await createSupabaseServerClient(event).auth.signOut();
			} catch {
				/* 未ログイン等は無視 */
			}
		}
		redirect(303, '/');
	}
};
