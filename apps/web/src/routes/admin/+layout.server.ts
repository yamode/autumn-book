import { redirect } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { isMaintenanceOn } from '$lib/server/maintenance';
import { ADMIN_SUPABASE, AUTH_MODE, adminMfaRequired } from '$lib/server/auth';
import { adminMfaRedirectTarget, decideAdminMfaGate } from '$lib/admin-mfa';
import { DATA_SOURCE } from '$lib/server/supabase';
import { countSubmittedGroupInquiries } from '$lib/server/partners/group-inquiries';
import { staffGroupScope } from '$lib/server/partners/group-staff';
import { TtlCache } from '$lib/server/ttl-cache';
import { bookAdmin } from '$lib/server/admin-app-data';
import { OTAYORI_OVERDUE_DAYS, otayoriBadgeCache, supportBadgeCache } from '$lib/server/admin-badges';
import { assignedFacilities } from '$lib/server/admin-facility-access';
import { canOperateFacility, pickFacilityId } from '$lib/admin-facility-scope';
import type { LayoutServerLoad } from './$types';

const badgeCache = new TtlCache<number | null>(60_000);

/** 会員サポートの未返信の件数（admin_support_counts の needs_reply・完了を除く）。読めなければ null */
async function supportBadge(event: Parameters<LayoutServerLoad>[0], userId: string): Promise<number | null> {
	const hit = supportBadgeCache.get(userId);
	if (hit !== undefined) return hit;
	const n = await Promise.resolve(bookAdmin(event).rpc('admin_support_counts'))
		.then(({ data, error }) => (error ? null : Math.max(0, Number((data as { needs_reply?: number } | null)?.needs_reply ?? 0) || 0)))
		.catch(() => null as number | null);
	if (n !== null) supportBadgeCache.set(userId, n);
	return n;
}

/** おたよりの受付から3週間たっても未処理（紹介も却下もしていない）の件数。読めなければ null */
async function otayoriBadge(event: Parameters<LayoutServerLoad>[0], userId: string): Promise<number | null> {
	const hit = otayoriBadgeCache.get(userId);
	if (hit !== undefined) return hit;
	const n = await Promise.resolve(bookAdmin(event).rpc('otayori_overdue_count', { p_days: OTAYORI_OVERDUE_DAYS }))
		.then(({ data, error }) => (error ? null : Math.max(0, Number(data) || 0)))
		.catch(() => null as number | null);
	if (n !== null) otayoriBadgeCache.set(userId, n);
	return n;
}

async function groupBadge(event: Parameters<LayoutServerLoad>[0], userId: string): Promise<number | null> {
	const hit = badgeCache.get(userId);
	if (hit !== undefined) return hit;
	const n = await staffGroupScope(event)
		.then(({ scope, facilities: facs }) => countSubmittedGroupInquiries(scope.db, scope.tenantId, facs.map((f) => f.id)))
		.catch(() => null as number | null);
	if (n !== null) badgeCache.set(userId, n);
	return n;
}

export const load: LayoutServerLoad = async (event) => {
	const { locals, url, cookies, platform } = event;
	// ログイン画面とパスワードの再設定（/admin/login/reset・メールのリンクから未ログインで開く）
	const isLogin = url.pathname === '/admin/login' || url.pathname.startsWith('/admin/login/');
	if (!isLogin && locals.user?.role !== 'admin' && locals.user?.role !== 'staff') {
		redirect(303, '/admin/login');
	}
	// 二段階認証の関所（hooks.server.ts と同じ判定。こちらはクライアント遷移のデータ要求に効かせるため）
	const required = adminMfaRequired();
	const gate = decideAdminMfaGate({ pathname: url.pathname, role: locals.user?.role, aal: locals.adminAal, required });
	const target = adminMfaRedirectTarget(gate, url.pathname, url.search);
	if (target) redirect(303, target);
	// いま開いている施設。クッキーが無い（ログインし直した・別のブラウザ）ときは、
	// 先頭の施設ではなく**自分に割り当てられた施設**から始める（2026-11-24 指示）。
	// クッキーがあるときはそのまま従う（割り当て外の施設も開ける・ただし下の canEditFacility が false になり閲覧だけ）。
	const assigned = await assignedFacilities(event);
	const picked = pickFacilityId(facilities.map((f) => f.id), cookies.get('ab_fac'), assigned);
	const current = facilities.find((f) => f.id === picked.id) ?? facilities[0];
	// 次からは決め直さなくて済むように覚える（/admin/switch と同じ入れ方）
	if (!picked.fromCookie && !isLogin) {
		cookies.set('ab_fac', current.id, { path: '/admin', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
	}
	return {
		user: locals.user,
		facilities: facilities.map((f) => ({ id: f.id, name: f.name, assigned: canOperateFacility(assigned, f.id) })),
		currentFacility: { id: current.id, name: current.name },
		// 割り当て外の施設を開いているあいだ、施設に紐づく画面は閲覧だけ（保存は hooks.server.ts が止める）
		canEditFacility: canOperateFacility(assigned, current.id),
		maintenanceActive: await isMaintenanceOn(platform),
		// アプリ運用画面が「この環境では使えません」の理由を出せるようにする
		adminSupabase: ADMIN_SUPABASE,
		authMode: AUTH_MODE,
		dataSource: DATA_SOURCE,
		// 二段階認証: 未登録で必須でないときに上部へ案内を出す（必須化は ADMIN_MFA_REQUIRED）
		adminMfa: {
			enabled: locals.adminAal !== null,
			enrolled: (locals.adminAal?.verifiedFactors ?? 0) > 0,
			required
		},
		// サイドバー「団体照会」のバッジ（回答待ちの件数・スタッフがアクセスできる施設の範囲・docs/partner-group-booking.md §7.8）。
		// 画面の表示を待たせないよう Promise のまま流す（読めない・この環境では使えないときは null＝バッジを出さない）
		// 画面遷移のたびに数え直さないよう、ユーザーごとに 60 秒覚える（2026-10-18 高速化）
		groupInquiryBadge: isLogin || !ADMIN_SUPABASE || !locals.user ? Promise.resolve(null as number | null) : groupBadge(event, locals.user.id),
		// サイドバー「会員サポート」のバッジ（未返信の件数・docs/member-support.md）。団体照会と同じく Promise のまま・60 秒覚える
		supportBadge: isLogin || !ADMIN_SUPABASE || !locals.user ? Promise.resolve(null as number | null) : supportBadge(event, locals.user.id),
		// サイドバー「おたより」（親の「会員・アプリ」にも印）とダッシュボードの強調表示（受付から3週間たっても未処理の件数）。同じく Promise のまま・60 秒覚える
		otayoriOverdueBadge: isLogin || !ADMIN_SUPABASE || !locals.user ? Promise.resolve(null as number | null) : otayoriBadge(event, locals.user.id)
	};
};
