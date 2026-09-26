// 管理画面: プラン紹介の一覧（book.plan_contents × booking.rate_plans）。
// プラン自体（料金・在庫・キャンセル規定）は rms 側。紹介の行は rms 同期が下書きで作る。
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbListPlanContentsAdmin, type AdminPlanContent } from '$lib/server/content-admin';
import { LIVE, NOT_LIVE, demoPlanContents, facilityUuidOf, messageOf } from '$lib/server/admin-content-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	if (!LIVE) {
		return { plans: demoPlanContents(currentFacility.id), live: false, loadError: NOT_LIVE, namesError: null };
	}
	let plans: AdminPlanContent[] = [];
	let loadError: string | null = null;
	let namesError: string | null = null;
	try {
		const r = await sbListPlanContentsAdmin(createSupabaseServerClient(event), facilityUuidOf(currentFacility.id));
		plans = r.plans;
		namesError = r.namesError;
	} catch (e) {
		loadError = messageOf(e);
	}
	return { plans, live: true, loadError, namesError };
};
