// アンバサダーの一覧と制度の設定（docs/ambassador.md §2・§7）。
// 一覧はスタッフも見られる。設定の保存は管理者だけ（RPC の中でも確かめる・監査ログ referral_program）。
import { fail } from '@sveltejs/kit';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { adminListCoupons, bookAdmin, type CouponRow } from '$lib/server/admin-app-data';
import {
	adminAmbassadors,
	adminReferralProgram,
	adminSaveReferralProgram,
	ambassadorErrorMessage,
	type AdminAmbassadorRow,
	type ReferralProgram
} from '$lib/server/ambassador';
import { parseShareRates } from '$lib/ambassador';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const isAdmin = event.locals.user?.role === 'admin';
	if (!ADMIN_SUPABASE) {
		return {
			unavailable: true as const,
			isAdmin,
			rows: [] as AdminAmbassadorRow[],
			program: null as ReferralProgram | null,
			coupons: [] as CouponRow[]
		};
	}
	const client = bookAdmin(event);
	const [rows, program, coupons] = await Promise.all([
		adminAmbassadors(client).catch((e) => {
			console.error('[admin/ambassadors] list', e);
			return [] as AdminAmbassadorRow[];
		}),
		adminReferralProgram(client).catch(() => null),
		adminListCoupons(client, false).catch(() => [] as CouponRow[])
	]);
	return { unavailable: false as const, isAdmin, rows, program, coupons };
};

export const actions: Actions = {
	save: async (event) => {
		if (event.locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		if (!ADMIN_SUPABASE) return fail(400, { message: 'この環境では保存できません。' });
		const form = await event.request.formData();
		const firstPoints = Number(String(form.get('firstPoints') ?? '').replace(/[,，]/g, ''));
		const shareRates = parseShareRates(String(form.get('shareRates') ?? ''));
		const couponId = String(form.get('inviteCouponId') ?? '') || null;
		if (!Number.isInteger(firstPoints) || firstPoints < 0 || firstPoints > 100000) {
			return fail(400, { message: '初回のポイントは 0〜100,000 の整数で入れてください。' });
		}
		if (!shareRates) return fail(400, { message: '割合は「2, 1, 0.5」のように 0〜20(%) を最大10年分、カンマ区切りで入れてください。' });
		try {
			await adminSaveReferralProgram(bookAdmin(event), { firstPoints, shareRates, inviteCouponId: couponId });
		} catch (e) {
			return fail(400, { message: ambassadorErrorMessage(e) });
		}
		return { saved: true };
	}
};
