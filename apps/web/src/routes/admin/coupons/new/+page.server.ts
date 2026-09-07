import { fail, redirect } from '@sveltejs/kit';

import { ADMIN_SUPABASE, AUTH_MODE } from '$lib/server/auth';
import { DATA_SOURCE } from '$lib/server/supabase';
import { adminUpsertCoupon, bookAdmin, mapRpcError } from '$lib/server/admin-app-data';
import { readCouponForm } from '../coupon-form';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	if (!ADMIN_SUPABASE) {
		return { unavailable: true as const, authMode: AUTH_MODE, dataSource: DATA_SOURCE };
	}
	return { unavailable: false as const };
};

export const actions: Actions = {
	create: async (event) => {
		if (!ADMIN_SUPABASE) {
			return fail(400, { message: 'この環境では利用できません（DATA_SOURCE / AUTH_MODE）。' });
		}
		if (event.locals.user?.role !== 'admin') {
			return fail(403, { message: 'クーポンの作成は管理者のみ行えます。' });
		}
		const form = await event.request.formData();
		let id: string;
		try {
			id = await adminUpsertCoupon(bookAdmin(event), { id: null, ...readCouponForm(form) });
		} catch (e) {
			return fail(400, { message: mapRpcError(e) });
		}
		redirect(303, `/admin/coupons/${id}`);
	}
};
