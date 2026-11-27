// 公式マイページ: 2 室以上のご予約の「このお部屋を変更」（部屋タイプ・プラン・人数・公式の複数室 M3・docs/official-multi-room.md §17.3.1・§18）。
// 日程は変えない（日程は amend/ の全室同時の変更）。1 室のご予約は従来の変更ウィザード（amend/）へ回す。
// プライベートブック（専用ページ経由）の予約は室数を問わずここで変える（専用料金・book.member_page_*_rooms・docs/private-book.md）。
//   load:   候補（sbPlanOffers: プラン × 部屋タイプ・残室・人数は ?adults=）→ 選んだ候補（?offer=planId__roomTypeId）で見積（quote_amendment_rooms）
//   action: ?/confirm（ratePlanId・roomTypeId・adults）→ amend_booking_rooms → 303 予約詳細
// 規則（締切・回数〔日程変更と共有・2 + (室数 − 1)〕・ペナルティ・在庫・定員・支払方法の両立・オンライン決済済みは不可）は DB が確かめる。
import { error, fail, redirect } from '@sveltejs/kit';
import { facilityById } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { memberPageBookingMessage, amendGate } from '$lib/server/member-reservation-detail';
import {
	memberAmendRoomInput,
	memberPageAmendRooms,
	memberPageBookingRooms,
	memberPageOpError,
	memberPageQuoteAmendRooms,
	memberRoomCandidates
} from '$lib/server/partners/member-bookings';
import { memberPlanKey } from '$lib/server/partners/member-hold';
import { privateBookChangeGate, privateBookReservationOf } from '$lib/server/private-book-bookings';
import {
	PRIVATE_BOOK_FORBIDDEN_MESSAGE,
	privateBookOfferKey,
	privateBookRouteOf,
	splitPrivateBookPlanKey,
	type PrivateBookWho
} from '$lib/private-book-booking';
import type { MemberReservation } from '$lib/server/supabase-data';
import type { RequestEvent } from '@sveltejs/kit';
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
import {
	AMEND_ROOM_MESSAGES_JA,
	amendRoomErrorCode,
	amendRoomErrorStatus,
	parseAdults,
	type AmendRoomErrorCode,
	type AmendRoomInput
} from '$lib/multi-room';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

const OFFER_SEP = '__';
// プライベートブックの部屋タイプ・プランのコード（B面と同じ形）
const CODE_RE = /^[A-Za-z0-9_.-]{1,40}$/;

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
			return memberPageBookingMessage();
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

/**
 * プライベートブック（専用ページ経由）の予約の「このお部屋を変更」（B面の /p/<token>/bookings/<code>/amend/room/<n> と同じ計算）。
 * 画面は公式と同じ形にする: 候補の ratePlanId に planCode■planName、roomTypeId に部屋タイプのコードを入れる
 * （offer=<planCode■planName>__<部屋タイプのコード>。確定ではサーバが泊明細と特典を作り直す・画面の金額は受け取らない）
 */
async function privateBookRoomLoad(event: RequestEvent, who: PrivateBookWho, r: MemberReservation, index: number) {
	const back = `/account/reservations/${r.code}`;
	const gate = await privateBookChangeGate(who, r.facilityUuid);
	if (!gate.ok) redirect(303, back);
	const storeId = reverseFacilityUuid(r.facilityUuid);
	const f = storeId ? facilityById(storeId) : undefined;
	if (!f) error(404, m.error_booking_not_found());
	let booking: Awaited<ReturnType<typeof memberPageBookingRooms>>;
	try {
		booking = await memberPageBookingRooms(who);
	} catch (e) {
		const err = memberPageOpError(e);
		error(err.status === 500 ? 503 : err.status, err.message);
	}
	if (booking.status !== 'confirmed') redirect(303, back);
	const room = booking.rooms.find((x) => x.index === index && !x.cancelled);
	if (!room) error(404, m.error_booking_not_found());
	// オンライン決済済みは変更不可（取消 → 取り直しか電話・決定 M2）
	if (await isPrepaidOnline(r.code)) redirect(303, `${back}?amend=prepaid`);

	const own = (r.rooms ?? []).find((x) => x.index === index);
	const roomKey = memberPlanKey(room.planCode, room.planLabel);
	const adults = parseAdults(event.url.searchParams.get('adults')) ?? room.adults;
	const cand = await memberRoomCandidates(gate.db, gate.partner, booking, index, adults);
	const candidates: AmendRoomCandidate[] = cand.ok
		? cand.candidates.map((c) => ({
				ratePlanId: memberPlanKey(c.planCode, c.planName),
				roomTypeId: c.roomCode,
				planName: c.planName,
				roomName: c.roomName,
				total: c.total,
				perPerson: c.perPerson,
				remaining: c.roomCode === room.roomCode ? null : c.remaining,
				current: c.current,
				selectable: c.selectable,
				blocked: c.blocked
			}))
		: [];
	// 選んだ候補（?offer=）。無ければ今の組み合わせ。識別は文字列ごと突き合わせる（プラン名に区切りが入っても分け間違えない）
	const offerParam = event.url.searchParams.get('offer') ?? '';
	const sel = offerParam
		? (candidates.find((c) => privateBookOfferKey(c.ratePlanId, c.roomTypeId) === offerParam) ?? null)
		: (candidates.find((c) => c.current) ?? null);

	let quote: AmendRoomsQuote | null = null;
	let quoteError: string | null = cand.ok ? null : cand.message;
	const changed = !!sel && (sel.ratePlanId !== roomKey || sel.roomTypeId !== room.roomCode || adults !== room.adults);
	if (sel && changed) {
		const plan = splitPrivateBookPlanKey(sel.ratePlanId);
		const input = plan
			? await memberAmendRoomInput(gate.db, gate.partner, booking, index, { roomCode: sel.roomTypeId, ...plan, adults })
			: { ok: false as const, message: AMEND_ROOM_MESSAGES_JA.invalid };
		if (!input.ok) quoteError = input.message;
		else {
			try {
				quote = await memberPageQuoteAmendRooms(who, [input.input]);
			} catch (e) {
				quoteError = AMEND_ROOM_MESSAGES_JA[amendRoomErrorCode(e)];
			}
		}
	} else if (offerParam && !sel && cand.ok) {
		quoteError = 'このお部屋・プランは選べません（専用料金が設定されていない日があります）。';
	}

	const amendCount = (await sbListMyAmendments(createSupabaseServerClient(event), r.code).catch(() => [])).length;
	const amendGateNow = amendGate(r.status, r.checkin, amendCount, booking.rooms.length);
	return {
		code: r.code,
		facility: { name: f.name, phone: f.phone },
		checkin: booking.checkIn,
		nights: booking.nights,
		room: {
			index,
			stayCode: own?.stayCode ?? '',
			roomTypeId: room.roomCode,
			planId: roomKey as string | null,
			roomName: room.roomName,
			planName: room.planLabel,
			adults: room.adults,
			total: room.roomTotal,
			charge: own?.charge ?? room.roomTotal
		},
		candidates,
		adults,
		selected: sel ? { ratePlanId: sel.ratePlanId, roomTypeId: sel.roomTypeId } : null,
		quote,
		quoteError,
		amendRemaining: quote?.amendRemaining ?? amendGateNow.remaining,
		amendLimit: quote?.amendLimit ?? amendGateNow.limit,
		hrefs: { back, self: `${back}/amend/room/${index}` }
	};
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
	// 予約中でなければ詳細へ
	if (r.status !== 'reserved') redirect(303, back);
	// プライベートブック（専用ページ経由）の予約: 室数を問わず（1 室も）・専用料金で計算し直す（B面の amend/room と同じ）
	const route = privateBookRouteOf(r, event.locals.user?.id);
	if (route.kind === 'deny') redirect(303, back);
	if (route.kind === 'private_book') return privateBookRoomLoad(event, route.who, r, index);
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
		// プライベートブック（専用ページ経由）の予約: ratePlanId は planCode■planName、roomTypeId は部屋タイプのコード（load と同じ）。
		// 泊明細と新しいプランの特典はサーバが作り直す（B面と同じ・文言も同じ）
		const found = await privateBookReservationOf(event, params.code).catch(() => null);
		if (found?.route.kind === 'deny') return fail(403, { code: 'forbidden' as const, message: PRIVATE_BOOK_FORBIDDEN_MESSAGE });
		if (found?.route.kind === 'private_book') {
			const who = found.route.who;
			const plan = splitPrivateBookPlanKey(ratePlanId);
			if (!plan || !CODE_RE.test(roomTypeId) || !CODE_RE.test(plan.planCode) || plan.planName.length > 200) {
				return fail(400, { code: 'invalid' as const, message: AMEND_ROOM_MESSAGES_JA.invalid });
			}
			const gate = await privateBookChangeGate(who, found.r.facilityUuid);
			if (!gate.ok) return fail(403, { code: 'forbidden' as const, message: gate.message });
			if (await isPrepaidOnline(params.code)) return fail(400, { code: 'prepaid_online' as const, message: AMEND_ROOM_MESSAGES_JA.prepaid_online });
			try {
				const booking = await memberPageBookingRooms(who);
				const input: { ok: true; input: AmendRoomInput } | { ok: false; message: string } = await memberAmendRoomInput(gate.db, gate.partner, booking, index, {
					roomCode: roomTypeId,
					...plan,
					adults
				});
				if (!input.ok) return fail(400, { code: 'unavailable' as const, message: input.message });
				await memberPageAmendRooms(who, [input.input]);
			} catch (e) {
				const c = amendRoomErrorCode(e);
				return fail(amendRoomErrorStatus(c), { code: c, message: AMEND_ROOM_MESSAGES_JA[c] });
			}
			redirect(303, back);
		}
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
