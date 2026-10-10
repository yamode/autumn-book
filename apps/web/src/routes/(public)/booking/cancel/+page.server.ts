// 非会員向けの予約キャンセルフォーム。
// 設計書: docs/BOOKING_CANCEL_MAIL.md §4.4
//
// 入口は確認メールのリンク `?t=<トークン>` のみ。予約番号は連番なので URL には載せない。
// GET は閲覧（view_count の更新）だけで、取消は POST。メーラーのリンク先読み
// （Outlook Safe Links・Gmail のプレビュー）で予約が消えないようにするため。
import { fail } from '@sveltejs/kit';

import { claimRateCheck, claimRecordFailure } from '$lib/server/claim-rate-limit';
import { DATA_SOURCE } from '$lib/server/supabase';
import {
	guestBookingByToken,
	guestCancelBooking,
	guestCancelBookingRoom,
	type GuestBookingLookup,
	type GuestCancelReason
} from '$lib/server/supabase-data';
import {
	directPaymentForBooking,
	directRefundPreviewOf,
	refundAfterCancel,
	type DirectPaymentInfo,
	type DirectRefundPreview
} from '$lib/server/direct-payments';
import { remainingRefundPreview, roomRefundPreview, type RefundTerms, type RoomRefundPreview } from '$lib/multi-room';
import type { Actions, PageServerLoad } from './$types';

/** 同一 IP からの照会が多すぎるときのキー。総当たり自体は現実的でないが、ログ汚染と無駄な DB 負荷を避ける。 */
function rateKey(ip: string): string {
	return `gcancel:${ip}`;
}

type ReadyLookup = Extract<GuestBookingLookup, { ok: true }>;

/**
 * 取り消せる予約の表示（load と ?/cancelRoom の後の再表示で同じものを作る）。
 * 2 室以上（M2）は部屋ごとに「この部屋を取り消す」と、その部屋のキャンセル料・返金の見込み。
 */
async function readyView(token: string, lookup: ReadyLookup) {
	// オンライン決済（v0.43.0）で払った予約は、取り消すと「支払額 − キャンセル料」をカードへ返金する。
	// 予約時決済の割引額は返金しない（差し引く額 = キャンセル料と割引額の大きい方・autumn-shared 20260926221912）
	const pay: DirectPaymentInfo | null = await directPaymentForBooking(lookup.booking.code).catch(() => null);
	const paid = pay && pay.status === 'paid' ? pay : null;
	const rooms = lookup.booking.rooms ?? [];
	const multi = rooms.length > 1;
	const terms: RefundTerms | null = paid
		? {
				adminFeePercent: paid.cancel_admin_fee_percent == null ? null : Number(paid.cancel_admin_fee_percent),
				adminFeeWaived: paid.cancel_admin_fee_waived === true
			}
		: null;
	const roomsView = multi
		? rooms.map((r) => ({
				index: r.room_index,
				roomName: r.room_name ?? '',
				planName: r.plan_name ?? '',
				adults: r.adults,
				charge: r.charge,
				cancelled: r.cancelled,
				cancelFee: r.cancel_fee ?? 0,
				fee: r.fee?.fee ?? 0,
				rate: r.fee?.rate ?? 0,
				refund:
					terms && !r.cancelled && r.paid_share != null
						? roomRefundPreview({ paidShare: r.paid_share, bathTax: r.bath_tax, prepayDiscount: r.prepay_discount }, r.fee?.fee ?? 0, terms)
						: (null as RoomRefundPreview | null)
			}))
		: [];
	// 全体（2 室以上は残りの部屋すべて）の返金の見込み
	let refund: DirectRefundPreview | RoomRefundPreview | null = null;
	if (paid && terms) {
		refund =
			multi && rooms.every((r) => r.paid_share != null)
				? remainingRefundPreview(
						{ amount: paid.amount, refunded: paid.refunded_amount, bathTax: paid.bath_tax_amount, prepayDiscount: paid.prepay_discount_amount ?? 0 },
						rooms
							.filter((r) => !r.cancelled)
							.map((r) => ({ paidShare: r.paid_share ?? 0, bathTax: r.bath_tax, prepayDiscount: r.prepay_discount, fee: r.fee?.fee ?? 0 })),
						rooms.filter((r) => r.cancelled).map((r) => ({ cancelKept: r.cancel_kept ?? 0 })),
						terms
					)
				: directRefundPreviewOf(paid, lookup.fee.fee);
	}
	return {
		unavailable: false as const,
		state: 'ready' as const,
		token,
		booking: lookup.booking,
		fee: lookup.fee,
		refund,
		multi,
		roomsView,
		liveRooms: rooms.filter((r) => !r.cancelled).length
	};
}

export const load: PageServerLoad = async ({ url, setHeaders, getClientAddress, platform }) => {
	// トークン入りの URL をキャッシュ・共有させない
	setHeaders({ 'cache-control': 'no-store' });

	if (DATA_SOURCE !== 'supabase') {
		return { unavailable: true as const };
	}

	const token = url.searchParams.get('t') ?? '';
	if (!token) {
		// リロード（replaceState で ?t= を落とした後）もここに来る
		return { unavailable: false as const, state: 'reload' as const };
	}

	const ip = getClientAddress();
	const gate = await claimRateCheck(platform, rateKey(ip));
	if (gate.locked) {
		return { unavailable: false as const, state: 'rate_limited' as const, retryInSec: gate.retryInSec };
	}

	let lookup: GuestBookingLookup;
	try {
		lookup = await guestBookingByToken(token);
	} catch {
		return { unavailable: false as const, state: 'error' as const };
	}

	if (!lookup.ok) {
		// 見つからない照会だけ数える（正しいリンクを開いた人は制限にかからない）
		await claimRecordFailure(platform, rateKey(ip));
		return { unavailable: false as const, state: 'blocked' as const, reason: lookup.reason };
	}

	if (!lookup.cancellable) {
		return {
			unavailable: false as const,
			state: 'blocked' as const,
			reason: (lookup.reason ?? 'not_found') as GuestCancelReason,
			booking: lookup.booking
		};
	}

	return readyView(token, lookup);
};

export const actions: Actions = {
	cancel: async ({ request }) => {
		if (DATA_SOURCE !== 'supabase') return fail(400, { reason: 'not_found' as GuestCancelReason });

		const form = await request.formData();
		const token = String(form.get('token') ?? '');
		if (!token) return fail(400, { reason: 'not_found' as GuestCancelReason });

		try {
			const res = await guestCancelBooking(token);
			if (!res.ok) return fail(400, { reason: res.reason });
			// 事前決済済みなら返金（失敗しても取消は成立済み。台帳に failed が残り、管理画面から再実行できる）
			const refund = await refundAfterCancel(res.booking_code, 'guest').catch(() => ({ kind: 'none' as const }));
			return {
				cancelled: true as const,
				code: res.booking_code,
				fee: res.cancellation_fee,
				waived: res.waived,
				refund
			};
		} catch {
			// ネットワーク等。取消が実際に成立していれば、もう一度押すと already_cancelled になる
			return fail(500, { reason: 'error' as const });
		}
	},

	/**
	 * 1 室だけの取消（2 室以上の予約・M2）。リンクは残りの部屋のために生きたまま（全室が取り消されたときだけ使えなくなる）。
	 * 最後の 1 室なら予約全体の取消（DB 側で切り替わる・完了の表示も全体の取消と同じ）。
	 * 画面は URL から ?t= を落としているので、取消のあとの表示（残りの部屋）はここで作って返す。
	 */
	cancelRoom: async ({ request }) => {
		if (DATA_SOURCE !== 'supabase') return fail(400, { reason: 'not_found' as GuestCancelReason });

		const form = await request.formData();
		const token = String(form.get('token') ?? '');
		const roomIndex = Number(form.get('roomIndex'));
		if (!token || !Number.isInteger(roomIndex) || roomIndex < 1) return fail(400, { reason: 'not_found' as GuestCancelReason });

		try {
			const res = await guestCancelBookingRoom(token, roomIndex);
			if (!res.ok) return fail(400, { reason: res.reason });
			const refund = await refundAfterCancel(res.booking_code, 'guest', { roomIndex }).catch(() => ({ kind: 'none' as const }));
			if (res.booking_cancelled) {
				return { cancelled: true as const, code: res.booking_code, fee: res.cancellation_fee, waived: res.waived, refund };
			}
			const lookup = await guestBookingByToken(token).catch(() => null);
			return {
				roomCancelled: { index: roomIndex, fee: res.cancellation_fee },
				refund,
				view: lookup && lookup.ok && lookup.cancellable ? await readyView(token, lookup) : null
			};
		} catch {
			return fail(500, { reason: 'error' as const });
		}
	}
};
