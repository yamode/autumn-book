import { error } from '@sveltejs/kit';
import { bookings, facilityById, planById, roomTypeById } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { getLastBooking, sbFacilityByUuid, sbRoomTypeByUuid, sbPlanByUuid } from '$lib/server/supabase-data';
import type { Booking } from '$lib/types';
import { memberPageHrefFor } from '$lib/server/partners/member-bookings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, cookies, locals }) => {
	if (DATA_SOURCE === 'supabase') {
		// 確定直後に確定アクションが書いた直近予約 cookie から復元する（anon で booking を再取得する RPC が無いため）。
		const raw = getLastBooking(cookies);
		if (!raw || raw.code !== params.code) error(404, '予約が見つかりません');

		const [facility, room, plan] = await Promise.all([
			sbFacilityByUuid(raw.facilityUuid),
			sbRoomTypeByUuid(raw.roomUuid),
			sbPlanByUuid(raw.planUuid)
		]);
		if (!facility || !room) error(404, '予約が見つかりません');

		const booking: Booking = {
			code: raw.code,
			facilityId: raw.facilityUuid,
			roomTypeId: raw.roomUuid,
			planId: raw.planUuid,
			checkin: raw.checkin,
			nights: raw.nights,
			adults: raw.adults,
			children: 0,
			guest: { name: raw.guest.name, kana: raw.guest.kana, phone: raw.guest.phone, email: raw.guest.email },
			total: raw.total,
			pointsUsed: raw.pointsUsed,
			pointsEarned: raw.pointsEarned,
			payment: raw.payment,
			paymentStatus: raw.payment === 'onsite' ? 'unpaid' : 'paid',
			prepayDiscountRate: raw.prepayDiscountRate ?? (raw.discountAmount ? plan?.payment.prepayDiscountRate : undefined),
			prepayDiscountEarly: raw.prepayDiscountEarly === true,
			discountAmount: raw.discountAmount || undefined,
			status: 'reserved',
			channel: 'autumn_booking',
			cancellationPolicy: plan?.cancellationPolicy ?? { rules: [], note: '' },
			createdAt: new Date().toISOString().slice(0, 10)
		};

		// 複数室（M1）: 部屋ごとの明細（部屋名・プラン名・人数・宿泊料金）。1 室は従来の表示のまま（空）
		const cookieRooms = raw.rooms ?? [];
		const rooms =
			cookieRooms.length > 1
				? await Promise.all(
						cookieRooms.map(async (r, i) => {
							const [rt, pl] = await Promise.all([sbRoomTypeByUuid(r.roomUuid), sbPlanByUuid(r.planUuid)]);
							return { index: i + 1, roomName: rt?.name ?? '', planName: pl?.name ?? '', adults: r.adults, total: r.total };
						})
					)
				: [];
		if (rooms.length > 0) {
			// 人数・合計の見出しは全室の値にする
			booking.adults = rooms.reduce((s, r) => s + r.adults, 0);
		}

		// オンライン決済（v0.43.0）で払った額（入湯税を含む）
		const paid = raw.paidAmount != null ? { amount: raw.paidAmount, bathTax: raw.bathTax ?? 0 } : null;
		// 早期決済ポイント（施設が points のとき・宿泊後に付与予定）
		const prepayBonus = (raw.prepayBonusPoints ?? 0) > 0 ? { points: raw.prepayBonusPoints ?? 0, rate: raw.prepayBonusRate ?? 0 } : null;
		// 特別会員の専用ページ経由の予約: 「ご予約の確認・変更は特別会員ページのご予約一覧から」（docs/vip-member-page.md §13.4.4）
		const memberPageUrl = raw.memberPage ? await memberPageHrefFor(raw.memberPage.partnerId, raw.code).catch(() => null) : null;
		return {
			booking,
			facility,
			plan: plan ?? null,
			room,
			rooms,
			paid,
			prepayBonus,
			onsiteMethod: raw.onsiteMethod ?? null,
			isMember: locals.user?.role === 'member',
			memberPageUrl,
			memberPageName: raw.memberPage?.pageName ?? null
		};
	}

	const booking = bookings.get(params.code);
	if (!booking) error(404, '予約が見つかりません');
	return {
		booking,
		facility: facilityById(booking.facilityId)!,
		plan: planById(booking.planId)!,
		room: roomTypeById(booking.roomTypeId)!,
		rooms: [] as { index: number; roomName: string; planName: string; adults: number; total: number }[],
		paid: null,
		// デモ（store）は早期決済割（discount）だけ
		prepayBonus: null,
		onsiteMethod: null,
		isMember: locals.user?.role === 'member',
		memberPageUrl: null as string | null,
		memberPageName: null as string | null
	};
};
