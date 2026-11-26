// 管理画面ダッシュボード（フロントの朝の確認用）。
// 本番（ADMIN_SUPABASE）は予約一覧と同じ admin_list_bookings（core.stays 起点・OTA/電話も含む）から、
// 本日到着・本日出発・明日到着・滞在中を出す。それ以外は store.ts のデモを同じ行の形に寄せる。
import { bookings, roomTypeById } from '$lib/server/store';
import {
	adminListBookings,
	adminMailQueueStatus,
	bookAdmin,
	mapRpcError,
	type BookingListRow,
	type MailQueueStatus
} from '$lib/server/admin-app-data';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { CHEF_FACILITY_ID, chefDb } from '$lib/server/chef';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { toFacilityUuidStrict } from '$lib/server/supabase-data';
import { todayStr, addDays } from '$lib/format';
import type { PageServerLoad } from './$types';

/** 出発日を拾うため、チェックインはこの日数だけ遡って読む（これより長い連泊は出発一覧に出ない） */
const LOOKBACK_DAYS = 21;

export type DashboardRow = Pick<
	BookingListRow,
	| 'booking_code'
	| 'guest_name'
	| 'guest_kana'
	| 'check_in_date'
	| 'check_out_date'
	| 'nights'
	| 'adult_count'
	| 'room_name'
	| 'plan_name'
	| 'channel_name'
	| 'source'
	| 'stay_status'
	| 'mail_status'
	| 'total_amount'
>;

function demoRows(facilityId: string): DashboardRow[] {
	return [...bookings.values()]
		.filter((b) => b.facilityId === facilityId)
		.map((b) => ({
			booking_code: b.code,
			guest_name: b.guest.name,
			guest_kana: b.guest.kana,
			check_in_date: b.checkin,
			check_out_date: addDays(b.checkin, b.nights),
			nights: b.nights,
			adult_count: b.adults,
			room_name: roomTypeById(b.roomTypeId)?.name ?? null,
			plan_name: null,
			channel_name: b.channel === 'ota' ? 'OTA' : '公式サイト',
			source: b.channel === 'ota' ? 'ota' : 'autumn_booking',
			stay_status: b.status,
			mail_status: null,
			total_amount: b.total
		}));
}

/**
 * 問い合わせの未対応件数（ダッシュボードの「対応が必要なこと」・2026-11-26）。
 * - HP・メールの問い合わせ（book.inquiries）: 未対応（new）。過去メールの取り込み分は除く。西和賀だけ先行運用（他の施設は null）
 * - 出張シェフの依頼（chef.reservations）: 返事をしていない依頼（requested）
 * 会員サポート・団体照会はサイドバーの件数（layout の supportBadge・groupInquiryBadge）をそのまま使う。読めなければ null
 */
async function inquiryCounts(event: Parameters<PageServerLoad>[0], facilityId: string) {
	const db = createSupabaseServerClient(event);
	const facility = FACILITY_UUID[facilityId as keyof typeof FACILITY_UUID];
	const hp =
		facilityId === 'f-nishiwaga' && facility
			? Promise.resolve(
					db.schema('book').from('inquiries').select('id', { head: true, count: 'exact' }).eq('facility_id', facility).eq('status', 'new').is('profile->>history_account', null)
				)
					.then(({ count, error }) => (error ? null : (count ?? 0)))
					.catch(() => null as number | null)
			: Promise.resolve(null as number | null);
	const chef = Promise.resolve(chefDb(db).from('reservations').select('id', { head: true, count: 'exact' }).eq('facility_id', CHEF_FACILITY_ID).eq('status', 'requested'))
		.then(({ count, error }) => (error ? null : (count ?? 0)))
		.catch(() => null as number | null);
	const [hpNew, chefRequested] = await Promise.all([hp, chef]);
	return { hpNew, chefRequested };
}

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const today = todayStr();
	const tomorrow = addDays(today, 1);

	let rows: DashboardRow[] = [];
	let mailQueue: MailQueueStatus | null = null;
	let error: string | null = null;

	if (ADMIN_SUPABASE) {
		const client = bookAdmin(event);
		try {
			const [list, mq] = await Promise.all([
				adminListBookings(client, {
					facilityId: toFacilityUuidStrict(currentFacility.id),
					status: null,
					source: null,
					checkinFrom: addDays(today, -LOOKBACK_DAYS),
					checkinTo: tomorrow,
					limit: 500
				}),
				adminMailQueueStatus(client).catch(() => null)
			]);
			rows = list;
			mailQueue = mq;
		} catch (e) {
			error = mapRpcError(e);
		}
	} else {
		rows = demoRows(currentFacility.id).filter(
			(r) => r.check_in_date >= addDays(today, -LOOKBACK_DAYS) && r.check_in_date <= tomorrow
		);
	}

	const active = rows.filter((r) => r.stay_status !== 'cancelled' && r.stay_status !== 'no_show');
	const byArrival = (a: DashboardRow, b: DashboardRow) => a.check_in_date.localeCompare(b.check_in_date);

	return {
		live: ADMIN_SUPABASE,
		today,
		tomorrow,
		error,
		mailQueue,
		// 画面を待たせないよう、件数は後から届く（{#await}）
		inquiryCounts: ADMIN_SUPABASE ? inquiryCounts(event, currentFacility.id) : Promise.resolve({ hpNew: null as number | null, chefRequested: null as number | null }),
		arrivalsToday: active.filter((r) => r.check_in_date === today).sort(byArrival),
		departuresToday: active.filter((r) => r.check_out_date === today),
		arrivalsTomorrow: active.filter((r) => r.check_in_date === tomorrow),
		inHouse: active.filter((r) => r.check_in_date < today && r.check_out_date > today)
	};
};
