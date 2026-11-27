import { error, fail, redirect } from '@sveltejs/kit';
import { bookings, facilityById, listOptionItems, addBookingOptions } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { memberPageAddOptions } from '$lib/server/partners/member-bookings';
import { privateBookChangeGate } from '$lib/server/private-book-bookings';
import { PRIVATE_BOOK_FORBIDDEN_MESSAGE, privateBookRouteOf, type PrivateBookRoute } from '$lib/private-book-booking';
import { sbMyReservations, sbListOptionItems, sbAddBookingOptions, sbRoomTypeByUuid } from '$lib/server/supabase-data';
import { addDays } from '@autumn-book/core';
import { canPersonalizeStay, isStayPersonalization, optionAllowedFor } from '$lib/member-benefits';
import { viewerOf } from '$lib/server/secret-plans';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { OptionItem, Locale } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// RPC/store の例外メッセージ → i18n 文言（部分一致で拾う）
function optionErrorMessage(msg: string, privateBook = false): string {
	if (msg.includes('grade_stay_personalization')) return m.membership_personalize_options_notice();
	if (msg.includes('option_already_ordered')) return m.membership_option_already_ordered();
	if (msg.includes('past_deadline')) return m.options_err_past_deadline();
	if (msg.includes('option_sold_out')) return m.options_err_sold_out();
	if (msg.includes('invalid_service_date')) return m.options_err_service_date();
	if (msg.includes('invalid_quantity')) return m.options_err_quantity();
	if (msg.includes('not_amendable')) return m.options_err_not_amendable();
	// プライベートブック（専用ページ経由）の入口の本人確認（B面と同じ文言）
	if (privateBook && (msg.includes('forbidden') || msg.includes('not_member_page_booking'))) return 'このご予約はお手続きいただけません。';
	return m.options_add_failed();
}

export const load: PageServerLoad = async (event) => {
	const { params, locals } = event;

	const locale = getLocale() as Locale;
	const viewer = await viewerOf(locals);
	const canPersonalize = canPersonalizeStay(viewer);
	// 会員ランクで使えるオプションだけ（管理画面の「使える会員ランク」）
	const usable = (o: OptionItem) => optionAllowedFor(o, viewer) && (canPersonalize || !isStayPersonalization(o.category));

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const reservations = await sbMyReservations(client);
		const r = reservations.find((x) => x.code === params.code);
		if (!r) error(404, m.error_booking_not_found());
		if (r.status !== 'reserved') redirect(303, `/account/reservations/${params.code}`);
		// プライベートブック（専用ページ経由）の予約: 今ページを使える方だけ（対象から外れた方は予約詳細へ戻す・案内は詳細に出る）
		const route = privateBookRouteOf(r, locals.user?.id);
		if (route.kind === 'deny') redirect(303, `/account/reservations/${params.code}`);
		if (route.kind === 'private_book' && !(await privateBookChangeGate(route.who, r.facilityUuid)).ok) {
			redirect(303, `/account/reservations/${params.code}`);
		}
		const items = await sbListOptionItems(r.facilityUuid, locale);
		// 複数室の予約（M2）: どのお部屋のアレンジかを選ぶ（生きている部屋だけ）
		const live = (r.rooms ?? []).filter((x) => !x.cancelled);
		const rooms =
			(r.rooms?.length ?? 0) > 1
				? await Promise.all(
						live.map(async (x) => ({
							index: x.index,
							roomName: (await sbRoomTypeByUuid(x.roomTypeId).catch(() => undefined))?.name ?? '',
							adults: x.adults
						}))
					)
				: [];
		return { code: r.code, checkin: r.checkin, checkout: r.checkout, items: items.filter(usable), canPersonalize, rooms };
	}

	const booking = bookings.get(params.code);
	if (!booking || booking.memberId !== locals.user!.id) error(404, m.error_booking_not_found());
	if (booking.status !== 'reserved') redirect(303, `/account/reservations/${params.code}`);
	const items = listOptionItems(booking.facilityId, locale);
	return {
		code: booking.code,
		checkin: booking.checkin,
		checkout: addDays(booking.checkin, booking.nights),
		items: items.filter(usable),
		canPersonalize,
		// デモ（store）は 1 室だけ
		rooms: [] as { index: number; roomName: string; adults: number }[]
	};
};

export const actions: Actions = {
	add: async (event) => {
		const { request, params, locals } = event;
		const form = await request.formData();

		// カタログを再取得して optionId/requiresServiceDate を確定（フォーム値を信用しない）
		let catalog: OptionItem[];
		let route: PrivateBookRoute = { kind: 'general' };
		if (MEMBER_SUPABASE) {
			const reservations = await sbMyReservations(createSupabaseServerClient(event));
			const r = reservations.find((x) => x.code === params.code);
			if (!r) return fail(404, { message: m.error_booking_not_found() });
			// プライベートブック（専用ページ経由）の予約: 専用ページの入口（今ページを使える方だけ・予約した本人を DB が確かめる）
			route = privateBookRouteOf(r, locals.user?.id);
			if (route.kind === 'deny') return fail(403, { message: PRIVATE_BOOK_FORBIDDEN_MESSAGE });
			if (route.kind === 'private_book') {
				const gate = await privateBookChangeGate(route.who, r.facilityUuid);
				if (!gate.ok) return fail(403, { message: gate.message });
			}
			catalog = await sbListOptionItems(r.facilityUuid);
		} else {
			const booking = bookings.get(params.code);
			if (!booking || booking.memberId !== locals.user!.id) return fail(404, { message: m.error_booking_not_found() });
			catalog = listOptionItems(booking.facilityId);
		}

		const viewer = await viewerOf(locals);
		if (catalog.some(o => Number(form.get(`qty_${o.id}`)) > 0 && (!optionAllowedFor(o, viewer) || (isStayPersonalization(o.category) && !canPersonalizeStay(viewer))))) {
			return fail(403, { message: m.membership_personalize_options_notice() });
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
		// 付けるお部屋（複数室の予約だけ。1 室・未選択は DB が生きている部屋の最初に付ける）
		const roomIndexRaw = Number(form.get('roomIndex'));
		const roomIndex = Number.isInteger(roomIndexRaw) && roomIndexRaw >= 1 ? roomIndexRaw : null;

		try {
			if (MEMBER_SUPABASE && route.kind === 'private_book') {
				await memberPageAddOptions(
					route.who,
					items.map((i) => ({ ...i, roomIndex }))
				);
			} else if (MEMBER_SUPABASE) {
				await sbAddBookingOptions(
					createSupabaseServerClient(event),
					params.code,
					items.map((i) => ({ ...i, roomIndex }))
				);
			} else {
				addBookingOptions(params.code, items, locals.user!.id);
			}
		} catch (e) {
			return fail(400, { message: optionErrorMessage(e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e), route.kind === 'private_book') });
		}

		redirect(303, `/account/reservations/${params.code}`);
	}
};
