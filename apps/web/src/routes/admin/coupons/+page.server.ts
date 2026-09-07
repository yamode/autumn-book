// クーポン一覧（統計付き）。作成・配布は個別ページで行う。
import { ADMIN_SUPABASE, AUTH_MODE } from '$lib/server/auth';
import { DATA_SOURCE } from '$lib/server/supabase';
import { adminListCoupons, bookAdmin, mapRpcError, type CouponRow } from '$lib/server/admin-app-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) {
		return {
			unavailable: true as const,
			authMode: AUTH_MODE,
			dataSource: DATA_SOURCE,
			coupons: [] as CouponRow[]
		};
	}
	try {
		const coupons = await adminListCoupons(bookAdmin(event), true);
		return { unavailable: false as const, coupons };
	} catch (e) {
		return { unavailable: false as const, coupons: [] as CouponRow[], error: mapRpcError(e) };
	}
};
