import { error, fail, redirect } from '@sveltejs/kit';
import {
	getFacilityBySlug,
	getRatePlans,
	roomTypes,
	remainingRooms,
	quoteFor,
	createHold
} from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import { holdRateCheck } from '$lib/server/hold-rate-limit';
import {
	sbFacilityBySlug,
	sbPlanBySlug,
	sbListRoomTypesMapped,
	sbPlanOffers,
	sbPlanReferenceMinPrices,
	offerToQuote,
	createHold as sbCreateHold,
	bookingSessionId
} from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import { eachNight } from '@autumn-book/core';
import { stayCalendar } from '$lib/server/stay-calendar';
import { loadPlanTemplates } from '$lib/server/plan-templates';
import { expandPlanText } from '$lib/plan-templates';
import { HOLD_NAV_COOKIE, safeLocalPath } from '$lib/booking-nav';
import { loadEarlyPrepaySettings } from '$lib/server/payment-settings';
import { viewerIsMember, withEarlyPrepayMax } from '$lib/server/direct-payments';
import { memberOnsiteHint, planForViewer } from '$lib/member-payment';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, url, locals }) => {
	// 支払方法の表示は閲覧者（会員かどうか）に合わせる（非会員の支払方法）
	const isMember = viewerIsMember(locals);
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.min(7, Math.max(1, Number(url.searchParams.get('nights') ?? 1)));
	const adults = Math.min(6, Math.max(1, Number(url.searchParams.get('adults') ?? 2)));
	// 日付ピッカー用: このプランで「指定泊数」泊まれる日（6か月先まで）。泊数を変えたら画面側で取り直す
	const CALENDAR_MONTHS = 6;

	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');
		const found = await sbPlanBySlug(facility.id, params.plan);
		if (!found) error(404, 'プランが見つかりません');
		// 早期決済割の対象プランは「予約時決済で最大 N%お得」を出す
		let [plan] = withEarlyPrepayMax([planForViewer(found, isMember)], await loadEarlyPrepaySettings(facility.id));
		// 紹介文のテンプレート（{{tpl:key}}）を展開し、「特典」は本文から外して予約ボタン横のバナーへ
		const expanded = expandPlanText(plan.description, await loadPlanTemplates(facility.id));
		plan = { ...plan, description: expanded.text, perks: expanded.perks };
		if (!checkin) {
			const referencePrices = await sbPlanReferenceMinPrices(facility.id, adults, plan.id);
			plan = { ...plan, basePrice: referencePrices.get(plan.id) ?? 0 };
		}

		// 「このプランで泊まれる客室と料金」は plan_offers が返す（プラン⇄客室はデモの roomTypeIds ではなく実データ）。
		// 日付未指定は 0 行 → 客室リストは出さず「日付を選択してください」を表示する。
		const [calendar, offers, rooms] = await Promise.all([
			stayCalendar(facility.id, nights, adults, { planId: plan.id, months: CALENDAR_MONTHS }),
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
			calendar: calendar.days,
			calendarThrough: calendar.through,
			calendarClosed: calendar.closed,
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

	const calendar = await stayCalendar(facility.id, nights, adults, { planId: plan.id, months: CALENDAR_MONTHS });
	return {
		facility,
		plan,
		rooms,
		calendar: calendar.days,
		calendarThrough: calendar.through,
			calendarClosed: calendar.closed,
		memberOnsiteHint: memberOnsiteHint(found.payment, isMember),
		referenceMode: false,
		params: { checkin: checkin ?? '', nights, adults }
	};
};

const HOLD_RATE_LIMITED_MESSAGE = 'お申し込みが集中しています。しばらく時間をおいてからお試しください。';

/** 接続元 IP（Cloudflare では cf-connecting-ip。取れなければ 'unknown'） */
function clientIp(event: { request: Request; getClientAddress: () => string }): string {
	const h = event.request.headers.get('cf-connecting-ip');
	if (h) return h;
	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}

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
		// 遷移経路（予約ボタンを押したページと、その手前のページ）を予約入力画面へ渡す
		const rememberNav = (holdId: string) =>
			cookies.set(HOLD_NAV_COOKIE, JSON.stringify({ id: holdId, back: safeLocalPath(String(form.get('back') ?? '')), via: safeLocalPath(String(form.get('via') ?? '')) }), {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 2
			});

		// 接続元ごとの回数制限（KV `hold:<ip>` 10 分 20 回・auth-hardening.md §9 S8）。DB 側にも同じ上限がある
		const ip = clientIp(event);
		if (!(await holdRateCheck(event.platform, ip))) {
			return fail(429, { message: HOLD_RATE_LIMITED_MESSAGE });
		}

		if (DATA_SOURCE === 'supabase') {
			const sid = bookingSessionId(cookies);
			// create_hold は service_role 専用（S8）。会員の紐付けは検証済みセッションの会員 id を渡す（会員でなければ null）
			const memberUserId = MEMBER_SUPABASE && locals.user?.role === 'member' ? locals.user.id : null;
			const result = await sbCreateHold(sid, planId, roomTypeId, checkin, nights, adults, { clientKey: ip, memberUserId });
			if ('error' in result) {
				if (result.error === 'rate_limited' || result.error === 'too_many_holds') {
					return fail(429, { message: HOLD_RATE_LIMITED_MESSAGE });
				}
				return fail(409, { message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。' });
			}
			rememberNav(String(result.hold_id));
			redirect(303, `/booking/hold?id=${result.hold_id}`);
		}

		const result = createHold(planId, roomTypeId, checkin, nights, adults, 0, locals.user?.role === 'member' ? locals.user.id : undefined);
		if ('error' in result) {
			return fail(409, { message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。' });
		}
		rememberNav(result.id);
		redirect(303, `/booking/hold?id=${result.id}`);
	}
};
