import { redirect } from '@sveltejs/kit';
import { setSession } from '$lib/server/session';
import type { Actions } from './$types';

export const actions: Actions = {
	// デモ：ワンクリックログイン。本実装は rms と同じ社内 Auth（facility_admin / staff ロール）
	admin: async ({ cookies }) => {
		setSession(cookies, { id: 'admin-demo', role: 'admin', name: '管理者' });
		redirect(303, '/admin');
	},
	staff: async ({ cookies }) => {
		setSession(cookies, { id: 'staff-demo', role: 'staff', name: 'スタッフ' });
		redirect(303, '/admin');
	}
};
