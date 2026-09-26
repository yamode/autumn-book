// 予約管理の一覧。本番（ADMIN_SUPABASE）は book の実データ、それ以外は store.ts のデモ。
//
// 設計書: docs/BOOKING_CANCEL_MAIL.md §5.2
//
// これまでこの画面は demo ストア直読みで、本番でも実予約が1件も出なかった
// （アプリ経由・サイト経由を問わず）。予約の取り消しは PMS ではなくここで行う運用のため、
// core.stays 起点の admin_list_bookings に置き換えた。
import {
	adminListBookings,
	adminMailQueueStatus,
	bookAdmin,
	mapRpcError,
	type BookingListRow,
	type MailQueueStatus
} from '$lib/server/admin-app-data';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { toFacilityUuidStrict } from '$lib/server/supabase-data';
import { bookings, roomTypeById } from '$lib/server/store';
import { addDays, todayStr } from '$lib/format';
import type { PageServerLoad } from './$types';

/** 既定の期間: 今日 〜 120日後。全期間だと件数上限に当たって古い予約で埋まる */
function defaultRange(): { from: string; to: string } {
	const from = todayStr();
	return { from, to: addDays(from, 120) };
}

const LIMIT = 200;

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const status = event.url.searchParams.get('status') ?? '';
	// 既定は直販のみ。'' を渡すと OTA・電話予約も含めた全 source になる
	const channel = event.url.searchParams.get('channel') ?? 'autumn_booking';
	const q = event.url.searchParams.get('q') ?? '';
	const range = defaultRange();
	const from = event.url.searchParams.get('from') || range.from;
	const to = event.url.searchParams.get('to') || range.to;
	const filters = { status, channel, q, from, to };
	// 電話・メールでの検索は管理者のみ（book.admin_list_bookings と同じ線引き）
	const isAdmin = event.locals.user?.role === 'admin';

	if (ADMIN_SUPABASE) {
		const client = bookAdmin(event);
		try {
			// 管理画面の施設スイッチャーは store.ts のデモ施設マスタ由来なので、
			// RPC に渡す前に実 UUID へ変換する（news / bath / inroom と同じ流儀）
			const [list, mailQueue] = await Promise.all([
				adminListBookings(client, {
					facilityId: toFacilityUuidStrict(currentFacility.id),
					status: status || null,
					source: channel === '' ? null : channel,
					q: q || null,
					checkinFrom: from || null,
					checkinTo: to || null,
					limit: LIMIT
				}),
				// スタッフでも見える（滞留に気づけるのが目的）。失敗しても一覧は出す
				adminMailQueueStatus(client).catch(() => null)
			]);
			return {
				live: true as const,
				isAdmin,
				filters,
				list,
				mailQueue: mailQueue as MailQueueStatus | null,
				truncated: list.length >= LIMIT,
				error: null as string | null
			};
		} catch (e) {
			return {
				live: true as const,
				isAdmin,
				filters,
				list: [] as BookingListRow[],
				mailQueue: null as MailQueueStatus | null,
				truncated: false,
				error: mapRpcError(e)
			};
		}
	}

	// demo: 従来どおり store から。実データ側と同じ行の形に寄せて画面を1本にする
	let demo = [...bookings.values()].filter((b) => b.facilityId === currentFacility.id);
	if (status) demo = demo.filter((b) => b.status === status);
	if (from) demo = demo.filter((b) => b.checkin >= from);
	if (to) demo = demo.filter((b) => b.checkin <= to);
	if (channel) demo = demo.filter((b) => b.channel === channel);
	const digits = q.replace(/\D/g, '');
	if (q) {
		demo = demo.filter(
			(b) =>
				b.code.includes(q) ||
				b.guest.name.includes(q) ||
				b.guest.kana.includes(q) ||
				// 電話番号（4桁以上の数字・ハイフン無視）。本番と同じく管理者のみ
				(isAdmin && digits.length >= 4 && b.guest.phone.replace(/\D/g, '').includes(digits))
		);
	}
	const list: BookingListRow[] = demo
		.sort((a, b) => a.checkin.localeCompare(b.checkin))
		.map((b) => ({
			stay_id: b.code,
			booking_id: b.code,
			booking_code: b.code,
			facility_id: b.facilityId,
			source: b.channel === 'ota' ? 'ota' : 'autumn_booking',
			channel_name: b.channel === 'ota' ? 'OTA' : '公式サイト',
			client: b.channel === 'ota' ? null : 'web',
			guest_name: b.guest.name,
			guest_kana: b.guest.kana,
			is_member: !!b.memberId,
			member_user_id: b.memberId ?? null,
			check_in_date: b.checkin,
			check_out_date: addDays(b.checkin, b.nights),
			nights: b.nights,
			adult_count: b.adults,
			room_name: roomTypeById(b.roomTypeId)?.name ?? null,
			plan_name: null,
			total_amount: b.total,
			stay_status: b.status,
			booking_status: b.status,
			cancellation_fee: b.cancelFee ?? null,
			mail_status: null,
			mail_sent_at: null,
			created_at: b.createdAt
		}));

	return {
		live: false as const,
		isAdmin,
		filters,
		list,
		mailQueue: null as MailQueueStatus | null,
		truncated: false,
		error: null as string | null
	};
};
