import { error, fail, redirect } from '@sveltejs/kit';
import { bookings, facilityById, listOptionItems, addBookingOptions } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyReservations, sbListOptionItems, sbAddBookingOptions } from '$lib/server/supabase-data';
import { addDays } from '@autumn-book/core';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { OptionItem, Locale } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// RPC/store の例外メッセージ → i18n 文言（部分一致で拾う）
function optionErrorMessage(msg: string): string {
	if (msg.includes('past_deadline')) return m.options_err_past_deadline();
	if (msg.includes('option_sold_out')) return m.options_err_sold_out();
	if (msg.includes('invalid_service_date')) return m.options_err_service_date();
	if (msg.includes('invalid_quantity')) return m.options_err_quantity();
	if (msg.includes('not_amendable')) return m.options_err_not_amendable();
	return m.options_add_failed();
}

export const load: PageServerLoad = async (event) => {
	const { params, locals } = event;

	const locale = getLocale() as Locale;

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const reservations = await sbMyReservations(client);
		const r = reservations.find((x) => x.code === params.code);
		if (!r) error(404, m.error_booking_not_found());
		if (r.status !== 'reserved') redirect(303, `/account/reservations/${params.code}`);
		const items = await sbListOptionItems(r.facilityUuid, locale);
		return { code: r.code, checkin: r.checkin, checkout: r.checkout, items };
	}

	const booking = bookings.get(params.code);
	if (!booking || booking.memberId !== locals.user!.id) error(404, m.error_booking_not_found());
	if (booking.status !== 'reserved') redirect(303, `/account/reservations/${params.code}`);
	const items = listOptionItems(booking.facilityId, locale);
	return {
		code: booking.code,
		checkin: booking.checkin,
		checkout: addDays(booking.checkin, booking.nights),
		items
	};
};

export const actions: Actions = {
	add: async (event) => {
		const { request, params, locals } = event;
		const form = await request.formData();

		// カタログを再取得して optionId/requiresServiceDate を確定（フォーム値を信用しない）
		let catalog: OptionItem[];
		if (MEMBER_SUPABASE) {
			const reservations = await sbMyReservations(createSupabaseServerClient(event));
			const r = reservations.find((x) => x.code === params.code);
			if (!r) return fail(404, { message: m.error_booking_not_found() });
			catalog = await sbListOptionItems(r.facilityUuid);
		} else {
			const booking = bookings.get(params.code);
			if (!booking || booking.memberId !== locals.user!.id) return fail(404, { message: m.error_booking_not_found() });
			catalog = listOptionItems(booking.facilityId);
		}

		// 数量 >= 1 の商品だけをカートに集約
		const items = catalog
			.map((o) => {
				const quantity = Number(form.get(`qty_${o.id}`) ?? 0) || 0;
				if (quantity < 1) return null;
				const serviceDate = o.requiresServiceDate ? String(form.get(`date_${o.id}`) ?? '') : '';
				const note = String(form.get(`note_${o.id}`) ?? '').trim();
				return {
					optionId: o.id,
					serviceDate: serviceDate || null,
					quantity,
					note: note || undefined
				};
			})
			.filter((x): x is NonNullable<typeof x> => x !== null);

		if (items.length === 0) return fail(400, { message: m.options_err_select() });

		try {
			if (MEMBER_SUPABASE) {
				await sbAddBookingOptions(createSupabaseServerClient(event), params.code, items);
			} else {
				addBookingOptions(params.code, items, locals.user!.id);
			}
		} catch (e) {
			return fail(400, { message: optionErrorMessage(e instanceof Error ? e.message : String(e)) });
		}

		redirect(303, `/account/reservations/${params.code}`);
	}
};
