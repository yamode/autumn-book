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
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbPlanPreviewRow } from '$lib/server/content-admin';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import { holdRateCheck } from '$lib/server/hold-rate-limit';
import * as m from '$lib/paraglide/messages';
import {
	sbFacilityBySlug,
	sbPlanBySlug,
	sbListRoomTypesMapped,
	sbPlanOffers,
	sbPlanReferenceMinPrices,
	offerToQuote,
	createHoldGroup,
	sbRoomTypeByUuid,
	mapPlanRow,
	bookingSessionId
} from '$lib/server/supabase-data';
import { MAX_ROOMS_PER_BOOKING, parseHoldRooms, payCompatible } from '$lib/multi-room';
import { getLocale } from '$lib/paraglide/runtime';
import { eachNight } from '@autumn-book/core';
import { stayCalendar } from '$lib/server/stay-calendar';
import { loadPlanTemplates } from '$lib/server/plan-templates';
import { expandPlanText } from '$lib/plan-templates';
import { HOLD_NAV_COOKIE, safeLocalPath } from '$lib/booking-nav';
import { loadEarlyPrepaySettings } from '$lib/server/payment-settings';
import { viewerIsMember, withEarlyPrepayMax } from '$lib/server/direct-payments';
import { memberOnsiteHint, planForViewer } from '$lib/member-payment';
import { canBookPlans, planGate, secretPlanBySlug } from '$lib/server/secret-plans';
import { isStaffViewer, planOrPreview, previewPlanForHold } from '$lib/server/plan-preview';
import type { RoomType } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

/** スタッフが ?preview=1 で開いたときだけ、公開前のプランを読む。スタッフでなければ undefined（通常どおり 404 になる） */
async function staffPreviewPlan(event: Parameters<PageServerLoad>[0], facilityUuid: string, slug: string) {
	if (event.url.searchParams.get('preview') !== '1') return undefined;
	if (!isStaffViewer(event.locals)) return undefined;
	const row = await sbPlanPreviewRow(createSupabaseServerClient(event), facilityUuid, slug).catch(() => undefined);
	return row ? mapPlanRow(row) : undefined;
}

export const load: PageServerLoad = async (event) => {
	const { params, url, locals, cookies } = event;
	// 支払方法の表示は閲覧者（会員かどうか）に合わせる（非会員の支払方法）
	const isMember = viewerIsMember(locals);
	const checkin = url.searchParams.get('checkin') || undefined;
	const nights = Math.min(7, Math.max(1, Number(url.searchParams.get('nights') ?? 1)));
	const adults = Math.min(6, Math.max(1, Number(url.searchParams.get('adults') ?? 2)));
	// 検索した部屋数（一覧から持ってくる）。2 室以上のときだけ「予約リストに追加」で部屋を集めて一括予約する
	const roomCount = Math.min(MAX_ROOMS_PER_BOOKING, Math.max(1, Number(url.searchParams.get('rooms') ?? 1) || 1));
	// 日付ピッカー用: このプランで「指定泊数」泊まれる日（6か月先まで）。泊数を変えたら画面側で取り直す
	const CALENDAR_MONTHS = 6;

	if (DATA_SOURCE === 'supabase') {
		const facility = await sbFacilityBySlug(params.facility);
		if (!facility || facility.brandSlug !== params.brand) error(404, '施設が見つかりません');
		// 普通のプランで見つからなければシークレットプラン（会員限定・URL 限定）から探す。URL 限定で URL を開いていなければ 404
		// それでも無ければ（販売停止中・販売表示期間の外・料金なし）、スタッフの ?preview=1 だけ販売ページの見た目で確かめる。
		// プレビューは本物の在庫・料金で仮押さえして予約入力画面まで進めるが、確定はできない（v0.230.0・$lib/server/plan-preview）
		const open = await sbPlanBySlug(facility.id, params.plan);
		const secret = open ? undefined : await secretPlanBySlug(facility.id, params.plan, locals, cookies);
		const preview = open || secret ? undefined : await staffPreviewPlan(event, facility.id, params.plan);
		const found = open ?? secret?.plan ?? preview;
		if (!found) error(404, 'プランが見つかりません');
		const gate = secret?.gate ?? 'ok';
		// 料金・空室・仮押さえの RPC に「このプランを販売中と同じに扱う」印を付ける（スタッフのプレビューだけ）
		const previewPlanId = preview ? preview.id : undefined;
		// 早期決済割の対象プランは「予約時決済で最大 N%お得」を出す
		let [plan] = withEarlyPrepayMax([planForViewer(found, isMember)], await loadEarlyPrepaySettings(facility.id));
		// 紹介文のテンプレート（{{tpl:key}}）を展開し、「特典」は本文から外して予約ボタン横のバナーへ
		const expanded = expandPlanText(plan.description, await loadPlanTemplates(facility.id));
		plan = { ...plan, description: expanded.text, perks: expanded.perks };
		// 会員限定で予約できない閲覧者（gate=login/rank）には、料金・空室・客室は出さず案内だけ出す
		const bookable = gate === 'ok';
		if (!checkin && bookable) {
			const referencePrices = await sbPlanReferenceMinPrices(facility.id, adults, plan.id, previewPlanId);
			plan = { ...plan, basePrice: referencePrices.get(plan.id) ?? 0 };
		}

		// 「このプランで泊まれる客室と料金」は plan_offers が返す（プラン⇄客室はデモの roomTypeIds ではなく実データ）。
		// 日付未指定は 0 行 → 客室リストは出さず「日付を選択してください」を表示する。
		const [calendar, offers, rooms] = await Promise.all([
			bookable
				? stayCalendar(facility.id, nights, adults, { planId: plan.id, months: CALENDAR_MONTHS, previewPlanId })
				: Promise.resolve({ days: [], through: '', closed: [] }),
			checkin && bookable ? sbPlanOffers(facility.id, checkin, nights, adults, plan.id, previewPlanId) : Promise.resolve([]),
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
		// 客室を選んで入ってきた（?room=）が、日付未指定・その日は満室で上の行に無いとき: 客室は選んだまま見せる（2026-11-01）
		const roomSlug = url.searchParams.get('room') ?? '';
		const pickedRoom = roomSlug && !roomRows.some((r) => r.room.slug === roomSlug) ? (rooms.find((r) => r.slug === roomSlug) ?? null) : null;

		return {
			facility,
			plan,
			rooms: roomRows,
			pickedRoom,
			calendar: calendar.days,
			calendarThrough: calendar.through,
			calendarClosed: calendar.closed,
			// 非会員は予約時決済のみ・会員なら現地払いも選べる →「会員の方は現地払いも…」を添える
			memberOnsiteHint: MEMBER_SUPABASE && memberOnsiteHint(found.payment, isMember),
			referenceMode: !checkin,
			// 複数室（予約かご）は実データだけ（デモの store は 1 室）
			multiRoom: true,
			// シークレットプランの扱い（ok 以外は料金・客室を出さず、ログイン・グレードの案内を出す）
			gate,
			preview: !!preview,
			params: { checkin: checkin ?? '', nights, adults, rooms: roomCount }
		};
	}

	const locale = getLocale();
	const facility = getFacilityBySlug(params.brand, params.facility, locale);
	if (!facility) error(404, '施設が見つかりません');
	const found = getRatePlans(facility.id, locale).find((p) => p.slug === params.plan);
	if (!found) error(404, 'プランが見つかりません');
	const gate = await planGate(found, locals, cookies);
	if (gate === 'hidden') error(404, 'プランが見つかりません');
	const [plan] = withEarlyPrepayMax([planForViewer(found, isMember)], await loadEarlyPrepaySettings(facility.id));

	const rooms = (gate === 'ok' ? plan.roomTypeIds : [])
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
		// デモはプランの全客室が rooms に入る（選んだ客室はその中から探す）
		pickedRoom: null as RoomType | null,
		calendar: calendar.days,
		calendarThrough: calendar.through,
			calendarClosed: calendar.closed,
		memberOnsiteHint: memberOnsiteHint(found.payment, isMember),
		referenceMode: false,
		multiRoom: false,
		gate,
		preview: false,
		params: { checkin: checkin ?? '', nights, adults, rooms: roomCount }
	};
};

const HOLD_RATE_LIMITED_MESSAGE = 'お申し込みが集中しています。しばらく時間をおいてからお試しください。';
// 4 室目をかごに入れたときの注意と同じ文言（docs/official-multi-room.md §8.1）。言語は閲覧者に合わせる
const tooManyRoomsMessage = () => m.cart_full_notice({ max: String(MAX_ROOMS_PER_BOOKING), next: String(MAX_ROOMS_PER_BOOKING + 1) });

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
	// 予約へ進む: 部屋（1〜4 室）をまとめて仮押さえ（束）して予約入力へ。
	// 入力は rooms JSON `[{planId, roomTypeId, adults}]`（M1 のかご）か、従来の 1 室のフィールド planId / roomTypeId / adults。
	// 成功 303 /booking/hold?id=<束 id>。失敗 fail(409, {message, soldOut:[{roomTypeId, roomName}]}) / fail(429) /
	// fail(400, {message, code:'too_many_rooms'|'invalid'})（docs/official-multi-room.md §14.5）
	hold: async (event) => {
		const { request, locals, cookies, params } = event;
		const form = await request.formData();
		const checkin = String(form.get('checkin') ?? '');
		const nights = Number(form.get('nights'));
		const parsed = parseHoldRooms((k) => form.get(k));
		if (!checkin || (!parsed.ok && parsed.code === 'missing')) return fail(400, { message: '日付を選択してください' });
		if (!parsed.ok) {
			return parsed.code === 'too_many_rooms'
				? fail(400, { message: tooManyRoomsMessage(), code: 'too_many_rooms' as const })
				: fail(400, { message: 'お部屋の選び方を確認してください。', code: 'invalid' as const });
		}
		const rooms = parsed.rooms;
		// 遷移経路（予約ボタンを押したページと、その手前のページ）を予約入力画面へ渡す
		const rememberNav = (holdId: string) =>
			cookies.set(HOLD_NAV_COOKIE, JSON.stringify({ id: holdId, back: safeLocalPath(String(form.get('back') ?? '')), via: safeLocalPath(String(form.get('via') ?? '')) }), {
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				maxAge: 60 * 60 * 2
			});

		const ip = clientIp(event);
		// 仮押さえでは Turnstile を使わない（2026-11-01）。人の確認は非会員の予約確定（/booking/hold・/booking/pay）と会員ログインで行い、
		// ここは接続元ごとの回数制限（下）と DB 側の上限で守る

		// 接続元ごとの回数制限（KV `hold:<ip>` 10 分 20 回・auth-hardening.md §9 S8）。DB 側にも同じ上限がある
		if (!(await holdRateCheck(event.platform, ip))) {
			return fail(429, { message: HOLD_RATE_LIMITED_MESSAGE });
		}

		// シークレットプラン（会員限定・グレード以上・URL 限定）は、閲覧者が予約できるものだけ通す。
		// 仮押さえの RPC は service_role 専用で閲覧者を知らないので、ここが関所（かごの他プランも含めて確かめる）
		if (!(await canBookPlans(rooms.map((r) => r.planId), locals, cookies))) {
			return fail(403, { message: m.plan_gate_hold_denied(), code: 'invalid' as const });
		}

		if (DATA_SOURCE === 'supabase') {
			// スタッフのプレビュー（販売中でないプラン）は、そのプランを販売中と同じに扱わせて仮押さえする（確定は予約入力画面で止める）
			const previewHold = await previewPlanForHold(rooms.map((r) => r.planId), locals);
			if (previewHold.error) return fail(400, { message: 'このプラン・お部屋は現在ご予約いただけません。日程や人数を選び直してください。', code: 'invalid' as const });
			const sid = bookingSessionId(cookies);
			// create_hold は service_role 専用（S8）。会員の紐付けは検証済みセッションの会員 id を渡す（会員でなければ null）
			const memberUserId = MEMBER_SUPABASE && locals.user?.role === 'member' ? locals.user.id : null;
			const facility = await sbFacilityBySlug(params.facility);
			if (!facility || facility.brandSlug !== params.brand) return fail(400, { message: '施設が見つかりません', code: 'invalid' as const });
			// 支払方法が両立しないプランは同じ予約にできない（Q3。かごでも止めるが、ここでも止める）
			if (rooms.length > 1) {
				const isMember = viewerIsMember(locals);
				const plans = await Promise.all(
					[...new Set(rooms.map((r) => r.planId))].map((id) => planOrPreview(id, locals).then((x) => x?.plan).catch(() => undefined))
				);
				if (plans.some((p) => !p || p.facilityId !== facility.id)) {
					return fail(400, { message: 'このプラン・お部屋は現在ご予約いただけません。日程や人数を選び直してください。', code: 'invalid' as const });
				}
				if (!payCompatible(plans.map((p) => planForViewer(p!, isMember).payment))) {
					return fail(400, { message: m.cart_mixed_payment(), code: 'mixed_payment' as const });
				}
			}
			const result = await createHoldGroup(sid, facility.id, checkin, nights, rooms, {
				clientKey: ip,
				memberUserId,
				locale: getLocale(),
				previewPlanId: previewHold.previewPlanId
			});
			if ('error' in result) {
				if (result.error === 'rate_limited' || result.error === 'too_many_holds') {
					return fail(429, { message: HOLD_RATE_LIMITED_MESSAGE });
				}
				if (result.error === 'too_many_rooms') return fail(400, { message: tooManyRoomsMessage(), code: 'too_many_rooms' as const });
				if (result.error === 'invalid') return fail(400, { message: 'このプラン・お部屋は現在ご予約いただけません。日程や人数を選び直してください。', code: 'invalid' as const });
				// どの部屋が取れなかったか（M1 のかごはそのまま残して、この部屋タイプを出す）
				const soldOut = result.soldOutRoomTypeId
					? [{ roomTypeId: result.soldOutRoomTypeId, roomName: (await sbRoomTypeByUuid(result.soldOutRoomTypeId).catch(() => null))?.name ?? '' }]
					: [];
				return fail(409, { message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。', soldOut });
			}
			rememberNav(result.groupId);
			redirect(303, `/booking/hold?id=${result.groupId}`);
		}

		// デモ（store.ts）は 1 室だけ
		const { planId, roomTypeId, adults } = rooms[0];
		const result = createHold(planId, roomTypeId, checkin, nights, adults, 0, locals.user?.role === 'member' ? locals.user.id : undefined);
		if ('error' in result) {
			return fail(409, { message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。' });
		}
		rememberNav(result.id);
		redirect(303, `/booking/hold?id=${result.id}`);
	}
};
