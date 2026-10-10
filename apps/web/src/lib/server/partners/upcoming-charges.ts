// 管理画面「今後の請求予定」（/admin/partners/charges）の読み込み（一覧と CSV で共通）。
// 取引先予約の「オンライン決済（チェックアウト日）」で、これからカードへ請求する予約・請求に失敗した予約・
// キャンセル料をカードへ請求する予定のまま残った予約・最近取り消した予約を、管理画面で選んでいる施設（ab_fac）で拾う。
// 読み取りは service_role（staffPartnerScope が施設へのアクセスを確かめてから渡す db）。書き込みはしない。
// 区分・金額・期間・CSV は純関数（$lib/partner-upcoming-charges）。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CHECKOUT_CHARGE_OPTION,
  inChargeRange,
  upcomingAmountOf,
  upcomingKindOf,
  type ChargeRange,
  type UpcomingKind,
  type UpcomingSource
} from '$lib/partner-upcoming-charges';
import { PartnerStoreError } from './store';

/** 「最近取り消したもの」に出す日数 */
export const RECENT_CANCEL_DAYS = 30;
// 1回に読む上限（施設1つのチェックアウト日決済の未請求は多くても数百件の想定）
const LIMIT = 1000;

export type UpcomingChargeRow = {
  id: string;
  kind: UpcomingKind;
  /** 請求予定日（請求予定・失敗＝チェックアウト日、キャンセル料・取消＝取消日〔JST〕） */
  chargeOn: string;
  bookingCode: string;
  partnerId: string | null;
  partnerName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomCount: number;
  guestName: string;
  /** 請求額（宿泊料金＋入湯税−割引。キャンセル料の区分はキャンセル料、取消は 0） */
  amount: number;
  lodging: number;
  bathTax: number;
  discount: number;
  cardLabel: string | null;
  error: string | null;
  cancelledAt: string | null;
  cancelFee: number;
  cancelFeeSettlement: string | null;
  cancelFeeStatus: string | null;
  chargeAttempts: number;
};

type Row = UpcomingSource & {
  id: string;
  booking_code: string;
  partner_id: string | null;
  partner_name: string;
  check_in_date: string;
  nights: number;
  room_count: number;
  guest_name: string;
  card_label: string | null;
  charge_error: string | null;
  charge_attempts: number | null;
  cancel_fee_error: string | null;
};

const COLUMNS =
  'id, booking_code, partner_id, partner_name, status, payment_option, payment_status, check_in_date, check_out_date, nights, room_count, guest_name, total_amount, bath_tax_amount, prepay_discount_amount, card_label, charge_error, charge_attempts, cancelled_at, cancel_fee, cancel_fee_settlement, cancel_fee_status, cancel_fee_error';

const jstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export type UpcomingChargesResult = {
  /** 請求予定（期間で絞った後・請求予定日順） */
  scheduled: UpcomingChargeRow[];
  /** 請求失敗（期間に関係なくすべて） */
  failed: UpcomingChargeRow[];
  /** キャンセル料のカード請求が残っているもの（期間に関係なくすべて） */
  cancelFees: UpcomingChargeRow[];
  /** 最近取り消したもの（includeCancelled のときだけ・取消日時の新しい順） */
  cancelled: UpcomingChargeRow[];
  /** 上限で切れた可能性がある */
  truncated: boolean;
};

export async function loadUpcomingCharges(
  db: SupabaseClient,
  scope: { tenantId: string; facilityId: string },
  opts: { range: ChargeRange; includeCancelled: boolean; now?: Date }
): Promise<UpcomingChargesResult> {
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - RECENT_CANCEL_DAYS * 86400_000).toISOString();
  const base = () =>
    db.from('rms_partner_bookings').select(COLUMNS).eq('tenant_id', scope.tenantId).eq('facility_id', scope.facilityId).eq('payment_option', CHECKOUT_CHARGE_OPTION);
  // 確定（請求予定・失敗）と、取消（キャンセル料のカード請求が残っているもの・最近の取消）を別に読む
  const active = base().eq('status', 'confirmed').in('payment_status', ['scheduled', 'charge_failed']).order('check_out_date').limit(LIMIT);
  // キャンセル料のカード請求の残りは日付に関係なく拾う。最近の取消は切替のときだけ
  const fees = base().eq('status', 'cancelled').eq('cancel_fee_settlement', 'card').is('cancel_fee_status', null).gt('cancel_fee', 0).limit(LIMIT);
  const recent = opts.includeCancelled
    ? base().eq('status', 'cancelled').gte('cancelled_at', since).order('cancelled_at', { ascending: false }).limit(LIMIT)
    : null;
  const [a, f, r] = await Promise.all([active, fees, recent]);
  for (const res of [a, f, r]) {
    if (res?.error) throw new PartnerStoreError(`請求予定を読み込めませんでした（${res.error.message}）`, 500);
  }

  const toView = (b: Row, kind: UpcomingKind): UpcomingChargeRow => ({
    id: b.id,
    kind,
    chargeOn: kind === 'scheduled' || kind === 'charge_failed' ? b.check_out_date : b.cancelled_at ? jstDate(b.cancelled_at) : b.check_out_date,
    bookingCode: b.booking_code,
    partnerId: b.partner_id,
    partnerName: b.partner_name,
    checkIn: b.check_in_date,
    checkOut: b.check_out_date,
    nights: b.nights,
    roomCount: b.room_count,
    guestName: b.guest_name,
    amount: upcomingAmountOf(b, kind),
    lodging: b.total_amount,
    bathTax: b.bath_tax_amount ?? 0,
    discount: b.prepay_discount_amount ?? 0,
    cardLabel: b.card_label,
    error: kind === 'charge_failed' ? b.charge_error : kind === 'cancel_fee' ? b.cancel_fee_error : null,
    cancelledAt: b.cancelled_at ?? null,
    cancelFee: b.cancel_fee ?? 0,
    cancelFeeSettlement: b.cancel_fee_settlement ?? null,
    cancelFeeStatus: b.cancel_fee_status ?? null,
    chargeAttempts: b.charge_attempts ?? 0
  });

  const scheduled: UpcomingChargeRow[] = [];
  const failed: UpcomingChargeRow[] = [];
  for (const b of (a.data ?? []) as unknown as Row[]) {
    const kind = upcomingKindOf(b);
    if (kind === 'scheduled' && inChargeRange(b.check_out_date, opts.range)) scheduled.push(toView(b, kind));
    else if (kind === 'charge_failed') failed.push(toView(b, kind));
  }
  const cancelFees = ((f.data ?? []) as unknown as Row[]).filter((b) => upcomingKindOf(b) === 'cancel_fee').map((b) => toView(b, 'cancel_fee'));
  const feeIds = new Set(cancelFees.map((x) => x.id));
  const cancelled = ((r?.data ?? []) as unknown as Row[]).filter((b) => !feeIds.has(b.id)).map((b) => toView(b, 'cancelled'));

  const byDate = (x: UpcomingChargeRow, y: UpcomingChargeRow) => x.chargeOn.localeCompare(y.chargeOn) || x.bookingCode.localeCompare(y.bookingCode);
  scheduled.sort(byDate);
  failed.sort(byDate);
  cancelFees.sort(byDate);
  return {
    scheduled,
    failed,
    cancelFees,
    cancelled,
    truncated: [a, f, r].some((res) => (res?.data?.length ?? 0) >= LIMIT)
  };
}
