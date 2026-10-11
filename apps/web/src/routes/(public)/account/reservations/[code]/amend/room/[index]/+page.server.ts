// 公式マイページ: 2 室以上のご予約の「このお部屋を変更」（部屋タイプ・プラン・人数・公式の複数室 M3・docs/official-multi-room.md §17.3.1・§18）。
// 日程は変えない（日程は amend/ の全室同時の変更）。1 室のご予約は従来の変更ウィザード（amend/）へ回す。
//   load:   候補（sbPlanOffers: プラン × 部屋タイプ・残室・人数は ?adults=）→ 選んだ候補（?offer=planId__roomTypeId）で見積（quote_amendment_rooms）
//   action: ?/confirm（ratePlanId・roomTypeId・adults）→ amend_booking_rooms → 303 予約詳細
// 規則（締切・回数〔日程変更と共有・2 + (室数 − 1)〕・ペナルティ・在庫・定員・支払方法の両立・オンライン決済済みは不可）は DB が確かめる。
import { error, fail, redirect } from '@sveltejs/kit';
import { facilityById } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { MEMBER_PAGE_BOOKING_MESSAGE, amendGate, memberPageBookingOf } from '$lib/server/member-reservation-detail';
import {
	reverseFacilityUuid,
	sbAmendBookingRooms,
	sbListMyAmendments,
	sbListPlansMapped,
	sbListRoomTypesMapped,
	sbMyReservations,
	sbPlanOffers,
	sbQuoteAmendmentRooms,
	quote as sbQuote,
	type AmendRoomsQuote
} from '$lib/server/supabase-data';
import { directPaymentForBooking } from '$lib/server/direct-payments';
import { amendRoomErrorCode, amendRoomErrorStatus, parseAdults, type AmendRoomErrorCode } from '$lib/multi-room';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const OFFER_SEP = '__';

/** 部屋の変更の失敗の文言（公式・paraglide） */
function amendRoomMessage(code: AmendRoomErrorCode): string {
	switch (code) {
		case 'prepaid_online':
			return m.amend_prepaid_blocked();
		case 'past_deadline':
			return m.amend_err_past_deadline();
		case 'past_checkin':
			return m.amend_err_past_checkin();
		case 'min_stay':
			return m.amend_err_min_stay();
		case 'amend_limit':
			return m.amend_err_limit();
		case 'in_penalty':
			return m.amend_err_penalty();
		case 'no_change':
			return m.amend_err_no_change();
		case 'sold_out':
			return m.amend_err_sold_out();
		case 'payment_incompatible':
			return m.amend_err_payment_incompatible();
		case 'over_capacity':
			return m.amend_err_over_capacity();
		case 'room_not_found':
		case 'not_amendable':
			return m.amend_err_room_not_found();
		case 'member_page_booking':
			return MEMBER_PAGE_BOOKING_MESSAGE;
		case 'plan_not_found':
		case 'not_sellable':
		case 'invalid':
		case 'not_found':
			return m.amend_err_not_sellable();
		default:
			return m.amend_failed();
	}
}

async function isPrepaidOnline(code: string): Promise<boolean> {
	const pay = await directPaymentForBooking(code).catch(() => null);
	return !!pay && pay.status === 'paid' && pay.refund_status !== 'full';
}

/** 変更の候補（プラン × 部屋タイプ。今の日程・指定の人数で料金が出るもの） */
export interface AmendRoomCandidate {
	ratePlanId: string;
	roomTypeId: string;
	planName: string;
	roomName: string;
	/** この部屋の宿泊料金（今の日程・指定の人数） */
	total: number;
	perPerson: number;
	/** 残室（今の空き。自分の部屋の分は含まない）。今の部屋タイプの候補は null（純増 0 なので在庫を問わない・表示しない） */
	remaining: number | null;
	/** 今の部屋と同じ部屋タイプ・プラン */
	current: boolean;
	/** 選べるか（現地払いのできるプラン・残室あり〔同じ部屋タイプは残室を問わない〕・定員内） */
	selectable: boolean;
	/** 選べない理由 */
	blocked: 'payment' | 'sold_out' | 'capacity' | null;
}

export const load: PageServerLoad = async (event) => {
	const { params, url } = event;
	const back = `/account/reservations/${params.code}`;
	// デモ（store）は複数室の予約が無い
	if (!MEMBER_SUPABASE) redirect(303, back);

	const index = Number(params.index);
	if (!Number.isInteger(index) || index < 1) error(404, m.error_booking_not_found());
	const client = createSupabaseServerClient(event);
	const r = (await sbMyReservations(client)).find((x) => x.code === params.code);
	if (!r) error(404, m.error_booking_not_found());
	// 専用ページ経由の予約は専用ページのご予約一覧から（§13.4.4）。予約中でなければ詳細へ
	if (r.memberPage || r.status !== 'reserved') redirect(303, back);
	// 1 室の予約は従来の変更ウィザード（日程・部屋・プラン・人数をまとめて）
	if ((r.rooms?.length ?? 0) <= 1) redirect(303, `${back}/amend`);
	const room = (r.rooms ?? []).find((x) => x.index === index && !x.cancelled);
	if (!room) error(404, m.error_booking_not_found());
	if (await isPrepaidOnline(r.code)) redirect(303, `${back}?amend=prepaid`);

	const storeId = reverseFacilityUuid(r.facilityUuid);
	const f = storeId ? facilityById(storeId) : undefined;
	if (!f) error(404, m.error_booking_not_found());

	const [plans, roomTypes] = await Promise.all([
		sbListPlansMapped(r.facilityUuid).catch(() => []),
		sbListRoomTypesMapped(r.facilityUuid).catch(() => [])
	]);
	const planById = new Map(plans.map((p) => [p.id, p]));
	const roomById = new Map(roomTypes.map((t) => [t.id, t]));

	const adults = parseAdults(url.searchParams.get('adults')) ?? room.adults;
	const offers = await sbPlanOffers(r.facilityUuid, r.checkin, r.nights, adults).catch(() => []);
	// 今の部屋タイプの候補（2026-10-11 レビュー M-1）: book.plan_offers は残室 0 の部屋タイプを返さないので、今の部屋タイプは
	// 公開プランごとに book.quote で見積を引いて足す（同じ部屋タイプは純増 0 で在庫を問わない・残室は出さない）
	const offered = new Set(offers.filter((o) => o.roomTypeId === room.roomTypeId).map((o) => o.ratePlanId));
	const sameTypeExtra = (
		await Promise.all(
			plans
				.filter((p) => !offered.has(p.id) && (p.roomTypeIds.length === 0 || p.roomTypeIds.includes(room.roomTypeId)))
				.map(async (p) => {
					const q = await sbQuote(p.id, room.roomTypeId, r.checkin, r.nights, adults).catch(() => null);
					return q ? { ratePlanId: p.id, roomTypeId: room.roomTypeId, total: q.total, perPerson: q.perPerson, remaining: null as number | null } : null;
				})
		)
	).filter((x) => x !== null);
	const rows: { ratePlanId: string; roomTypeId: string; total: number; perPerson: number; remaining: number | null }[] = [
		...offers.map((o) => (o.roomTypeId === room.roomTypeId ? { ...o, remaining: null } : o)),
		...sameTypeExtra
	];
	const candidates: AmendRoomCandidate[] = rows.map((o) => {
		const plan = planById.get(o.ratePlanId);
		const rt = roomById.get(o.roomTypeId);
		const sameType = o.roomTypeId === room.roomTypeId;
		const blocked: AmendRoomCandidate['blocked'] =
			plan && !plan.payment.onsite
				? 'payment'
				: rt && rt.capacity > 0 && adults > rt.capacity
					? 'capacity'
					: !sameType && (o.remaining ?? 0) < 1
						? 'sold_out'
						: null;
		return {
			ratePlanId: o.ratePlanId,
			roomTypeId: o.roomTypeId,
			planName: plan?.name ?? '',
			roomName: rt?.name ?? '',
			total: o.total,
			perPerson: o.perPerson,
			remaining: o.remaining,
			current: o.ratePlanId === room.planId && sameType,
			selectable: blocked === null,
			blocked
		};
	});

	// 選んだ候補（?offer=planId__roomTypeId）。無ければ今の組み合わせ
	const offerParam = url.searchParams.get('offer') ?? '';
	const [selPlan, selRoom] = offerParam.includes(OFFER_SEP) ? offerParam.split(OFFER_SEP) : [room.planId ?? '', room.roomTypeId];
	const sel = candidates.find((c) => c.ratePlanId === selPlan && c.roomTypeId === selRoom) ?? null;

	// 見積（今と違うときだけ）
	let quote: AmendRoomsQuote | null = null;
	let quoteError: string | null = null;
	const changed = !!sel && (sel.ratePlanId !== room.planId || sel.roomTypeId !== room.roomTypeId || adults !== room.adults);
	if (sel && changed) {
		try {
			quote = await sbQuoteAmendmentRooms(client, r.code, [{ index, ratePlanId: sel.ratePlanId, roomTypeId: sel.roomTypeId, adults }]);
		} catch (e) {
			quoteError = amendRoomMessage(amendRoomErrorCode(e));
		}
	} else if (offerParam && !sel) {
		quoteError = m.amend_err_not_sellable();
	}

	const amendCount = (await sbListMyAmendments(client, r.code).catch(() => [])).length;
	const gate = amendGate(r.status, r.checkin, amendCount, r.rooms?.length ?? 1);
	return {
		code: r.code,
		facility: { name: f.name, phone: f.phone },
		checkin: r.checkin,
		nights: r.nights,
		room: {
			index,
			stayCode: room.stayCode,
			roomTypeId: room.roomTypeId,
			planId: room.planId,
			roomName: roomById.get(room.roomTypeId)?.name ?? '',
			planName: room.planId ? (planById.get(room.planId)?.name ?? '') : '',
			adults: room.adults,
			total: room.roomTotal,
			charge: room.charge
		},
		candidates,
		adults,
		selected: sel ? { ratePlanId: sel.ratePlanId, roomTypeId: sel.roomTypeId } : null,
		quote,
		quoteError,
		amendRemaining: quote?.amendRemaining ?? gate.remaining,
		amendLimit: quote?.amendLimit ?? gate.limit,
		hrefs: { back, self: `${back}/amend/room/${index}` }
	};
};

export const actions: Actions = {
	confirm: async (event) => {
		const { request, params } = event;
		const back = `/account/reservations/${params.code}`;
		if (!MEMBER_SUPABASE) return fail(400, { code: 'invalid' as const, message: m.amend_failed() });
		const index = Number(params.index);
		const form = await request.formData();
		const ratePlanId = String(form.get('ratePlanId') ?? '');
		const roomTypeId = String(form.get('roomTypeId') ?? '');
		const adults = parseAdults(form.get('adults'));
		if (!Number.isInteger(index) || index < 1 || !ratePlanId || !roomTypeId || adults === null) {
			return fail(400, { code: 'invalid' as const, message: m.amend_failed() });
		}
		const client = createSupabaseServerClient(event);
		const mp = await memberPageBookingOf(client, params.code);
		if (mp) return fail(403, { code: 'member_page_booking' as const, message: MEMBER_PAGE_BOOKING_MESSAGE, href: mp.href });
		if (await isPrepaidOnline(params.code)) return fail(400, { code: 'prepaid_online' as const, message: m.amend_prepaid_blocked() });
		try {
			await sbAmendBookingRooms(client, params.code, [{ index, ratePlanId, roomTypeId, adults }]);
		} catch (e) {
			const code = amendRoomErrorCode(e);
			return fail(amendRoomErrorStatus(code), { code, message: amendRoomMessage(code) });
		}
		redirect(303, back);
	}
};
