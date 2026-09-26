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
	type GuestBookingLookup,
	type GuestCancelReason
} from '$lib/server/supabase-data';
import { directPaymentForBooking, directRefundPreviewOf, refundAfterCancel } from '$lib/server/direct-payments';
import type { Actions, PageServerLoad } from './$types';

/** 同一 IP からの照会が多すぎるときのキー。総当たり自体は現実的でないが、ログ汚染と無駄な DB 負荷を避ける。 */
function rateKey(ip: string): string {
	return `gcancel:${ip}`;
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

	// オンライン決済（v0.43.0）で払った予約は、取り消すと「支払額 − キャンセル料」をカードへ返金する。
	// 予約時決済の割引額は返金しない（差し引く額 = キャンセル料と割引額の大きい方・autumn-shared 20260926221912）
	const pay = await directPaymentForBooking(lookup.booking.code).catch(() => null);
	const refund = pay && pay.status === 'paid' ? directRefundPreviewOf(pay, lookup.fee.fee) : null;

	return {
		unavailable: false as const,
		state: 'ready' as const,
		token,
		booking: lookup.booking,
		fee: lookup.fee,
		refund
	};
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
	}
};
