import { fail, redirect } from '@sveltejs/kit';
import {
	getHold,
	planById,
	roomTypeById,
	facilityById,
	confirmBooking,
	memberById,
	pointBalance,
	quoteFor,
	memberRanks
} from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import {
	sbGetHoldMapped,
	sbPlanByUuid,
	sbRoomTypeByUuid,
	sbFacilityByUuid,
	sbMyProfile,
	sbPointBalance,
	confirmBooking as sbConfirmBooking,
	bookingSessionId,
	setBookingDraft,
	setLastBooking
} from '$lib/server/supabase-data';
import { getLocale } from '$lib/paraglide/runtime';
import { combineName, combineKana } from '$lib/name';
import { earnedPoints } from '@autumn-book/core';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

// 会員ランク別の還元率（book.member_ranks 相当。ポイント獲得見込みの表示に使用）
const REWARD_RATE: Record<string, number> = { standard: 0.01, silver: 0.02, gold: 0.03, platinum: 0.05 };

export const load: PageServerLoad = async (event) => {
	const { url, locals, cookies } = event;

	if (DATA_SOURCE === 'supabase') {
		const sid = bookingSessionId(cookies);
		const hold = await sbGetHoldMapped(url.searchParams.get('id') ?? '', sid);
		if (!hold || hold.status !== 'active') return { expired: true as const };

		const [plan, room, facility] = await Promise.all([
			sbPlanByUuid(hold.planId),
			sbRoomTypeByUuid(hold.roomTypeId),
			sbFacilityByUuid(hold.facilityId)
		]);
		if (!plan || !room || !facility) return { expired: true as const };

		// 会員のみポイント残高・獲得見込みを表示（未ログインのゲストは null）。
		let member: {
			name: string; kana: string;
			familyName: string; givenName: string; middleName: string; familyNameKana: string; givenNameKana: string;
			phone: string; email: string; balance: number; earn: number;
		} | null = null;
		if (MEMBER_SUPABASE && locals.user?.role === 'member') {
			try {
				const client = createSupabaseServerClient(event);
				const [profile, balance] = await Promise.all([sbMyProfile(client), sbPointBalance(client)]);
				const rate = REWARD_RATE[profile.rankCode] ?? 0.01;
				member = {
					name: profile.name,
					kana: profile.kana,
					familyName: profile.familyName,
					givenName: profile.givenName,
					middleName: profile.middleName,
					familyNameKana: profile.familyNameKana,
					givenNameKana: profile.givenNameKana,
					phone: profile.phone,
					email: profile.email,
					balance,
					earn: earnedPoints(hold.quote.total, rate)
				};
			} catch {
				member = null;
			}
		}

		return { expired: false as const, hold, plan, room, facility, member };
	}

	const hold = getHold(url.searchParams.get('id') ?? '');
	if (!hold || hold.status !== 'active') {
		return { expired: true as const };
	}
	const member = locals.user?.role === 'member' ? memberById(locals.user.id) : undefined;
	const rank = memberRanks.find((r) => r.code === (member?.rank ?? 'standard'))!;
	return {
		expired: false as const,
		hold,
		plan: planById(hold.planId)!,
		room: roomTypeById(hold.roomTypeId)!,
		facility: facilityById(hold.facilityId)!,
		member: member
			? {
					name: member.name,
					kana: member.kana,
					familyName: member.familyName,
					givenName: member.givenName,
					middleName: member.middleName ?? '',
					familyNameKana: member.familyNameKana ?? '',
					givenNameKana: member.givenNameKana ?? '',
					phone: member.phone,
					email: member.email,
					balance: pointBalance(member.id),
					earn: earnedPoints(hold.quote.total, rank.rewardRate)
				}
			: null
	};
};

export const actions: Actions = {
	submit: async (event) => {
		const { request, locals, cookies } = event;
		const form = await request.formData();
		const holdId = String(form.get('holdId'));

		const familyName = String(form.get('familyName') ?? '').trim();
		const givenName = String(form.get('givenName') ?? '').trim();
		const middleName = String(form.get('middleName') ?? '').trim();
		const familyNameKana = String(form.get('familyNameKana') ?? '').trim();
		const givenNameKana = String(form.get('givenNameKana') ?? '').trim();
		const guest = {
			name: combineName(familyName, givenName),
			kana: combineKana(familyNameKana, givenNameKana),
			familyName,
			givenName,
			middleName,
			familyNameKana,
			givenNameKana,
			phone: String(form.get('phone') ?? '').trim(),
			email: String(form.get('email') ?? '').trim(),
			arrival: String(form.get('arrival') ?? ''),
			shuttle: form.get('shuttle') === 'on',
			notes: String(form.get('notes') ?? '').trim()
		};
		const errors: Record<string, string> = {};
		// 姓・名は必須（カナは任意＝海外ゲスト対応）
		if (!familyName) errors.familyName = m.error_name_required();
		if (!givenName) errors.givenName = m.error_name_required();
		if (!/^[0-9\-+ ]{10,}$/.test(guest.phone)) errors.phone = m.error_phone_invalid();
		if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest.email)) errors.email = m.error_email_invalid();

		if (DATA_SOURCE === 'supabase') {
			const sid = bookingSessionId(cookies);
			const hold = await sbGetHoldMapped(holdId, sid);
			if (!hold || hold.status !== 'active') return fail(410, { message: m.error_hold_expired() });
			if (Object.keys(errors).length > 0) return fail(400, { errors, values: guest });

			const useMember = MEMBER_SUPABASE && locals.user?.role === 'member';
			const pointsUsed = useMember ? Math.max(0, Number(form.get('points') ?? 0)) : 0;

			const plan = await sbPlanByUuid(hold.planId);
			if (!plan) return fail(410, { message: m.error_hold_expired() });
			const payment = String(form.get('payment') ?? 'onsite') as 'onsite' | 'card' | 'paypay';
			const allowed =
				payment === 'onsite' ? plan.payment.onsite : plan.payment.prepay && plan.payment.prepayMethods.includes(payment);
			if (!allowed) {
				errors.payment = 'お支払い方法を選択してください';
				return fail(400, { errors, values: guest });
			}

			if (payment !== 'onsite') {
				// ③ 決済ステップへ（事前決済=即時決済）。book.holds は anon で更新できないため入力を cookie に保持。
				setBookingDraft(cookies, { holdId, guest, pointsUsed, payment });
				redirect(303, `/booking/payment?id=${holdId}`);
			}

			const client = useMember ? createSupabaseServerClient(event) : undefined;
			const result = await sbConfirmBooking(holdId, sid, guest, { client, pointsUsed, locale: getLocale() });
			if ('error' in result) return fail(410, { message: m.error_hold_expired() });
			setLastBooking(cookies, {
				code: result.booking_code,
				facilityUuid: hold.facilityId,
				roomUuid: hold.roomTypeId,
				planUuid: hold.planId,
				checkin: hold.checkin,
				nights: hold.nights,
				adults: hold.adults,
				total: result.total,
				pointsUsed: result.points_used,
				pointsEarned: result.points_earned,
				payment,
				discountAmount: result.discount ?? 0,
				guest: { name: guest.name, kana: guest.kana, phone: guest.phone, email: guest.email }
			});
			redirect(303, `/booking/complete/${result.booking_code}`);
		}

		const hold = getHold(holdId);
		if (!hold || hold.status !== 'active') {
			return fail(410, { message: m.error_hold_expired() });
		}
		if (Object.keys(errors).length > 0) return fail(400, { errors, values: guest });

		const memberId = locals.user?.role === 'member' ? locals.user.id : undefined;
		const pointsUsed = memberId ? Math.max(0, Number(form.get('points') ?? 0)) : 0;

		// 支払い方法（プランの決済設定でバリデーション）
		const plan = planById(hold.planId)!;
		const payment = String(form.get('payment') ?? 'onsite') as 'onsite' | 'card' | 'paypay';
		const allowed =
			payment === 'onsite' ? plan.payment.onsite : plan.payment.prepay && plan.payment.prepayMethods.includes(payment);
		if (!allowed) {
			errors.payment = 'お支払い方法を選択してください';
			return fail(400, { errors, values: guest });
		}

		if (payment !== 'onsite') {
			// ③ 決済ステップへ（事前決済=即時決済。入力内容を hold に保持）
			hold.guestDraft = guest;
			hold.pointsDraft = pointsUsed;
			hold.paymentDraft = payment;
			redirect(303, `/booking/payment?id=${hold.id}`);
		}

		const result = confirmBooking(hold.id, guest, pointsUsed, memberId, 'onsite');
		if ('error' in result) {
			return fail(410, { message: m.error_hold_expired() });
		}
		redirect(303, `/booking/complete/${result.code}`);
	},

	usePoints: async (event) => {
		// 事前決済前のポイント再計算（画面遷移なしの再見積もり相当）。
		// 実データ（supabase）は anon で hold の見積もりを書き換えられないため無効化（確定時に反映）。
		if (DATA_SOURCE === 'supabase') return fail(400, {});

		const { request, locals } = event;
		const form = await request.formData();
		const hold = getHold(String(form.get('holdId')));
		if (!hold || locals.user?.role !== 'member') return fail(400, {});
		const points = Math.min(Math.max(0, Number(form.get('points') ?? 0)), pointBalance(locals.user.id), hold.quote.total);
		hold.quote = quoteFor(hold.planId, hold.roomTypeId, hold.checkin, hold.nights, hold.adults, hold.children, points);
		return { pointsApplied: points };
	}
};
