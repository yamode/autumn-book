// 管理者・スタッフの二段階認証の登録状況と、登録の削除（復旧・admin のみ・docs/auth-hardening.md §7.4）。
// スマートフォンを失くした人の登録を別の admin が削除し、本人が /admin/security で登録し直す。
// 削除は service_role の管理 API（lib/server/admin-mfa.ts）で行い、book.admin_audit_logs に admin_mfa_reset を残す。
import { error, fail } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { AdminMfaError, listStaffMfa, resetStaffFactors, type StaffMfaView } from '$lib/server/admin-mfa';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const { locals } = event;
	if (locals.user?.role !== 'admin') error(403, 'この画面は管理者だけが開けます。');
	const base = {
		selfId: locals.user.id,
		// 他人の登録を消すには、操作する本人が二段階認証で確認済み（aal2）であること
		selfAal2: locals.adminAal?.current === 'aal2'
	};
	if (AUTH_MODE !== 'supabase' || !locals.adminAal) {
		return { ...base, available: false as const, users: [] as StaffMfaView[], loadError: null as string | null };
	}
	try {
		return { ...base, available: true as const, users: await listStaffMfa(), loadError: null as string | null };
	} catch (e) {
		const message = e instanceof AdminMfaError ? e.message : 'アカウントの一覧を読めませんでした。';
		return { ...base, available: true as const, users: [] as StaffMfaView[], loadError: message };
	}
};

export const actions: Actions = {
	reset: async ({ request, locals }) => {
		if (AUTH_MODE !== 'supabase' || !locals.adminAal) return fail(400, { message: 'この環境（AUTH_MODE=demo）では使えません。' });
		if (locals.user?.role !== 'admin') return fail(403, { message: '登録の削除は管理者だけができます。' });
		if (locals.adminAal.current !== 'aal2') {
			return fail(403, {
				message: 'ほかの人の登録を削除するには、先にご自身の二段階認証を登録し、コードで確認してください。'
			});
		}
		const form = await request.formData();
		const userId = String(form.get('userId') ?? '');
		const factorId = String(form.get('factorId') ?? '') || null;
		if (!userId) return fail(400, { message: '対象を選んでください。' });
		try {
			const r = await resetStaffFactors({ actorId: locals.user.id, targetUserId: userId, factorId });
			return { done: `${r.email} の登録を ${r.deleted} 件削除しました。本人に、次回ログイン後「二段階認証」の画面で登録し直すよう伝えてください。` };
		} catch (e) {
			if (e instanceof AdminMfaError) return fail(e.status, { message: e.message });
			return fail(500, { message: '削除に失敗しました。' });
		}
	}
};
