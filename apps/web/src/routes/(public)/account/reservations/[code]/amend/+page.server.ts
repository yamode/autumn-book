import { error, fail, redirect } from '@sveltejs/kit';
import {
	bookings,
	facilityById,
	planById,
	roomTypeById,
	amendOffers,
	quoteAmendment,
	amendBooking
} from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import {
	memberAmendLines,
	memberPageAmendDates,
	memberPageBookingRooms,
	memberPageOpError,
	memberPageQuoteAmendDates
} from '$lib/server/partners/member-bookings';
import { privateBookChangeGate, privateBookReservationOf } from '$lib/server/private-book-bookings';
import { todayJst } from '$lib/server/partners/store';
import { PRIVATE_BOOK_FORBIDDEN_MESSAGE, privateBookRouteOf, type PrivateBookWho } from '$lib/private-book-booking';
import type { AmendDatesQuote, MemberReservation } from '$lib/server/supabase-data';
import {
	sbMyReservations,
	sbPlanOffers,
	sbQuoteAmendment,
	sbAmendBooking,
	sbQuoteAmendmentDates,
	sbAmendBookingDates,
	sbPlanByUuid,
	sbRoomTypeByUuid,
	sbListPlansMapped,
	sbListRoomTypesMapped,
	reverseFacilityUuid
} from '$lib/server/supabase-data';
import { directPaymentForBooking } from '$lib/server/direct-payments';
import * as m from '$lib/paraglide/messages';
import type { AmendParams, AmendQuote } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// オンライン決済（v0.43.0）で払った予約か（返金が残っていない＝支払済みのもの）
async function isPrepaidOnline(code: string): Promise<boolean> {
	const pay = await directPaymentForBooking(code).catch(() => null);
	return !!pay && pay.status === 'paid' && pay.refund_status !== 'full';
}

// RPC/store の例外メッセージ → i18n 文言（部分一致で拾う）。datesOnly: 2 室以上の全室同時の日程変更
function amendErrorMessage(msg: string, datesOnly = false): string {
	if (msg.includes('prepaid_online')) return m.amend_prepaid_blocked();
	if (datesOnly && msg.includes('sold_out')) return m.amend_err_sold_out_all();
	if (msg.includes('past_deadline')) return m.amend_err_past_deadline();
	if (msg.includes('amend_limit')) return m.amend_err_limit();
	if (msg.includes('amend_in_penalty')) return m.amend_err_penalty();
	if (msg.includes('no_change')) return m.amend_err_no_change();
	if (msg.includes('sold_out')) return m.amend_err_sold_out();
	if (
		msg.includes('past_checkin') ||
		msg.includes('min_stay_violation') ||
		msg.includes('not_sellable') ||
		msg.includes('plan_not_found') ||
		msg.includes('not_found')
	)
		return m.amend_err_not_sellable();
	return m.amend_failed();
}

// 変更ウィザードで提示する候補（プラン×客室×料金×残室＋表示名）
interface AmendOfferView {
	ratePlanId: string;
	roomTypeId: string;
	planName: string;
	roomName: string;
	total: number;
	perPerson: number;
	remaining: number;
}

// 変更前の現状（名称は表示解決できたぶんだけ）
interface AmendCurrent {
	ratePlanId: string;
	roomTypeId: string;
	planName: string;
	roomName: string;
	checkin: string;
	nights: number;
	adults: number;
	total: number;
}

function clampInt(raw: string | null, def: number, min: number, max: number): number {
	const n = Number(raw);
	if (!Number.isFinite(n) || n <= 0) return def;
	return Math.min(max, Math.max(min, Math.floor(n)));
}

const OFFER_SEP = '__';

export const load: PageServerLoad = async (event) => {
	const { params, url, locals } = event;

	// --- 現状・候補・見積の材料を demo / supabase で用意する ---
	let facility: { name: string; phone: string };
	let facilityKey: string; // demo: facilityId / supabase: facility UUID
	let current: AmendCurrent;
	let planName: (id: string) => string;
	let roomName: (id: string) => string;
	let getQuote: (p: AmendParams) => Promise<AmendQuote> | AmendQuote;
	let getOffers: (checkin: string, nights: number, adults: number) => Promise<AmendOfferView[]> | AmendOfferView[];

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const reservations = await sbMyReservations(client);
		const r = reservations.find((x) => x.code === params.code);
		if (!r) error(404, m.error_booking_not_found());
		if (r.status !== 'reserved') redirect(303, `/account/reservations/${params.code}`);
		// オンライン決済済みの予約は変更させない（金額が変わると支払額と食い違うため。宿へ電話で）
		if (await isPrepaidOnline(params.code)) redirect(303, `/account/reservations/${params.code}?amend=prepaid`);
		// プライベートブック（専用ページ経由）の予約: 専用料金で日付・泊数だけを変える（B面の /p/<token>/bookings/<code>/amend と同じ）
		const route = privateBookRouteOf(r, locals.user?.id);
		if (route.kind === 'deny') redirect(303, `/account/reservations/${params.code}`);
		if (route.kind === 'private_book') return privateBookAmendLoad(route.who, r, url);
		// 2 室以上の予約（M2）: 日付・泊数だけを全室同時に変える（部屋・プラン・人数は変えない・§6.3）
		if ((r.rooms?.length ?? 0) > 1) {
			const f2 = reverseFacilityUuid(r.facilityUuid);
			const fac = f2 ? facilityById(f2) : undefined;
			if (!fac) error(404, m.error_booking_not_found());
			const live = (r.rooms ?? []).filter((x) => !x.cancelled);
			const names = new Map<string, string>();
			await Promise.all(
				[...new Set(live.flatMap((x) => [`r:${x.roomTypeId}`, x.planId ? `p:${x.planId}` : '']).filter(Boolean))].map(async (k) => {
					const id = k.slice(2);
					const v = k.startsWith('r:') ? await sbRoomTypeByUuid(id).catch(() => undefined) : await sbPlanByUuid(id).catch(() => undefined);
					names.set(k, v?.name ?? '');
				})
			);
			const checkin = url.searchParams.get('checkin') || r.checkin;
			const nights = clampInt(url.searchParams.get('nights'), r.nights, 1, 5);
			let quote: Awaited<ReturnType<typeof sbQuoteAmendmentDates>> | null = null;
			let quoteError: string | null = null;
			try {
				quote = await sbQuoteAmendmentDates(client, params.code, checkin, nights);
			} catch (e) {
				quoteError = amendErrorMessage(e instanceof Error ? e.message : String(e), true);
			}
			const adults = live.reduce((s, x) => s + x.adults, 0);
			return {
				code: params.code,
				facility: { name: fac.name, phone: fac.phone },
				facilityKey: r.facilityUuid,
				current: {
					ratePlanId: r.ratePlanUuid,
					roomTypeId: r.roomTypeUuid,
					planName: '',
					roomName: '',
					checkin: r.checkin,
					nights: r.nights,
					adults,
					total: r.total
				} satisfies AmendCurrent,
				checkin,
				nights,
				adults,
				offers: [] as AmendOfferView[],
				selected: null,
				quote: quote as AmendQuote | null,
				quoteError,
				datesOnly: true as boolean,
				privateBook: false as boolean,
				available: quote?.available ?? true,
				roomsView: live.map((x) => ({
					index: x.index,
					roomName: names.get(`r:${x.roomTypeId}`) ?? '',
					planName: x.planId ? (names.get(`p:${x.planId}`) ?? '') : '',
					adults: x.adults,
					total: x.charge,
					newTotal: quote?.rooms.find((q) => q.index === x.index)?.charge ?? null
				}))
			};
		}
		const storeId = reverseFacilityUuid(r.facilityUuid);
		const f = storeId ? facilityById(storeId) : undefined;
		if (!f) error(404, m.error_booking_not_found());
		facility = { name: f.name, phone: f.phone };
		facilityKey = r.facilityUuid;

		// 表示名（公開コンテンツが投入済みなら解決・無ければ空）
		const [plansMapped, roomsMapped] = await Promise.all([
			sbListPlansMapped(r.facilityUuid).catch(() => []),
			sbListRoomTypesMapped(r.facilityUuid).catch(() => [])
		]);
		const planNameById = new Map(plansMapped.map((p) => [p.id, p.name]));
		const roomNameById = new Map(roomsMapped.map((rt) => [rt.id, rt.name]));
		planName = (id) => planNameById.get(id) ?? '';
		roomName = (id) => roomNameById.get(id) ?? '';

		current = {
			ratePlanId: r.ratePlanUuid,
			roomTypeId: r.roomTypeUuid,
			planName: planName(r.ratePlanUuid),
			roomName: roomName(r.roomTypeUuid),
			checkin: r.checkin,
			nights: r.nights,
			adults: r.adults,
			total: r.total
		};
		getOffers = async (checkin, nights, adults) => {
			const offers = await sbPlanOffers(r.facilityUuid, checkin, nights, adults);
			return offers.map((o) => ({
				ratePlanId: o.ratePlanId,
				roomTypeId: o.roomTypeId,
				planName: planName(o.ratePlanId),
				roomName: roomName(o.roomTypeId),
				total: o.total,
				perPerson: o.perPerson,
				remaining: o.remaining
			}));
		};
		getQuote = (p) => sbQuoteAmendment(client, params.code, p);
	} else {
		const booking = bookings.get(params.code);
		if (!booking || booking.memberId !== locals.user!.id) error(404, m.error_booking_not_found());
		if (booking.status !== 'reserved') redirect(303, `/account/reservations/${params.code}`);
		const f = facilityById(booking.facilityId)!;
		facility = { name: f.name, phone: f.phone };
		facilityKey = booking.facilityId;
		planName = (id) => planById(id)?.name ?? '';
		roomName = (id) => roomTypeById(id)?.name ?? '';
		current = {
			ratePlanId: booking.planId,
			roomTypeId: booking.roomTypeId,
			planName: planName(booking.planId),
			roomName: roomName(booking.roomTypeId),
			checkin: booking.checkin,
			nights: booking.nights,
			adults: booking.adults,
			total: booking.total
		};
		getOffers = (checkin, nights, adults) =>
			amendOffers(booking.facilityId, checkin, nights, adults).map((o) => ({
				ratePlanId: o.ratePlanId,
				roomTypeId: o.roomTypeId,
				planName: planName(o.ratePlanId),
				roomName: roomName(o.roomTypeId),
				total: o.total,
				perPerson: o.perPerson,
				remaining: o.remaining
			}));
		getQuote = (p) => quoteAmendment(params.code, p, locals.user!.id);
	}

	// --- 新条件（クエリ上書き・未指定は現状） ---
	const checkin = url.searchParams.get('checkin') || current.checkin;
	const nights = clampInt(url.searchParams.get('nights'), current.nights, 1, 5);
	const adults = clampInt(url.searchParams.get('adults'), current.adults, 1, 6);

	const offers = await getOffers(checkin, nights, adults);

	// 選択（offer=planId__roomId）。無効なら現行の組合せ → 先頭の順で既定
	const offerParam = url.searchParams.get('offer');
	let sel: AmendOfferView | undefined;
	if (offerParam && offerParam.includes(OFFER_SEP)) {
		const [p, rr] = offerParam.split(OFFER_SEP);
		sel = offers.find((o) => o.ratePlanId === p && o.roomTypeId === rr);
	}
	if (!sel) sel = offers.find((o) => o.ratePlanId === current.ratePlanId && o.roomTypeId === current.roomTypeId);
	if (!sel) sel = offers[0];

	// --- 見積 ---
	let quote: AmendQuote | null = null;
	let quoteError: string | null = null;
	if (sel) {
		try {
			quote = await getQuote({ ratePlanId: sel.ratePlanId, roomTypeId: sel.roomTypeId, checkin, nights, adults });
		} catch (e) {
			quoteError = amendErrorMessage(e instanceof Error ? e.message : String(e));
		}
	}

	return {
		code: params.code,
		facility,
		facilityKey,
		current,
		checkin,
		nights,
		adults,
		offers,
		selected: sel ? { ratePlanId: sel.ratePlanId, roomTypeId: sel.roomTypeId } : null,
		quote,
		quoteError,
		datesOnly: false as boolean,
		privateBook: false as boolean,
		available: true,
		roomsView: [] as { index: number; roomName: string; planName: string; adults: number; total: number; newTotal: number | null }[]
	};
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * プライベートブックの予約の日程変更（日付・泊数だけ・全室同時）。人数・お部屋・プランは「このお部屋を変更」から
 * （DB の member_page_*_dates は人数を変えない）。料金は生きている部屋ごとに専用料金で計算し直し（memberAmendLines）、
 * 見積は book.member_page_quote_amendment_dates。画面は 2 室以上の日程変更と同じ形（datesOnly）
 */
async function privateBookAmendLoad(who: PrivateBookWho, r: MemberReservation, url: URL) {
	const back = `/account/reservations/${r.code}`;
	const gate = await privateBookChangeGate(who, r.facilityUuid);
	if (!gate.ok) redirect(303, back);
	const storeId = reverseFacilityUuid(r.facilityUuid);
	const fac = storeId ? facilityById(storeId) : undefined;
	if (!fac) error(404, m.error_booking_not_found());
	let booking: Awaited<ReturnType<typeof memberPageBookingRooms>>;
	try {
		booking = await memberPageBookingRooms(who);
	} catch (e) {
		const err = memberPageOpError(e);
		error(err.status === 500 ? 503 : err.status, err.message);
	}
	if (booking.status !== 'confirmed') redirect(303, back);
	const maxNights = Math.min(5, Math.max(1, gate.partner.booking_settings.maxNights));
	const checkin = url.searchParams.get('checkin') || booking.checkIn;
	const nights = clampInt(url.searchParams.get('nights'), booking.nights, 1, maxNights);
	let quote: AmendDatesQuote | null = null;
	let quoteError: string | null = null;
	if (!ISO.test(checkin)) quoteError = '日付を選んでください。';
	else if (checkin < todayJst()) quoteError = '過去の日付には変更できません。';
	else {
		const lines = await memberAmendLines(gate.db, gate.partner, booking, checkin, nights);
		if (!lines.ok) quoteError = lines.message;
		else {
			try {
				quote = await memberPageQuoteAmendDates(who, checkin, nights, lines.rooms);
			} catch (e) {
				quoteError = memberPageOpError(e).message;
			}
		}
	}
	const live = booking.rooms.filter((x) => !x.cancelled);
	const adults = live.reduce((s, x) => s + x.adults, 0);
	return {
		code: r.code,
		facility: { name: fac.name, phone: fac.phone },
		facilityKey: r.facilityUuid,
		current: {
			ratePlanId: r.ratePlanUuid,
			roomTypeId: r.roomTypeUuid,
			planName: live.length === 1 ? live[0].planLabel : '',
			roomName: live.length === 1 ? live[0].roomName : '',
			checkin: booking.checkIn,
			nights: booking.nights,
			adults,
			total: r.total
		} satisfies AmendCurrent,
		checkin,
		nights,
		adults,
		offers: [] as AmendOfferView[],
		selected: null,
		quote: quote as AmendQuote | null,
		quoteError,
		datesOnly: true as boolean,
		// 日程変更の注記を「日付・泊数だけ（お部屋・人数は「このお部屋を変更」から）」にする
		privateBook: true as boolean,
		available: quote?.available ?? true,
		roomsView: live.map((x) => ({
			index: x.index,
			roomName: x.roomName,
			planName: x.planLabel,
			adults: x.adults,
			total: x.roomTotal,
			newTotal: quote?.rooms.find((q) => q.index === x.index)?.charge ?? null
		}))
	};
}

export const actions: Actions = {
	confirm: async (event) => {
		const { request, params, locals } = event;
		const form = await request.formData();
		if (MEMBER_SUPABASE) {
			// プライベートブック（専用ページ経由）の予約: 専用料金で日付・泊数だけ（泊明細はサーバが計算し直す・画面の金額は受け取らない）
			const found = await privateBookReservationOf(event, params.code).catch(() => null);
			if (found?.route.kind === 'deny') return fail(403, { code: 'forbidden', message: PRIVATE_BOOK_FORBIDDEN_MESSAGE });
			if (found?.route.kind === 'private_book') {
				const who = found.route.who;
				const checkin = String(form.get('checkin') ?? '');
				if (!ISO.test(checkin)) return fail(400, { code: 'invalid', message: '日付を選んでください。' });
				const gate = await privateBookChangeGate(who, found.r.facilityUuid);
				if (!gate.ok) return fail(403, { code: 'forbidden', message: gate.message });
				const nights = clampInt(String(form.get('nights') ?? ''), 1, 1, Math.min(5, Math.max(1, gate.partner.booking_settings.maxNights)));
				if (await isPrepaidOnline(params.code)) return fail(400, { code: 'prepaid_online', message: m.amend_prepaid_blocked() });
				try {
					const booking = await memberPageBookingRooms(who);
					const lines = await memberAmendLines(gate.db, gate.partner, booking, checkin, nights);
					if (!lines.ok) return fail(400, { code: 'unavailable', message: lines.message });
					await memberPageAmendDates(who, checkin, nights, lines.rooms);
				} catch (e) {
					const err = memberPageOpError(e);
					return fail(err.status, { code: err.code, message: err.message });
				}
				redirect(303, `/account/reservations/${params.code}`);
			}
		}
		// 2 室以上（M2）: 全室同時の日程変更（日付・泊数だけ）
		if (form.get('datesOnly') === '1') {
			const checkin = String(form.get('checkin') ?? '');
			const nights = clampInt(String(form.get('nights') ?? ''), 1, 1, 5);
			if (!checkin || !MEMBER_SUPABASE) return fail(400, { message: m.amend_failed() });
			if (await isPrepaidOnline(params.code)) return fail(400, { message: m.amend_prepaid_blocked() });
			try {
				await sbAmendBookingDates(createSupabaseServerClient(event), params.code, checkin, nights);
			} catch (e) {
				return fail(400, { message: amendErrorMessage(e instanceof Error ? e.message : String(e), true) });
			}
			redirect(303, `/account/reservations/${params.code}`);
		}
		const p: AmendParams = {
			ratePlanId: String(form.get('ratePlanId') ?? ''),
			roomTypeId: String(form.get('roomTypeId') ?? ''),
			checkin: String(form.get('checkin') ?? ''),
			nights: clampInt(String(form.get('nights') ?? ''), 1, 1, 5),
			adults: clampInt(String(form.get('adults') ?? ''), 1, 1, 6)
		};
		if (!p.ratePlanId || !p.roomTypeId || !p.checkin) return fail(400, { message: m.amend_failed() });

		if (MEMBER_SUPABASE && (await isPrepaidOnline(params.code))) return fail(400, { message: m.amend_prepaid_blocked() });

		try {
			if (MEMBER_SUPABASE) {
				await sbAmendBooking(createSupabaseServerClient(event), params.code, p);
			} else {
				amendBooking(params.code, p, locals.user!.id);
			}
		} catch (e) {
			return fail(400, { message: amendErrorMessage(e instanceof Error ? e.message : String(e)) });
		}

		redirect(303, `/account/reservations/${params.code}`);
	}
};
