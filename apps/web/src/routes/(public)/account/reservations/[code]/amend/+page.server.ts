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
	sbMyReservations,
	sbPlanOffers,
	sbQuoteAmendment,
	sbAmendBooking,
	sbListPlansMapped,
	sbListRoomTypesMapped,
	reverseFacilityUuid
} from '$lib/server/supabase-data';
import * as m from '$lib/paraglide/messages';
import type { AmendParams, AmendQuote } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// RPC/store の例外メッセージ → i18n 文言（部分一致で拾う）
function amendErrorMessage(msg: string): string {
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
		quoteError
	};
};

export const actions: Actions = {
	confirm: async (event) => {
		const { request, params, locals } = event;
		const form = await request.formData();
		const p: AmendParams = {
			ratePlanId: String(form.get('ratePlanId') ?? ''),
			roomTypeId: String(form.get('roomTypeId') ?? ''),
			checkin: String(form.get('checkin') ?? ''),
			nights: clampInt(String(form.get('nights') ?? ''), 1, 1, 5),
			adults: clampInt(String(form.get('adults') ?? ''), 1, 1, 6)
		};
		if (!p.ratePlanId || !p.roomTypeId || !p.checkin) return fail(400, { message: m.amend_failed() });

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
