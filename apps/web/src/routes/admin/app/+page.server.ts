// アプリ運用ダッシュボード。集計は単一 RPC（book.admin_app_dashboard）に寄せている。
// device_tokens に staff 用 select policy を作らない方針のため、集計は DB 側で行う必要がある。
import { ADMIN_SUPABASE, AUTH_MODE } from '$lib/server/auth';
import { DATA_SOURCE } from '$lib/server/supabase';
import { adminAppDashboard, bookAdmin, buildAppAlerts, mapRpcError } from '$lib/server/admin-app-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) {
		return { unavailable: true as const, authMode: AUTH_MODE, dataSource: DATA_SOURCE };
	}
	try {
		const dashboard = await adminAppDashboard(bookAdmin(event));
		return { unavailable: false as const, dashboard, alerts: buildAppAlerts(dashboard) };
	} catch (e) {
		return { unavailable: false as const, error: mapRpcError(e) };
	}
};
