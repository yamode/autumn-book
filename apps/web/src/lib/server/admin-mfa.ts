// 管理画面の二段階認証の「復旧」（docs/auth-hardening.md §7.4）。
// 認証アプリを失った管理者/スタッフの第2要素を、別の admin が削除する（本人はその後 /admin/security で登録し直す）。
//
// 他人の factor の一覧・削除は Supabase Auth の管理 API（auth.admin.listUsers / auth.admin.mfa.deleteFactor）で、
// service_role が要る。Book で service_role を使ってよいのは partnerServiceClient() の例外リストに載せたものだけなので、
// 管理 API の呼び出しはこのファイルに閉じ込める（admin-client.ts の冒頭コメント「例外その4」）。
// 呼び出し側（routes/admin/security/users）で必ず「操作者が admin・aal2」を確かめてから呼ぶこと。
//
// 監査: book.admin_audit_logs に action='admin_mfa_reset' を残す。記帳 RPC は無いため（ADMIN_APP_OPS §7.3 は
// 「書き込み RPC 内で記帳」が原則）、service_role で直接 insert する。actor はサーバが getUser() で検証した操作者の id。
// 記帳できなければ削除しない（記録の無いリセットを作らない）。
import type { Factor, SupabaseClient, User } from '@supabase/supabase-js';
import { partnerServiceClient } from '$lib/server/partners/admin-client';

// 山人テナント（supabase-data.ts・faq/admin.ts と同じ値）
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

/** listUsers を何ページまで読むか（1 ページ 1000 人。会員も auth.users に入るため上限を設ける）。 */
const MAX_PAGES = 20;

export class AdminMfaError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

export interface StaffFactorView {
	id: string;
	type: string;
	status: string;
	friendlyName: string | null;
	createdAt: string;
}

export interface StaffMfaView {
	id: string;
	email: string;
	name: string;
	role: 'admin' | 'staff';
	factors: StaffFactorView[];
}

function serviceOrThrow(): SupabaseClient {
	const svc = partnerServiceClient();
	if (!svc) throw new AdminMfaError('サーバの設定（SUPABASE_SERVICE_ROLE_KEY）が無いため、この画面は使えません。', 503);
	return svc;
}

function staffRoleOf(user: Pick<User, 'app_metadata'>): 'admin' | 'staff' | null {
	const role = (user.app_metadata as { role?: string } | null)?.role;
	return role === 'admin' || role === 'staff' ? role : null;
}

function toFactorView(f: Factor): StaffFactorView {
	return {
		id: f.id,
		type: f.factor_type,
		status: f.status,
		friendlyName: f.friendly_name ?? null,
		createdAt: f.created_at
	};
}

/** 管理画面のアカウント（app_metadata.role が admin / staff）と、それぞれの第2要素の一覧。 */
export async function listStaffMfa(): Promise<StaffMfaView[]> {
	const svc = serviceOrThrow();
	const out: StaffMfaView[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw new AdminMfaError(`アカウントの一覧を読めませんでした（${error.message}）`, 502);
		for (const u of data.users) {
			const role = staffRoleOf(u);
			if (!role) continue;
			const name = ((u.user_metadata as { name?: string } | null)?.name ?? '') as string;
			out.push({
				id: u.id,
				email: u.email ?? '',
				name,
				role,
				factors: (u.factors ?? []).map(toFactorView)
			});
		}
		if (data.users.length < 1000) break;
	}
	return out.sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1));
}

async function writeAudit(svc: SupabaseClient, actorId: string, action: string, detail: Record<string, unknown>) {
	const { error } = await svc.schema('book').from('admin_audit_logs').insert({
		tenant_id: TENANT_ID,
		actor: actorId,
		action,
		detail
	});
	return error;
}

/**
 * 別の管理者/スタッフの第2要素を削除する（factorId を省くと全部）。
 * 先に監査ログを書き、書けたら削除する。削除に失敗したら admin_mfa_reset_failed も残す。
 */
export async function resetStaffFactors(args: {
	actorId: string;
	targetUserId: string;
	factorId?: string | null;
}): Promise<{ deleted: number; email: string }> {
	if (args.actorId === args.targetUserId) {
		throw new AdminMfaError('ご自身の登録は「二段階認証」の画面から削除してください。');
	}
	const svc = serviceOrThrow();

	const { data: got, error: getErr } = await svc.auth.admin.getUserById(args.targetUserId);
	if (getErr || !got?.user) throw new AdminMfaError('対象のアカウントが見つかりません。', 404);
	const target = got.user;
	if (!staffRoleOf(target)) throw new AdminMfaError('管理画面のアカウント（管理者・スタッフ）だけが対象です。', 403);

	const { data: listed, error: listErr } = await svc.auth.admin.mfa.listFactors({ userId: target.id });
	if (listErr) throw new AdminMfaError(`登録を読めませんでした（${listErr.message}）`, 502);
	const factors = (listed?.factors ?? []).filter((f) => !args.factorId || f.id === args.factorId);
	if (factors.length === 0) throw new AdminMfaError('削除する登録がありません（すでに削除済みかもしれません）。', 404);

	const detail = {
		target_user_id: target.id,
		target_email: target.email ?? null,
		factor_ids: factors.map((f) => f.id),
		factor_types: factors.map((f) => f.factor_type),
		scope: args.factorId ? 'one' : 'all'
	};
	const auditErr = await writeAudit(svc, args.actorId, 'admin_mfa_reset', detail);
	if (auditErr) {
		throw new AdminMfaError(`監査ログを記録できなかったため、削除を中止しました（${auditErr.message}）`, 502);
	}

	let deleted = 0;
	const failed: { id: string; message: string }[] = [];
	for (const f of factors) {
		const { error } = await svc.auth.admin.mfa.deleteFactor({ id: f.id, userId: target.id });
		if (error) failed.push({ id: f.id, message: error.message });
		else deleted++;
	}
	if (failed.length > 0) {
		await writeAudit(svc, args.actorId, 'admin_mfa_reset_failed', { ...detail, failed });
		throw new AdminMfaError(`${failed.length} 件の削除に失敗しました（${failed[0].message}）`, 502);
	}
	return { deleted, email: target.email ?? '' };
}
