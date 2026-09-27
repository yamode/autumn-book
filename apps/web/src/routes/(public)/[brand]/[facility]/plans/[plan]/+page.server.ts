import { error, fail, redirect } from '@sveltejs/kit';
import {
	getFacilityBySlug,
	getRatePlans,
	roomTypes,
	remainingRooms,
	quoteFor,
	getPlanCalendar,
	createHold
} from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import {
	sbFacilityBySlug,
	sbPlanBySlug,
	sbListRoomTypesMapped,
	sbPlanOffers,
	sbPlanReferenceMinPrices,
	offerToQuote,
	createHold as sbCreateHold,
	getPlanCalendar as sbGetPlanCalendar,
	bookingSessionId
} from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import { eachNight } from '@autumn-book/core';
import { shiftYearMonth } from '$lib/calendar-range';
import { todayStr } from '$lib/format';
import { loadEarlyPrepaySettings } from '$lib/server/payment-settings';
import { viewerIsMember, withEarlyPrepayMax } from '$lib/server/direct-payments';
import { memberOnsiteHint, planForViewer } from '$lib/member-payment';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	// 支払方法の表示は閲覧者（会員かどうか）に合わせる（非会員の支払方法）
	const isMember = viewerIsMember(locals);
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.max(1, Number(url.searchParams.get('nights') ?? 1));
	const adults = Math.max(1, Number(url.searchParams.get('adults') ?? 2));
	const firstCalendarMonth = todayStr().slice(0, 7);
	const calendarMonths = Array.from({ length: 6 }, (_, index) => shiftYearMonth(firstCalendarMonth, index));

	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');
		const found = await sbPlanBySlug(facility.id, params.plan);
		if (!found) error(404, 'プランが見つかりません');
		// 早期決済割の対象プランは「予約時決済で最大 N%お得」を出す
		let [plan] = withEarlyPrepayMax([planForViewer(found, isMember)], await loadEarlyPrepaySettings(facility.id));
		if (!checkin) {
			const referencePrices = await sbPlanReferenceMinPrices(facility.id, adults, plan.id);
			plan = { ...plan, basePrice: referencePrices.get(plan.id) ?? 0 };
		}

		// 「このプランで泊まれる客室と料金」は plan_offers が返す（プラン⇄客室はデモの roomTypeIds ではなく実データ）。
		// 日付未指定は 0 行 → 客室リストは出さず「日付を選択してください」を表示する。
		const [calendarByMonth, offers, rooms] = await Promise.all([
			Promise.all(calendarMonths.map((month) => sbGetPlanCalendar(plan.id, month, adults))),
			checkin ? sbPlanOffers(facility.id, checkin, nights, adults, plan.id) : Promise.resolve([]),
			sbListRoomTypesMapped(facility.id)
		]);
		const roomById = new Map(rooms.map((r) => [r.id, r]));
		const roomRows = offers
			.map((o) => {
				const room = roomById.get(o.roomTypeId);
				if (!room) return null;
				// plan_offers は capacity_max >= adults の客室のみ返すため fits は常に true。
				return { room, quote: offerToQuote(o), remaining: o.remaining, fits: true };
			})
			.filter((r): r is NonNullable<typeof r> => r !== null);

		return {
			facility,
			plan,
			rooms: roomRows,
			calendar: calendarByMonth.flat(),
			// 非会員は予約時決済のみ・会員なら現地払いも選べる →「会員の方は現地払いも…」を添える
			memberOnsiteHint: MEMBER_SUPABASE && memberOnsiteHint(found.payment, isMember),
			referenceMode: !checkin,
			params: { checkin: checkin ?? '', nights, adults }
		};
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	const found = getRatePlans(facility.id, locale).find((p) => p.slug === params.plan);
	if (!found) error(404, 'プランが見つかりません');
	const [plan] = withEarlyPrepayMax([planForViewer(found, isMember)], await loadEarlyPrepaySettings(facility.id));

	const rooms = plan.roomTypeIds
		.map((id) => roomTypes.find((r) => r.id === id)!)
		.map((room) => {
			if (!checkin || room.capacity < adults) {
				return { room, quote: null, remaining: checkin ? 0 : null, fits: room.capacity >= adults };
			}
			const remaining = Math.min(...eachNight(checkin, nights).map((d) => remainingRooms(room.id, d)));
			return {
				room,
				quote: remaining > 0 ? quoteFor(plan.id, room.id, checkin, nights, adults, 0) : null,
				remaining,
				fits: true
			};
		});

	return {
		facility,
		plan,
		rooms,
		calendar: calendarMonths.flatMap((month) => getPlanCalendar(plan.id, month)),
		memberOnsiteHint: memberOnsiteHint(found.payment, isMember),
		referenceMode: false,
		params: { checkin: checkin ?? '', nights, adults }
	};
};

export const actions: Actions = {
	hold: async (event) => {
		const { request, locals, cookies } = event;
		const form = await request.formData();
		const planId = String(form.get('planId'));
		const roomTypeId = String(form.get('roomTypeId'));
		const checkin = String(form.get('checkin'));
		const nights = Number(form.get('nights'));
		const adults = Number(form.get('adults'));
		if (!checkin || !planId || !roomTypeId) return fail(400, { message: '日付を選択してください' });

		if (DATA_SOURCE === 'supabase') {
			const sid = bookingSessionId(cookies);
			// 会員は authenticated client（member_user_id を記録）、ゲストは anon。
			const client = MEMBER_SUPABASE && locals.user?.role === 'member' ? createSupabaseServerClient(event) : undefined;
			const result = await sbCreateHold(sid, planId, roomTypeId, checkin, nights, adults, client);
			if ('error' in result) {
				return fail(409, { message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。' });
			}
			redirect(303, `/booking/hold?id=${result.hold_id}`);
		}

		const result = createHold(planId, roomTypeId, checkin, nights, adults, 0, locals.user?.role === 'member' ? locals.user.id : undefined);
		if ('error' in result) {
			return fail(409, { message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。' });
		}
		redirect(303, `/booking/hold?id=${result.id}`);
	}
};
