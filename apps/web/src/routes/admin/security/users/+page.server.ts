// 管理者・スタッフの二段階認証の登録状況と、登録の削除（復旧・admin のみ・docs/auth-hardening.md §7.4）。
// スマートフォンを失くした人の登録を別の admin が削除し、本人が /admin/security で登録し直す。
// 削除は service_role の管理 API（lib/server/admin-mfa.ts）で行い、book.admin_audit_logs に admin_mfa_reset を残す。
import { error, fail } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { AdminMfaError, listStaffMfa, resetStaffFactors, staffResetTarget, type StaffMfaView } from '$lib/server/admin-mfa';
import { AdminPasskeyError, countAdminPasskeysByUser, resetAdminPasskeys } from '$lib/server/admin-passkeys';
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
		const [users, passkeys] = await Promise.all([listStaffMfa(), countAdminPasskeysByUser()]);
		for (const u of users) u.passkeys = passkeys.get(u.id) ?? 0;
		return { ...base, available: true as const, users, loadError: null as string | null };
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
			if (factorId) {
				const r = await resetStaffFactors({ actorId: locals.user.id, targetUserId: userId, factorId });
				return { done: `${r.email} の登録を ${r.deleted} 件削除しました。` };
			}
			// 全部: パスキー（book.admin_passkeys）と認証アプリ（Supabase の factor）の両方
			const target = await staffResetTarget({ actorId: locals.user.id, targetUserId: userId });
			const passkeys = await resetAdminPasskeys({ actorId: locals.user.id, targetUserId: target.id, targetEmail: target.email });
			let totp = 0;
			try {
				totp = (await resetStaffFactors({ actorId: locals.user.id, targetUserId: target.id })).deleted;
			} catch (e) {
				// 認証アプリが無い（パスキーだけ）なら、パスキーを消せていれば成功
				if (!(e instanceof AdminMfaError && e.status === 404 && passkeys > 0)) throw e;
			}
			return {
				done: `${target.email ?? ''} の登録を削除しました（パスキー ${passkeys} 件・認証アプリ ${totp} 件）。本人に、次回ログイン後「二段階認証・パスキー」の画面で登録し直すよう伝えてください。`
			};
		} catch (e) {
			if (e instanceof AdminMfaError || e instanceof AdminPasskeyError) return fail(e.status, { message: e.message });
			return fail(500, { message: '削除に失敗しました。' });
		}
	}
};
