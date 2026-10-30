// 管理画面のユーザー管理（/admin/users・管理者だけ・2026-10-17 指示）。
//
// 決めたこと（ユーザー確認済み）:
//   - アカウントは管理者が初期パスワードを決めて作る（招待メールは使わない）。メールアドレスの変更はできない
//   - 管理者以外は基本、共有ID。共有ID は PMS と同じID を使う
//   - Book の権限は Supabase Auth の app_metadata.role（admin / staff / なし）
//   - 施設の割り当ては core.memberships（PMS・RMS と共通）の role='shared_login' の行。施設ごとの操作の制限はしない
//     （shared_login は PMS の設定で cross-facility＝全施設。割り当ては「どの施設の ID か」と DB の施設権限の入口）。
//     ⚠ 割り当てると PMS にも同じ施設で入れるようになる。shared_login 以外の行（tenant_admin など）は読むだけで触らない
//   - パスワードは管理者が直接変える／本人に再設定メールを送る（Book が自前でメールを送る。Supabase のメールの雛形は RMS と共用のため使わない）
//
// 他人のアカウントの作成・変更は Supabase Auth の管理 API で service_role が要る（admin-client.ts「例外その5」と同じ扱い）。
// 呼び出し側（routes/admin/users）で必ず「操作者が admin・確認済み（aal2）」を確かめてから呼ぶこと。
// 変更は book.admin_audit_logs に残す（admin_user_*）。
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { sendHtmlEmail } from '$lib/server/mailer';
import { adminRoleOf, isBanned } from '$lib/admin-passkey';
import { forgetStaffUser } from '$lib/server/auth';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const MAX_PAGES = 20;
/** 施設の割り当てに使う memberships のロール（PMS の共有ID と同じ） */
export const SHARED_ROLE = 'shared_login';
export const MIN_PASSWORD = 10;
/** 受電専用アカウントの印（user_metadata.kind）。施設の割り当てを全部外しても一覧に残すために使う */
export const OPERATOR_KIND = 'intercom_operator';

export class AdminUserError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

export type BookRole = 'admin' | 'staff' | null;

export interface AdminUserView {
	id: string;
	email: string;
	name: string;
	bookRole: BookRole;
	/** 施設の割り当て（shared_login の行がある施設の UUID）。ユーザー管理で付け外しできる */
	sharedFacilityIds: string[];
	/** shared_login 以外の memberships（PMS・RMS 側で付けたもの。読むだけ） */
	otherMemberships: { facilityId: string | null; role: string }[];
	/** 受電専用（book.intercom_operators）の施設。受電アプリ（autumn-call）で内線を受けるだけで、Book・PMS には入れない */
	operatorFacilityIds: string[];
	/** 受電専用として作ったアカウント（施設を全部外しても一覧に残す印） */
	isOperator: boolean;
	/** 認証アプリの数 */
	totp: number;
	lastSignInAt: string | null;
	banned: boolean;
}

function svcOrThrow(): SupabaseClient {
	const svc = partnerServiceClient();
	if (!svc) throw new AdminUserError('サーバの設定（SUPABASE_SERVICE_ROLE_KEY）が無いため、この画面は使えません。', 503);
	return svc;
}

async function audit(svc: SupabaseClient, actorId: string, action: string, detail: Record<string, unknown>) {
	const { error } = await svc.schema('book').from('admin_audit_logs').insert({ tenant_id: TENANT_ID, actor: actorId, action, detail });
	if (error) throw new AdminUserError(`監査ログを記録できなかったため、中止しました（${error.message}）`, 502);
}

const nameOf = (u: Pick<User, 'user_metadata' | 'email'>) => String((u.user_metadata as { name?: string } | null)?.name ?? '');

/** 一覧: Book の権限があるか、テナントの memberships があるアカウント（会員は出さない） */
export async function listAdminUsers(): Promise<AdminUserView[]> {
	const svc = svcOrThrow();
	const { data: ms, error: msErr } = await svc.schema('core').from('memberships').select('user_id, facility_id, role').eq('tenant_id', TENANT_ID);
	if (msErr) throw new AdminUserError(`施設の割り当てを読めませんでした（${msErr.message}）`, 502);
	const byUser = new Map<string, { facility_id: string | null; role: string }[]>();
	for (const m of (ms ?? []) as { user_id: string; facility_id: string | null; role: string }[]) {
		byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m]);
	}
	const { data: ops, error: opsErr } = await svc.schema('book').from('intercom_operators').select('user_id, facility_id').eq('tenant_id', TENANT_ID);
	if (opsErr) throw new AdminUserError(`受電専用の割り当てを読めませんでした（${opsErr.message}）`, 502);
	const opsByUser = new Map<string, string[]>();
	for (const o of (ops ?? []) as { user_id: string; facility_id: string }[]) {
		opsByUser.set(o.user_id, [...(opsByUser.get(o.user_id) ?? []), o.facility_id]);
	}
	const out: AdminUserView[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw new AdminUserError(`アカウントの一覧を読めませんでした（${error.message}）`, 502);
		for (const u of data.users) {
			const role = adminRoleOf(u.app_metadata);
			const rows = byUser.get(u.id) ?? [];
			const operatorFacilityIds = opsByUser.get(u.id) ?? [];
			const isOperator = (u.user_metadata as { kind?: string } | null)?.kind === OPERATOR_KIND || operatorFacilityIds.length > 0;
			if (!role && rows.length === 0 && !isOperator) continue;
			out.push({
				operatorFacilityIds,
				isOperator,
				id: u.id,
				email: u.email ?? '',
				name: nameOf(u),
				bookRole: role,
				sharedFacilityIds: rows.filter((r) => r.role === SHARED_ROLE && r.facility_id).map((r) => r.facility_id as string),
				otherMemberships: rows.filter((r) => r.role !== SHARED_ROLE).map((r) => ({ facilityId: r.facility_id, role: r.role })),
				totp: (u.factors ?? []).filter((f) => f.status === 'verified').length,
				lastSignInAt: u.last_sign_in_at ?? null,
				banned: isBanned((u as { banned_until?: string | null }).banned_until)
			});
		}
		if (data.users.length < 1000) break;
	}
	const rank = (r: BookRole) => (r === 'admin' ? 0 : r === 'staff' ? 1 : 2);
	return out.sort((a, b) => rank(a.bookRole) - rank(b.bookRole) || a.email.localeCompare(b.email));
}

/** パスワードの決まり（10文字以上・英字と数字を含む） */
export function passwordProblem(pw: string): string | null {
	if (pw.length < MIN_PASSWORD) return `パスワードは ${MIN_PASSWORD} 文字以上にしてください。`;
	if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'パスワードには英字と数字の両方を入れてください。';
	return null;
}

export function normalizeBookRole(v: unknown): BookRole {
	return v === 'admin' || v === 'staff' ? v : null;
}

async function getTarget(svc: SupabaseClient, id: string): Promise<User> {
	const { data, error } = await svc.auth.admin.getUserById(id);
	if (error || !data?.user) throw new AdminUserError('対象のアカウントが見つかりません。', 404);
	return data.user;
}

/** 管理者（admin）の数。自分を外すとき・最後の管理者を外すときの確認に使う */
async function countAdmins(svc: SupabaseClient): Promise<number> {
	let n = 0;
	for (let page = 1; page <= MAX_PAGES; page++) {
		const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw new AdminUserError(`アカウントの一覧を読めませんでした（${error.message}）`, 502);
		n += data.users.filter((u) => adminRoleOf(u.app_metadata) === 'admin').length;
		if (data.users.length < 1000) break;
	}
	return n;
}

/** 施設の割り当て（shared_login の行）を指定どおりにする。ほかのロールの行は触らない */
async function syncSharedFacilities(svc: SupabaseClient, userId: string, facilityIds: string[]) {
	const want = new Set(facilityIds);
	const { data, error } = await svc.schema('core').from('memberships').select('id, facility_id, role').eq('tenant_id', TENANT_ID).eq('user_id', userId);
	if (error) throw new AdminUserError(`施設の割り当てを読めませんでした（${error.message}）`, 502);
	const rows = (data ?? []) as { id: string; facility_id: string | null; role: string }[];
	const removeIds = rows.filter((r) => r.role === SHARED_ROLE && r.facility_id && !want.has(r.facility_id)).map((r) => r.id);
	// 同じ施設にほかのロールの行があるときは足さない（1施設1行の決まり・その行で施設には入れる）
	const have = new Set(rows.map((r) => r.facility_id).filter(Boolean) as string[]);
	const add = [...want].filter((f) => !have.has(f));
	if (removeIds.length) {
		const { error: e } = await svc.schema('core').from('memberships').delete().in('id', removeIds);
		if (e) throw new AdminUserError(`施設の割り当てを外せませんでした（${e.message}）`, 502);
	}
	if (add.length) {
		const { error: e } = await svc
			.schema('core')
			.from('memberships')
			.insert(add.map((f) => ({ user_id: userId, tenant_id: TENANT_ID, facility_id: f, role: SHARED_ROLE })));
		if (e) throw new AdminUserError(`施設を割り当てられませんでした（${e.message}）`, 502);
	}
	return { added: add, removed: removeIds.length };
}

/** アカウントを作る（初期パスワード・メール確認済み） */
export async function createAdminUser(args: {
	actorId: string;
	email: string;
	name: string;
	password: string;
	role: BookRole;
	facilityIds: string[];
}): Promise<{ id: string; email: string }> {
	const email = args.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AdminUserError('メールアドレスの形が正しくありません。');
	const pwErr = passwordProblem(args.password);
	if (pwErr) throw new AdminUserError(pwErr);
	if (!args.role) throw new AdminUserError('権限（管理者・スタッフ）を選んでください。');
	const svc = svcOrThrow();
	await audit(svc, args.actorId, 'admin_user_create', { email, role: args.role, facility_ids: args.facilityIds });
	const { data, error } = await svc.auth.admin.createUser({
		email,
		password: args.password,
		email_confirm: true,
		app_metadata: { role: args.role },
		user_metadata: { name: args.name.trim().slice(0, 60) }
	});
	if (error || !data?.user) {
		const msg = error?.message ?? '';
		if (/already|registered|exists/i.test(msg)) {
			throw new AdminUserError('このメールアドレスのアカウントは既にあります（PMS の共有ID など）。一覧からそのアカウントに権限を付けてください。', 409);
		}
		throw new AdminUserError(`アカウントを作れませんでした（${msg || '不明なエラー'}）`, 502);
	}
	await syncSharedFacilities(svc, data.user.id, args.facilityIds);
	return { id: data.user.id, email };
}

/** 受電専用の施設（book.intercom_operators の行）を指定どおりにする */
async function syncOperatorFacilities(svc: SupabaseClient, userId: string, facilityIds: string[]) {
	const want = new Set(facilityIds);
	const { data, error } = await svc.schema('book').from('intercom_operators').select('facility_id').eq('tenant_id', TENANT_ID).eq('user_id', userId);
	if (error) throw new AdminUserError(`受電専用の割り当てを読めませんでした（${error.message}）`, 502);
	const have = new Set(((data ?? []) as { facility_id: string }[]).map((r) => r.facility_id));
	const remove = [...have].filter((f) => !want.has(f));
	const add = [...want].filter((f) => !have.has(f));
	if (remove.length) {
		const { error: e } = await svc.schema('book').from('intercom_operators').delete().eq('user_id', userId).eq('tenant_id', TENANT_ID).in('facility_id', remove);
		if (e) throw new AdminUserError(`受電専用の割り当てを外せませんでした（${e.message}）`, 502);
	}
	if (add.length) {
		const { error: e } = await svc
			.schema('book')
			.from('intercom_operators')
			.insert(add.map((f) => ({ user_id: userId, tenant_id: TENANT_ID, facility_id: f })));
		if (e) throw new AdminUserError(`受電専用の施設を割り当てられませんでした（${e.message}）`, 502);
	}
}

/**
 * 受電専用アカウントを作る（2026-10-30 指示・App Store の審査用アカウントなどを画面から作れるように）。
 * Book の権限（app_metadata.role）も core.memberships も付けない。付けるのは book.intercom_operators の行だけ
 * ＝受電アプリで内線を受けるだけで、Book の管理画面にも PMS にも入れない（契約書 §12.3）。
 */
export async function createIntercomOperator(args: { actorId: string; email: string; name: string; password: string; facilityIds: string[] }): Promise<{ id: string; email: string }> {
	const email = args.email.trim().toLowerCase();
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AdminUserError('メールアドレスの形が正しくありません。');
	const pwErr = passwordProblem(args.password);
	if (pwErr) throw new AdminUserError(pwErr);
	if (args.facilityIds.length === 0) throw new AdminUserError('受電する施設を 1 つ以上選んでください。');
	const svc = svcOrThrow();
	await audit(svc, args.actorId, 'admin_user_create_operator', { email, facility_ids: args.facilityIds });
	const { data, error } = await svc.auth.admin.createUser({
		email,
		password: args.password,
		email_confirm: true,
		user_metadata: { name: args.name.trim().slice(0, 60), kind: OPERATOR_KIND }
	});
	if (error || !data?.user) {
		const msg = error?.message ?? '';
		if (/already|registered|exists/i.test(msg)) throw new AdminUserError('このメールアドレスのアカウントは既にあります。', 409);
		throw new AdminUserError(`アカウントを作れませんでした（${msg || '不明なエラー'}）`, 502);
	}
	await syncOperatorFacilities(svc, data.user.id, args.facilityIds);
	return { id: data.user.id, email };
}

/** 受電専用の施設を変える（全部外す＝受電できなくなる。アカウントは残る） */
export async function setOperatorFacilities(args: { actorId: string; targetId: string; facilityIds: string[] }) {
	const svc = svcOrThrow();
	const target = await getTarget(svc, args.targetId);
	await audit(svc, args.actorId, 'admin_user_operator_facilities', { target_user_id: target.id, target_email: target.email ?? null, facility_ids: args.facilityIds });
	await syncOperatorFacilities(svc, target.id, args.facilityIds);
}

/** Book の権限を変える（なし＝Book の管理画面に入れない。PMS の割り当てはそのまま） */
export async function setBookRole(args: { actorId: string; targetId: string; role: BookRole }) {
	if (args.actorId === args.targetId) throw new AdminUserError('ご自身の権限は変えられません。別の管理者に頼んでください。');
	const svc = svcOrThrow();
	const target = await getTarget(svc, args.targetId);
	const from = adminRoleOf(target.app_metadata);
	if (from === args.role) return;
	if (from === 'admin' && (await countAdmins(svc)) <= 1) throw new AdminUserError('最後の管理者は外せません。先に別の人を管理者にしてください。', 409);
	await audit(svc, args.actorId, 'admin_user_role', { target_user_id: target.id, target_email: target.email ?? null, from, to: args.role });
	const { error } = await svc.auth.admin.updateUserById(target.id, { app_metadata: { ...(target.app_metadata ?? {}), role: args.role } });
	forgetStaffUser(target.id);
	if (error) throw new AdminUserError(`権限を変えられませんでした（${error.message}）`, 502);
}

/** 施設の割り当てを変える */
export async function setSharedFacilities(args: { actorId: string; targetId: string; facilityIds: string[] }) {
	const svc = svcOrThrow();
	const target = await getTarget(svc, args.targetId);
	await audit(svc, args.actorId, 'admin_user_facilities', { target_user_id: target.id, target_email: target.email ?? null, facility_ids: args.facilityIds });
	return syncSharedFacilities(svc, target.id, args.facilityIds);
}

/** パスワードを管理者が直接変える（共有ID の担当が変わったときなど） */
export async function setUserPassword(args: { actorId: string; targetId: string; password: string }) {
	const pwErr = passwordProblem(args.password);
	if (pwErr) throw new AdminUserError(pwErr);
	const svc = svcOrThrow();
	const target = await getTarget(svc, args.targetId);
	await audit(svc, args.actorId, 'admin_user_password', { target_user_id: target.id, target_email: target.email ?? null });
	const { error } = await svc.auth.admin.updateUserById(target.id, { password: args.password });
	if (error) throw new AdminUserError(`パスワードを変えられませんでした（${error.message}）`, 502);
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** 本人のメールに、パスワードの再設定のリンクを送る（リンクは /admin/login/reset・有効期限は Supabase の既定＝1時間） */
export async function sendPasswordResetMail(args: { actorId: string; targetId: string; origin: string }) {
	const svc = svcOrThrow();
	const target = await getTarget(svc, args.targetId);
	if (!target.email) throw new AdminUserError('このアカウントにはメールアドレスがありません。');
	const { data, error } = await svc.auth.admin.generateLink({ type: 'recovery', email: target.email });
	const tokenHash = data?.properties?.hashed_token;
	if (error || !tokenHash) throw new AdminUserError(`再設定のリンクを作れませんでした（${error?.message ?? '不明なエラー'}）`, 502);
	await audit(svc, args.actorId, 'admin_user_reset_mail', { target_user_id: target.id, target_email: target.email });
	const url = `${args.origin}/admin/login/reset?token_hash=${encodeURIComponent(tokenHash)}`;
	const lines = [
		'山人 管理画面（Book）のパスワードの再設定のご案内です。',
		'下のリンクを開いて、新しいパスワードを決めてください（リンクの有効期限は 1 時間です）。',
		url,
		'',
		`アカウント: ${target.email}`,
		'お心当たりがない場合は、このメールを破棄し、管理者にお知らせください。'
	];
	const r = await sendHtmlEmail({
		to: [target.email],
		subject: '【山人 管理画面】パスワードの再設定',
		text: lines.join('\n'),
		html: `<p>${escapeHtml(lines[0])}<br>${escapeHtml(lines[1])}</p><p><a href="${escapeHtml(url)}">パスワードを再設定する</a></p><p style="color:#666;font-size:12px">${escapeHtml(lines[4])}<br>${escapeHtml(lines[5])}</p>`,
		fromName: '山人 管理画面'
	});
	if (!r.sent) throw new AdminUserError(`メールを送れませんでした（${r.reason ?? '不明'}）`, 502);
	return target.email;
}
