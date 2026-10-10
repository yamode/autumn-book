import { redirect } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { isMaintenanceOn } from '$lib/server/maintenance';
import { ADMIN_SUPABASE, AUTH_MODE, adminMfaRequired } from '$lib/server/auth';
import { adminMfaRedirectTarget, decideAdminMfaGate } from '$lib/admin-mfa';
import { DATA_SOURCE } from '$lib/server/supabase';
import { countSubmittedGroupInquiries } from '$lib/server/partners/group-inquiries';
import { staffGroupScope } from '$lib/server/partners/group-staff';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async (event) => {
	const { locals, url, cookies, platform } = event;
	const isLogin = url.pathname === '/admin/login';
	if (!isLogin && locals.user?.role !== 'admin' && locals.user?.role !== 'staff') {
		redirect(303, '/admin/login');
	}
	// 二段階認証の関所（hooks.server.ts と同じ判定。こちらはクライアント遷移のデータ要求に効かせるため）
	const required = adminMfaRequired();
	const gate = decideAdminMfaGate({ pathname: url.pathname, role: locals.user?.role, aal: locals.adminAal, required });
	const target = adminMfaRedirectTarget(gate, url.pathname, url.search);
	if (target) redirect(303, target);
	const facId = cookies.get('ab_fac') ?? facilities[0].id;
	const current = facilities.find((f) => f.id === facId) ?? facilities[0];
	return {
		user: locals.user,
		facilities: facilities.map((f) => ({ id: f.id, name: f.name })),
		currentFacility: { id: current.id, name: current.name },
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
		groupInquiryBadge:
			isLogin || !ADMIN_SUPABASE
				? Promise.resolve(null as number | null)
				: staffGroupScope(event)
						.then(({ scope, facilities: facs }) => countSubmittedGroupInquiries(scope.db, scope.tenantId, facs.map((f) => f.id)))
						.catch(() => null as number | null)
	};
};
