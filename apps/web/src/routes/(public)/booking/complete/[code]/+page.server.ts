import { error } from '@sveltejs/kit';
import { bookings, facilityById, planById, roomTypeById } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { getLastBooking, sbFacilityByUuid, sbMyBookingFavoriteRooms, sbMyProfile, sbRoomTypeByUuid, sbPlanByUuid } from '$lib/server/supabase-data';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import type { Booking } from '$lib/types';
import * as m from '$lib/paraglide/messages';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { params, cookies, locals } = event;
	if (DATA_SOURCE === 'supabase') {
		// 確定直後に確定アクションが書いた直近予約 cookie から復元する（anon で booking を再取得する RPC が無いため）。
		const raw = await getLastBooking(cookies);
		if (!raw || raw.code !== params.code) error(404, m.error_booking_not_found());

		const [facility, room, plan] = await Promise.all([
			sbFacilityByUuid(raw.facilityUuid),
			sbRoomTypeByUuid(raw.roomUuid),
			sbPlanByUuid(raw.planUuid)
		]);
		if (!facility || !room) error(404, m.error_booking_not_found());

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
		// お気に入りの部屋の指定の結果（会員が予約確認画面で選んだとき・確定のときに DB が空きを確かめて指定した）
		const favoriteRooms =
			MEMBER_SUPABASE && locals.user?.role === 'member'
				? await sbMyBookingFavoriteRooms(createSupabaseServerClient(event), raw.code).catch(() => [])
				: [];
		// 確認・変更・取消はマイページのご予約から（プライベートブック・docs/private-book.md「作る順番」3）。B面の専用ページへは送らない
		const memberPageUrl = raw.memberPage ? `/account/reservations/${encodeURIComponent(raw.code)}` : null;
		// 専用ページごとの予約かご（プライベートブックの ab_booking_cart_v1:pb:<partnerId>）を空にするため
		const memberPagePartnerId = raw.memberPage?.partnerId ?? null;
		// プライベートブックの帯の「○○ 様」（B面のヘッダーと同じくログイン中の会員の名前）。取れなければ名前なしの帯
		const memberPageMemberName =
			raw.memberPage && MEMBER_SUPABASE && locals.user?.role === 'member'
				? await sbMyProfile(createSupabaseServerClient(event)).then((p) => p.name || null, () => null)
				: null;
		return {
			booking,
			facility,
			plan: plan ?? null,
			room,
			rooms,
			paid,
			couponDiscount: raw.couponDiscount ?? 0,
			prepayBonus,
			onsiteMethod: raw.onsiteMethod ?? null,
			// オンライン決済（チェックアウト日）: 請求日（paid は請求予定額）
			chargeOn: raw.chargeOn ?? null,
			isMember: locals.user?.role === 'member',
			memberPageUrl,
			memberPagePartnerId,
			memberPageName: raw.memberPage?.pageName ?? null,
			memberPageMemberName,
			favoriteRooms
		};
	}

	const booking = bookings.get(params.code);
	if (!booking || (locals.memberPreview && booking.memberId !== locals.user?.id)) error(404, m.error_booking_not_found());
	return {
		booking,
		facility: facilityById(booking.facilityId)!,
		plan: planById(booking.planId)!,
		room: roomTypeById(booking.roomTypeId)!,
		rooms: [] as { index: number; roomName: string; planName: string; adults: number; total: number }[],
		paid: null,
		couponDiscount: 0,
		// デモ（store）は早期決済割（discount）だけ
		prepayBonus: null,
		onsiteMethod: null,
		chargeOn: null as string | null,
		isMember: locals.user?.role === 'member',
		memberPageUrl: null as string | null,
		memberPagePartnerId: null as string | null,
		memberPageName: null as string | null,
		memberPageMemberName: null as string | null,
		favoriteRooms: [] as { roomIndex: number; name: string; designated: boolean }[]
	};
};
