// 管理画面: プラン紹介の一覧（book.plan_contents × booking.rate_plans）。
// プラン自体（料金・在庫・キャンセル規定）は rms 側。紹介の行は、rms 先行なら同期が下書きで作り、
// Book 先行ならここの「新規プラン」で作る（料金は rms からあとで紐づける・autumn-shared 20261030213302）。
import { fail, redirect } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbCreatePlan, sbListPlanContentsAdmin, type AdminPlanContent } from '$lib/server/content-admin';
import {
	LIVE,
	NOT_LIVE,
	currentFacilityOf,
	demoPlanContents,
	denyIfNotStaff,
	facilityUuidOf,
	messageOf
} from '$lib/server/admin-content-page';
import { PLAN_NAME_MAX, isMealPlan } from '$lib/plan-meal';
import type { Actions, PageServerLoad } from './$types';

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

export const actions: Actions = {
	// プランを Book で先に作る。料金は無い状態で、rms の料金設定をあとから紐づける（autumn-shared 20261030213302）
	create: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) return fail(503, { createError: NOT_LIVE });
		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const meal = String(form.get('meal_plan') ?? '').trim();
		if (!name || name.length > PLAN_NAME_MAX) {
			return fail(400, { createError: `プラン名は 1〜${PLAN_NAME_MAX} 文字で入力してください。`, name });
		}
		if (meal && !isMealPlan(meal)) return fail(400, { createError: '食事の区分を選び直してください。', name });
		let id: string;
		try {
			id = await sbCreatePlan(createSupabaseServerClient(event), currentFacilityOf(event).uuid, name, meal || null);
		} catch (e) {
			return fail(400, { createError: messageOf(e), name });
		}
		// 作ったプランの編集画面へ（紹介文・写真・支払方法・公開範囲は、そこで設定する）
		redirect(303, `/admin/plans/${id}`);
	}
};
