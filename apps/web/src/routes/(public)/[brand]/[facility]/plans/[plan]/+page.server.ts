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
	offerToQuote,
	createHold as sbCreateHold,
	getPlanCalendar as sbGetPlanCalendar,
	bookingSessionId
} from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import { eachNight } from '@autumn-book/core';
import { clampCalendarMonth } from '$lib/calendar-range';
import { parseChildren } from '$lib/components/guests';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url }) => {
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.max(1, Number(url.searchParams.get('nights') ?? 1));
	const adults = Math.max(1, Number(url.searchParams.get('adults') ?? 2));
	// 子どもの人数（未指定は 0）。デモは定員判定・子供料金に反映。実データ（supabase）は quote / create_hold が
	// 子ども未対応（book.holds.child_counts は '{}' 固定・設計書 §14-11）のため、大人のみの料金を出し予約は電話へ誘導する
	const children = parseChildren(url.searchParams.get('children'));

	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');
		const plan = await sbPlanBySlug(facility.id, params.plan);
		if (!plan) error(404, 'プランが見つかりません');

		const calendarNav = clampCalendarMonth(url.searchParams.get('cal') ?? checkin?.slice(0, 7));
		const calMonth = calendarNav.yearMonth;

		// 「このプランで泊まれる客室と料金」は plan_offers が返す（プラン⇄客室はデモの roomTypeIds ではなく実データ）。
		// 日付未指定は 0 行 → 客室リストは出さず「日付を選択してください」を表示する。
		const [calendar, offers, rooms] = await Promise.all([
			sbGetPlanCalendar(plan.id, calMonth),
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
			calendar,
			calMonth,
			calendarNav,
			childrenSupported: false,
			params: { checkin: checkin ?? '', nights, adults, children }
		};
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	const plan = getRatePlans(facility.id, locale).find((p) => p.slug === params.plan);
	if (!plan) error(404, 'プランが見つかりません');

	const calendarNav = clampCalendarMonth(url.searchParams.get('cal') ?? checkin?.slice(0, 7));
	const calMonth = calendarNav.yearMonth;

	const rooms = plan.roomTypeIds
		.map((id) => roomTypes.find((r) => r.id === id)!)
		.map((room) => {
			// 定員は大人＋子どもで判定する
			const fits = room.capacity >= adults + children;
			if (!checkin || !fits) {
				return { room, quote: null, remaining: checkin ? 0 : null, fits };
			}
			const remaining = Math.min(...eachNight(checkin, nights).map((d) => remainingRooms(room.id, d)));
			return {
				room,
				quote: remaining > 0 ? quoteFor(plan.id, room.id, checkin, nights, adults, children) : null,
				remaining,
				fits: true
			};
		});

	return {
		facility,
		plan,
		rooms,
		calendar: getPlanCalendar(plan.id, calMonth),
		calMonth,
		calendarNav,
		childrenSupported: true,
		params: { checkin: checkin ?? '', nights, adults, children }
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
		const children = parseChildren(form.get('children'));
		if (!checkin || !planId || !roomTypeId) return fail(400, { message: '日付を選択してください' });

		if (DATA_SOURCE === 'supabase') {
			// create_hold は子ども未対応（p_child_counts 無し）。大人のみで仮押さえすると人数・料金が実態と
			// 食い違うため、子ども連れはオンラインで受けずに電話へ誘導する（画面側でもボタンを出していない）
			if (children > 0) return fail(400, { message: m.children_unsupported_note() });
			const sid = bookingSessionId(cookies);
			// 会員は authenticated client（member_user_id を記録）、ゲストは anon。
			const client = MEMBER_SUPABASE && locals.user?.role === 'member' ? createSupabaseServerClient(event) : undefined;
			const result = await sbCreateHold(sid, planId, roomTypeId, checkin, nights, adults, client);
			if ('error' in result) {
				return fail(409, { message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。' });
			}
			redirect(303, `/booking/hold?id=${result.hold_id}`);
		}

		// 定員（大人＋子ども）を超える客室は受けない（画面は fits=false でボタンを出さないが、直接 POST 対策）
		const room = roomTypes.find((r) => r.id === roomTypeId);
		if (!room || room.capacity < adults + children) return fail(400, { message: m.plan_detail_no_fit() });
		const result = createHold(planId, roomTypeId, checkin, nights, adults, children, locals.user?.role === 'member' ? locals.user.id : undefined);
		if ('error' in result) {
			return fail(409, { message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。' });
		}
		redirect(303, `/booking/hold?id=${result.id}`);
	}
};
