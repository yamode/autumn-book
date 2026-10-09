// 取引先予約の月次請求書（利用明細書＋適格請求書）の計算と紙面（サーバ・画面共通の純関数）。
//
// 2026-10-01 ユーザー指示:
//   - チェックアウト基準・月末締め。金額は予約時の金額（rms_partner_bookings）。PMS の会計実績は使わない。
//   - ご請求（振込を求める）のは「月末締め翌月末銀行振込」と、「請求書で精算」にした自由入力の支払方法。
//     利用明細書には当月チェックアウトの取引先予約をすべて載せる（オンライン決済済み等は「お支払い済み・別精算」）。
//   - 支払期限は翌月末。
// 適格請求書の記載事項（消費税法 57条の4）: 発行者の名称・登録番号／取引年月日／取引内容／
//   税率ごとに区分した対価の額（税込）と適用税率／税率ごとの消費税額（請求書1枚につき税率ごとに1回の端数処理）／受領者の名称。
// 宿泊料金は税込10%。入湯税は消費税の対象外（不課税）として別に区分する。
//
// デポジット（Phase 3b・2026-10-07）: 受付枠を超えて deposit_online で受けた予約は、残額の精算先が請求書なら
//   「ご請求の対象」としてデポジットを差し引いた残額だけを請求し、明細に「うちデポジット ○円 お支払い済み」を出す。
//   残額が現地なら請求額 0（別途精算）。デポジットは宿泊料金（10%）から先に差し引き、超えた分を入湯税から差し引く。
//   取消時はデポジットをキャンセル料に充当し、超えた分を不課税で請求する（2026-10-07 変更: 残額の精算先が現地でも請求する・旧 N3 廃止）。
// 紙面（HTML）は Cloudflare Browser Rendering で PDF にする（lib/server/partners/invoice-pdf.ts）。
// PDF が作れない環境でも、同じ HTML をそのまま開いて印刷できる。
//
// 全施設分を1枚に（複数施設化 決定 N3・docs/partner-multi-facility.md §7.1・2026-10-09）:
//   - 取引先 × 月で1枚（InvoiceDocument version 2）。明細の行は予約の施設（facilityId / facilityName）に帰属し、
//     紙面は 施設 → お支払方法（ご請求の対象を先）の2階層で並べ、施設ごとの小計を出す。
//   - 施設の小計は 10%対象（税込）・入湯税・キャンセル料・ご請求額だけ（M3）。消費税は請求書1枚で1回だけ端数処理する。
//   - 載っている施設が1つだけなら、施設の見出し・小計を出さず従来（version 1）と同じ紙面にする。
//   - 発行済みの version 1（施設ごとの請求書）は document に固定されたまま、従来どおり描ける。
import { chargeAmountOf, isDepositPaymentOption, isDepositRemainderBilled, type PartnerBookingSettings } from '$lib/partner-booking';

export const INVOICE_TAX_RATE = 10;

// 請求書の対象として読む予約の列（rms_partner_bookings の一部）
export type InvoiceBookingSource = {
  id: string;
  booking_code: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  room_name: string | null;
  room_short_name?: string | null; // 部屋タイプの短縮名（紙面ではこちらを優先）
  room_count: number;
  adult_total: number;
  plan_name: string | null;
  guest_name: string;
  booked_by: string | null;
  total_amount: number;
  bath_tax_amount: number | null;
  prepay_discount_amount: number | null;
  payment_option: string | null;
  payment_method_name: string | null;
  payment_status: string;
  detail?: { booker?: { name?: string } | null; plan_display_name?: string | null } | null;
  // 取消済みの予約のキャンセル料（2026-10-06〜・不課税）。無い列（古いデータ）は 0 扱い
  cancelled_at?: string | null;
  cancel_fee?: number | null;
  cancel_fee_rate?: number | null;
  cancel_fee_basis?: string | null;
  cancel_fee_settlement?: string | null;
  cancel_fee_status?: string | null;
  paid_amount?: number | null;
  refund_amount?: number | null;
  // デポジット（Phase 3b）。payment_option='deposit_online' のときだけ
  deposit_amount?: number | null;
  remainder_option?: string | null;
  // 予約の施設（台帳 rms_partner_bookings.facility_id）と施設名（2026-10-09 全施設分1枚・N3）
  facility_id?: string | null;
  facility_name?: string | null;
};

export type InvoiceLine = {
  bookingId: string;
  bookingCode: string;
  checkIn: string;
  checkOut: string; // 取引年月日（チェックアウト日）
  nights: number;
  roomName: string;
  roomCount: number;
  adults: number;
  planName: string;
  guestName: string;
  bookerName: string;
  paymentLabel: string; // 旧形式（お支払方法＋状態）。2026-10-02 以降は paymentMethod / paymentNote も持つ
  paymentMethod?: string; // お支払方法の名前（ご利用明細書のグループ見出し）
  paymentNote?: string; // ご請求の対象外の理由（決済済み・別途精算など。対象なら ''）
  lodging: number; // 宿泊料金（税込10%・割引前）
  bathTax: number; // 入湯税（不課税）
  discount: number; // 予約時決済の割引
  usage: number; // ご利用額 = lodging + bathTax - discount（取消の行はキャンセル料）
  billable: boolean;
  billed: number; // ご請求額（billable なら usage、それ以外 0）
  // 取消の予約の行（2026-10-06〜）。宿泊料金・入湯税・割引は 0、usage がキャンセル料（不課税・逸失利益に対する損害賠償金）
  cancelFee?: number;
  cancelledOn?: string; // 取消日（YYYY-MM-DD・JST）
  cancelNote?: string; // 「2日前の取消 30%」など
  // デポジット（Phase 3b）: ご利用額のうちお支払い済みのデポジット（取消の行は充当した額）。ご請求額＝ご利用額−これ
  deposit?: number;
  // 予約の施設（2026-10-09 全施設分1枚・N3）。取消・デポジット不足分・返金しない額の行もその予約の施設に帰属。version 1 の紙面には無い
  facilityId?: string;
  facilityName?: string;
};

export type InvoiceIssuer = {
  name: string;
  /** version 1（施設ごと）の発行施設名。version 2（全施設分1枚）は ''（発行者欄に施設名を出さない・§7.1） */
  facilityName: string;
  address: string;
  tel: string;
  registrationNumber: string;
  bankAccount: string;
  note: string;
};

// 紙面の全内容（rms_partner_invoices.document に固定して持つ）
type InvoiceDocumentBase = {
  invoiceNo: string;
  period: string; // YYYY-MM-01
  issueDate: string;
  dueDate: string;
  recipient: { name: string };
  issuer: InvoiceIssuer;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
};

/** version 1: 施設ごとの請求書（〜2026-10-09。発行済みはそのまま描く） */
export type InvoiceDocumentV1 = InvoiceDocumentBase & { version: 1 };

/** version 2: 取引先 × 月で全施設分を1枚（N3）。facilities = 載っている施設（施設の並び順）と施設ごとの小計 */
export type InvoiceDocumentV2 = InvoiceDocumentBase & { version: 2; facilities: InvoiceFacilityGroup[] };

export type InvoiceDocument = InvoiceDocumentV1 | InvoiceDocumentV2;

/**
 * 施設ごとの小計（M3: 10%対象〔税込〕・入湯税・キャンセル料・ご請求額だけ。消費税は請求書全体で1回だけ計算するので持たない）。
 * count / billableCount / usageTotal / paidTotal はご利用明細書の施設小計・一覧の表示用。
 */
export type InvoiceFacilitySubtotal = {
  count: number;
  billableCount: number;
  usageTotal: number;
  paidTotal: number;
  billedTotal: number;
  taxable10: number;
  nonTaxable: number;
  cancelFee: number;
};

/** 紙面の施設グループ。address / tel は施設見出しに小さく出す施設の連絡先（M1・無ければ出さない） */
export type InvoiceFacilityGroup = {
  id: string;
  name: string;
  address?: string;
  tel?: string;
  totals: InvoiceFacilitySubtotal;
};

/** 施設の並び・名前・連絡先（facilitiesOfLines の材料） */
export type InvoiceFacilityInfo = { id: string; name: string; address?: string; tel?: string };

export type InvoiceTotals = {
  usageTotal: number;
  paidTotal: number; // お支払い済み・別精算（ご請求の対象外）
  billedTotal: number;
  taxable10: number; // ご請求のうち 10% 対象（税込）
  tax10: number; // うち消費税
  nonTaxable: number; // ご請求のうち 入湯税（不課税）
  // ご請求のうち キャンセル料（不課税・逸失利益に対する損害賠償金）。2026-10-06 より前の紙面には無い
  cancelFee?: number;
};

// ---- 日付（JST の暦日として ISO 文字列で扱う） ----

const pad = (n: number) => String(n).padStart(2, '0');
export const periodOf = (isoDate: string) => `${isoDate.slice(0, 7)}-01`;
export function lastDayOfMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(d)}`;
}
export const isLastDayOfMonth = (isoDate: string) => lastDayOfMonth(periodOf(isoDate)) === isoDate;
export function nextMonthEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m + 1, 0));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const periodLabel = (period: string) => `${Number(period.slice(0, 4))}年${Number(period.slice(5, 7))}月`;
const ymd = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

// ---- 対象・金額 ----

// ご請求（振込を求める）支払方法か。後払いは常に、自由入力は「請求書で精算」にしたものだけ。
export function isBillablePaymentOption(id: string | null | undefined, s: Pick<PartnerBookingSettings, 'customPaymentOptions'>): boolean {
  if (!id) return false;
  if (id === 'invoice_monthly') return true;
  return s.customPaymentOptions.some((o) => o.id === id && o.billable);
}

/**
 * 取引先払いの予約か（宿泊料金・入湯税〈デポジットは残額〉を取引先へ月末に請求し、お客様には請求しない）。
 * デポジットは残額の精算先（予約時のスナップショット remainder_option）で決める。電文の payment.billed_to と同じ。
 */
export function isPartnerBilledBooking(
  b: { payment_option: string | null | undefined; remainder_option?: string | null },
  s: Pick<PartnerBookingSettings, 'customPaymentOptions'>
): boolean {
  if (isDepositPaymentOption(b.payment_option)) return isDepositRemainderBilled(b.remainder_option);
  return isBillablePaymentOption(b.payment_option, s);
}

/**
 * 対象月のうち請求書に載せるチェックアウト日の上限。月末と今日（JST）の早いほう。
 * 月の途中で手動発行したとき、まだチェックアウトしていない予約を請求しないため。
 */
export const invoiceCutoffDate = (period: string, today?: string): string => {
  const end = lastDayOfMonth(period);
  return today && today < end ? today : end;
};

// 請求書に載せる予約か（確定済み・チェックアウト日が対象月かつ今日まで）。取消・支払待ち・期限切れは載せない。
// today を省くと月末まで（過去の月・月末の自動発行と同じ）。
// 取消済みでもキャンセル料（予約時決済から差し引いた額を含む）がある予約は、チェックアウト予定日の月に載せる（2026-10-06 指示）。
export const isInvoiceTarget = (b: InvoiceTargetSource, period: string, today?: string) =>
  (b.status === 'confirmed' || (b.status === 'cancelled' && cancelChargeOf(b) > 0)) &&
  b.check_out_date >= period &&
  b.check_out_date <= invoiceCutoffDate(period, today);

type InvoiceTargetSource = Pick<InvoiceBookingSource, 'status' | 'check_out_date'> &
  Partial<Pick<InvoiceBookingSource, 'cancel_fee' | 'cancel_fee_settlement' | 'paid_amount' | 'refund_amount' | 'payment_status' | 'deposit_amount' | 'remainder_option'>>;

/**
 * デポジット予約の取消（cancel_fee_settlement='deposit'）で受け取る額の内訳。
 *   kept      … デポジットから充当した額（返金後は 支払額−返金額。返金前は min(キャンセル料, デポジット)）
 *   shortage  … キャンセル料がデポジットを超えた額（請求書で請求する。2026-10-07 から残額の精算先が現地でも請求）
 */
export function depositCancelPartsOf(b: Omit<InvoiceTargetSource, 'status' | 'check_out_date'>): { kept: number; shortage: number } {
  const fee = Math.max(0, b.cancel_fee ?? 0);
  const paid = Math.max(0, b.paid_amount ?? b.deposit_amount ?? 0);
  // 返金済みなら 支払額−返金額。返金していない（スタッフの取消で「返金しない」・キャンセル料がデポジット以上）なら全額を受け取ったまま
  const kept =
    b.payment_status === 'refunded' ? Math.max(0, paid - (b.refund_amount ?? paid)) : b.payment_status === 'paid' ? paid : Math.min(fee, paid);
  const over = Math.max(0, fee - Math.min(fee, paid));
  return { kept, shortage: over };
}

/**
 * 取消の予約で受け取る額（不課税）。
 *   invoice / card … キャンセル料
 *   refund（予約時決済から差し引き）… 支払額 − 返金額（直販と同じく割引分・事務手数料〔2026-10-07〕を差し引いたときはキャンセル料より大きい）
 */
export function cancelChargeOf(b: Omit<InvoiceTargetSource, 'status' | 'check_out_date'>): number {
  const fee = Math.max(0, b.cancel_fee ?? 0);
  if (b.cancel_fee_settlement === 'invoice' || b.cancel_fee_settlement === 'card') return fee;
  if (b.cancel_fee_settlement === 'deposit') {
    const d = depositCancelPartsOf(b);
    return d.kept + d.shortage;
  }
  if (b.cancel_fee_settlement === 'refund') {
    const paid = b.paid_amount ?? 0;
    if (b.payment_status === 'refunded') return Math.max(0, paid - (b.refund_amount ?? paid));
    // 返金前・返金失敗・スタッフが返金しなかった予約は、規定のキャンセル料分を受け取ったものとして載せる
    return Math.min(fee, Math.max(0, paid));
  }
  return 0;
}

// チェックアウト日のカード決済が失敗したままの予約か（請求はしない・宿が確認する）
export const isChargeFailed = (b: Pick<InvoiceBookingSource, 'payment_status'>) => b.payment_status === 'charge_failed';

// ---- 送信の失敗回数（rms_partner_invoices.send_error の先頭に「[送信失敗 N回目]」として持つ・列は増やさない） ----

export const MAX_INVOICE_SEND_ATTEMPTS = 3;
const SEND_FAILURE_RE = /^\[送信失敗 (\d+)回目\]\s*/;

/** これまでの送信失敗回数。send_error が無ければ 0、回数の印が無い古い記録は 1。 */
export function sendFailureCount(sendError: string | null | undefined): number {
  if (!sendError) return 0;
  const m = SEND_FAILURE_RE.exec(sendError);
  return m ? Number(m[1]) : 1;
}

/** 送信失敗を記録する文言（前回までの回数に 1 を足して先頭に付ける）。 */
export function sendFailureMessage(previous: string | null | undefined, reason: string): string {
  const n = sendFailureCount(previous) + 1;
  return `[送信失敗 ${n}回目] ${reason.replace(SEND_FAILURE_RE, '')}`.slice(0, 500);
}

const paymentNote = (b: InvoiceBookingSource): string => {
  if (b.payment_status === 'paid') return 'オンライン決済済み';
  if (b.payment_status === 'charge_failed') return 'カード決済失敗（要確認）';
  if (b.payment_status === 'scheduled') return 'カード決済（チェックアウト日）';
  return '別途精算';
};

const jstDay = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10) : '');

function cancelNoteOf(b: InvoiceBookingSource): string {
  const basis = b.cancel_fee_basis ?? '';
  const head =
    b.cancel_fee_rate == null
      ? basis
        ? `キャンセル料（${basis}）`
        : 'キャンセル料'
      : `キャンセル料 ${basis === '不泊' ? '不泊' : `${basis}の取消`} ${b.cancel_fee_rate}%`;
  // 予約時決済・デポジットから差し引いた額がキャンセル料より大きい（事務手数料・予約時決済割引の分を返金しなかった・2026-10-07）
  const over = (b.cancel_fee_settlement === 'refund' || b.cancel_fee_settlement === 'deposit') && cancelChargeOf(b) > Math.max(0, b.cancel_fee ?? 0);
  return over ? `${head}（事務手数料等の返金しない分を含む）` : head;
}

// 予約の施設（あるときだけ行に付ける。施設の無い入力は従来どおりの行）
const facilityOfSource = (b: InvoiceBookingSource): Pick<InvoiceLine, 'facilityId' | 'facilityName'> =>
  b.facility_id ? { facilityId: b.facility_id, facilityName: (b.facility_name ?? '').trim() } : {};

export function buildInvoiceLines(bookings: InvoiceBookingSource[], s: Pick<PartnerBookingSettings, 'customPaymentOptions'>): InvoiceLine[] {
  return bookings
    .map((b): InvoiceLine => {
      if (b.status === 'cancelled') {
        // 取消の行: 宿泊料金・入湯税は請求しない。キャンセル料（不課税）だけ。
        // 請求書払い（invoice・カード請求の失敗を含む）はご請求、予約時決済から差し引き・カードで回収済みは対象外（済み）
        const charge = cancelChargeOf(b);
        // デポジット（Phase 3b）: 充当した額はお支払い済み、超えた分（残額が請求書のときだけ）をご請求
        const dep = b.cancel_fee_settlement === 'deposit' ? depositCancelPartsOf(b) : null;
        const billable = b.cancel_fee_settlement === 'invoice' || (!!dep && dep.shortage > 0);
        const note =
          b.cancel_fee_settlement === 'refund'
            ? 'オンライン決済から差引済み'
            : b.cancel_fee_settlement === 'card'
              ? 'カード決済済み'
              : dep
                ? 'デポジットから充当済み'
                : '';
        return {
          bookingId: b.id,
          bookingCode: b.booking_code,
          checkIn: b.check_in_date,
          checkOut: b.check_out_date,
          nights: b.nights,
          roomName: (b.room_short_name ?? '').trim() || (b.room_name ?? ''),
          roomCount: b.room_count,
          adults: b.adult_total,
          planName: (b.detail?.plan_display_name ?? '').trim() || (b.plan_name ?? ''),
          guestName: b.guest_name,
          bookerName: (b.detail?.booker?.name ?? '').trim() || (b.booked_by ?? ''),
          paymentLabel: billable ? (b.payment_method_name ?? '') : `${b.payment_method_name ?? ''}（${note}）`,
          paymentMethod: b.payment_method_name ?? '',
          paymentNote: billable ? '' : note,
          lodging: 0,
          bathTax: 0,
          discount: 0,
          usage: charge,
          billable,
          billed: billable ? charge - (dep?.kept ?? 0) : 0,
          cancelFee: charge,
          cancelledOn: jstDay(b.cancelled_at),
          cancelNote: cancelNoteOf(b),
          ...(dep && dep.kept > 0 ? { deposit: dep.kept } : {}),
          ...facilityOfSource(b)
        };
      }
      const lodging = b.total_amount;
      const bathTax = b.bath_tax_amount ?? 0;
      const discount = b.prepay_discount_amount ?? 0;
      const usage = chargeAmountOf(b);
      // デポジット（Phase 3b）: お支払い済みのデポジットを差し引いた残額を請求（残額が現地なら対象外・別途精算）
      const deposit = isDepositPaymentOption(b.payment_option) ? Math.min(usage, Math.max(0, b.paid_amount ?? b.deposit_amount ?? 0)) : 0;
      const billable = isPartnerBilledBooking(b, s);
      const note = deposit > 0 && !billable ? `デポジット ${yen(deposit)} お支払い済み・残額は現地で精算` : paymentNote(b);
      return {
        bookingId: b.id,
        bookingCode: b.booking_code,
        checkIn: b.check_in_date,
        checkOut: b.check_out_date,
        nights: b.nights,
        roomName: (b.room_short_name ?? '').trim() || (b.room_name ?? ''),
        roomCount: b.room_count,
        adults: b.adult_total,
        // 取引先向けのプラン名（予約時点）。無い予約は元の名前
        planName: (b.detail?.plan_display_name ?? '').trim() || (b.plan_name ?? ''),
        guestName: b.guest_name,
        bookerName: (b.detail?.booker?.name ?? '').trim() || (b.booked_by ?? ''),
        paymentLabel: billable ? (b.payment_method_name ?? '') : `${b.payment_method_name ?? ''}（${note}）`,
        paymentMethod: b.payment_method_name ?? '',
        paymentNote: billable ? '' : note,
        lodging,
        bathTax,
        discount,
        usage,
        billable,
        billed: billable ? usage - deposit : 0,
        ...(deposit > 0 ? { deposit } : {}),
        ...facilityOfSource(b)
      };
    })
    .sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.bookingCode.localeCompare(b.bookingCode));
}

/**
 * 宿泊の行のデポジットの差し引き先（Phase 3b）: 宿泊料金（10%）から先に、超えた分を入湯税（不課税）から。
 * デポジットが無い行は 0・0。
 */
export function depositSplitOf(l: Pick<InvoiceLine, 'lodging' | 'discount' | 'bathTax' | 'deposit'>): { lodging: number; bathTax: number } {
  const dep = Math.max(0, l.deposit ?? 0);
  const lodging = Math.min(dep, Math.max(0, l.lodging - l.discount));
  return { lodging, bathTax: Math.min(dep - lodging, Math.max(0, l.bathTax)) };
}

export function invoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  const usageTotal = lines.reduce((s, l) => s + l.usage, 0);
  const billedLines = lines.filter((l) => l.billable);
  const billedTotal = billedLines.reduce((s, l) => s + l.billed, 0);
  // デポジットを差し引いた残額で区分する（取消の行はキャンセル料から充当分を引く）
  const stayLines = billedLines.filter((l) => l.cancelFee == null);
  const taxable10 = stayLines.reduce((s, l) => s + (l.lodging - l.discount - depositSplitOf(l).lodging), 0);
  const nonTaxable = stayLines.reduce((s, l) => s + (l.bathTax - depositSplitOf(l).bathTax), 0);
  const cancelFee = billedLines.reduce((s, l) => s + (l.cancelFee != null ? l.cancelFee - (l.deposit ?? 0) : 0), 0);
  return {
    usageTotal,
    paidTotal: usageTotal - billedTotal,
    billedTotal,
    taxable10,
    // 税込額から割り戻し、請求書1枚につき1回だけ切り捨て
    tax10: Math.floor((taxable10 * INVOICE_TAX_RATE) / (100 + INVOICE_TAX_RATE)),
    nonTaxable,
    cancelFee
  };
}

// ---- 施設ごとの小計（全施設分1枚・N3・2026-10-09） ----

/** 施設ごとの小計（M3: 消費税は出さない）。合計の規則は invoiceTotals と同じ */
export function invoiceFacilitySubtotal(lines: InvoiceLine[]): InvoiceFacilitySubtotal {
  const t = invoiceTotals(lines);
  return {
    count: lines.length,
    billableCount: lines.filter((l) => l.billable).length,
    usageTotal: t.usageTotal,
    paidTotal: t.paidTotal,
    billedTotal: t.billedTotal,
    taxable10: t.taxable10,
    nonTaxable: t.nonTaxable,
    cancelFee: t.cancelFee ?? 0
  };
}

/**
 * 明細の行から、載っている施設と施設ごとの小計を作る（InvoiceDocumentV2.facilities）。
 * 並びは order（施設の並び順）→ order に無い施設は行に出てきた順。名前・連絡先は order を優先し、無ければ行の施設名。
 * 施設の無い行は id '' のグループにまとめる。
 */
export function facilitiesOfLines(lines: InvoiceLine[], order: InvoiceFacilityInfo[] = []): InvoiceFacilityGroup[] {
  const byId = new Map<string, InvoiceLine[]>();
  for (const l of lines) {
    const id = l.facilityId ?? '';
    const list = byId.get(id) ?? [];
    list.push(l);
    byId.set(id, list);
  }
  const rank = (id: string) => {
    const i = order.findIndex((f) => f.id === id);
    return i < 0 ? order.length : i;
  };
  return [...byId.entries()]
    .map(([id, ls], i) => ({ id, ls, i }))
    .sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i)
    .map(({ id, ls }) => {
      const info = order.find((f) => f.id === id);
      const name = (info?.name ?? '').trim() || ls.find((l) => l.facilityName)?.facilityName || '';
      return {
        id,
        name,
        ...(info?.address ? { address: info.address } : {}),
        ...(info?.tel ? { tel: info.tel } : {}),
        totals: invoiceFacilitySubtotal(ls)
      };
    });
}

/** 施設の見出し・小計を出す紙面か（version 2 で施設が2つ以上）。1施設なら従来の紙面 */
export const isMultiFacilityInvoice = (doc: InvoiceDocument): doc is InvoiceDocumentV2 =>
  doc.version === 2 && Array.isArray(doc.facilities) && doc.facilities.length > 1;

/** 請求書に載っている施設名（一覧の表示用）。version 1 は発行施設の名前 */
export function invoiceFacilityNames(doc: InvoiceDocument): string[] {
  if (doc.version === 2) return (doc.facilities ?? []).map((f) => f.name).filter((n) => !!n);
  return doc.issuer?.facilityName ? [doc.issuer.facilityName] : [];
}

/** 予定請求の施設別小計の CSV の1行（M5・freee の入金消込の手元資料）。1行 = 取引先 × 施設 */
export type InvoiceFacilityCsvRow = {
  period: string; // YYYY-MM-01
  partnerName: string;
  facilityName: string;
  taxable10: number;
  nonTaxable: number;
  cancelFee: number;
  billedTotal: number;
};

const csvCell = (v: string | number) => {
  // 文字列の先頭が = + - @ だと表計算ソフトが式として読むので、先頭に ' を付ける（数値はそのまま）
  const s = typeof v === 'string' && /^[=+\-@\t\r]/.test(v) ? `'${v}` : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * 施設別小計の CSV（見出し: 期間・取引先・施設・10%対象（税込）・入湯税・キャンセル料・ご請求額）。
 * Excel で文字化けしないよう先頭に BOM・改行は CRLF。期間は YYYY-MM。
 */
export function invoiceFacilityCsv(rows: InvoiceFacilityCsvRow[]): string {
  const head = ['期間', '取引先', '施設', '10%対象（税込）', '入湯税', 'キャンセル料', 'ご請求額'];
  const body = rows.map((r) => [r.period.slice(0, 7), r.partnerName, r.facilityName, r.taxable10, r.nonTaxable, r.cancelFee, r.billedTotal]);
  return '﻿' + [head, ...body].map((cols) => cols.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

// ---- 紙面（HTML） ----

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');

const STYLE = `
@page { size: A4; margin: 13mm 13mm 15mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif; color: #1c1917; font-size: 10pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
h1 { font-size: 20pt; letter-spacing: .35em; text-align: center; margin: 0 0 1.5mm; font-weight: 700; }
.sub { text-align: center; font-size: 9pt; color: #57534e; margin-bottom: 6mm; }
.head { display: flex; justify-content: space-between; gap: 8mm; align-items: flex-start; }
.to { font-size: 14pt; border-bottom: 1px solid #1c1917; padding-bottom: 1mm; min-width: 85mm; }
.meta { font-size: 9pt; text-align: right; border-collapse: collapse; margin-left: auto; }
.meta td { padding: 0 0 0 4mm; white-space: nowrap; }
.issuer { margin-top: 3mm; font-size: 9pt; text-align: right; line-height: 1.55; }
.issuer b { font-size: 10.5pt; }
.amount { margin: 6mm 0 4mm; display: flex; align-items: baseline; gap: 6mm; border: 1.5px solid #1c1917; padding: 2.5mm 5mm; width: 115mm; }
.amount .l { font-size: 10.5pt; }
.amount .v { font-size: 19pt; font-weight: 700; }
table.t { width: 100%; border-collapse: collapse; font-size: 8.5pt; table-layout: fixed; }
table.t th, table.t td { border: 1px solid #a8a29e; padding: 1.2mm 1.6mm; vertical-align: top; }
table.t th { background: #f5f5f4; font-weight: 600; line-height: 1.3; }
table.t td.n, table.t th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
table.t .nw { white-space: nowrap; }
table.t td.n .wrap { white-space: normal; display: inline-block; text-align: right; }
table.t tr.sum td { font-weight: 700; background: #fafaf9; }
table.t tr.sub td { background: #fafaf9; }
.grp { margin: 5mm 0 1.5mm; font-size: 9.5pt; font-weight: 700; display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; border-left: 3px solid #1c1917; padding-left: 2mm; }
.grp small { font-weight: 400; color: #57534e; font-size: 8.5pt; white-space: nowrap; }
.box { margin-top: 5mm; border: 1px solid #a8a29e; padding: 3mm 4mm; font-size: 9.5pt; }
.box h3 { margin: 0 0 1mm; font-size: 9.5pt; }
.note { margin-top: 3mm; font-size: 8.5pt; color: #57534e; }
.muted { color: #78716c; }
.small { font-size: 7.5pt; }
`;

// 書類名（2026-10-02 指示:「ご請求書」「ご利用明細書」）
const DOC_INVOICE = 'ご請求書';
const DOC_STATEMENT = 'ご利用明細書';
// 予定請求書（正式発行前の試算・管理画面で確認する用。2026-10-02 指示）の書類名の後ろに付ける
const DRAFT_SUFFIX = '（予定）';

export type RenderInvoiceOptions = {
  /** true = 予定請求書（書類名に「（予定）」・上部の帯・「予定」の透かし・番号は未発行・発行日の欄は試算日）。doc.issueDate を試算日として扱う */
  draft?: boolean;
};

// 予定請求書だけに足す CSS（正式版の STYLE は変えない）
const DRAFT_STYLE = `
.draft-band { margin: 0 0 4mm; padding: 2mm 4mm; border: 1.5px solid #b45309; background: #fffbeb; color: #78350f; font-size: 9.5pt; font-weight: 700; text-align: center; }
.draft-wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 120pt; font-weight: 700; color: rgba(180, 83, 9, .08); transform: rotate(-30deg); pointer-events: none; z-index: 0; letter-spacing: .2em; }
`;

// 施設が2つ以上の紙面（全施設分1枚・N3）だけに足す CSS（1施設・version 1 の紙面は従来と同じ HTML のまま）
const FACILITY_STYLE = `
table.t tr.fac td { background: #e7e5e4; font-weight: 700; font-size: 9pt; }
.fac-h { margin: 7mm 0 0; padding: 1.5mm 2.5mm; font-size: 11pt; font-weight: 700; display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; background: #f5f5f4; border-left: 5px solid #1c1917; }
.fac-h small { font-weight: 400; color: #57534e; font-size: 8.5pt; }
table.t.fac-sub { margin-top: 1.5mm; }
`;

const draftBand = (doc: InvoiceDocument) =>
  `<div class="draft-band">予定請求書 — ${Number(doc.issueDate.slice(5, 7))}月${Number(doc.issueDate.slice(8, 10))}日時点の実績（チェックアウト済み）による試算です。正式なご請求書ではありません</div>`;

function headerBlock(doc: InvoiceDocument, title: string, sub: string, draft = false): string {
  const i = doc.issuer;
  return `${draft ? draftBand(doc) : ''}
<h1>${esc(draft ? title + DRAFT_SUFFIX : title)}</h1>
<div class="sub">${esc(sub)}</div>
<div class="head">
  <div><div class="to">${esc(doc.recipient.name)} 御中</div></div>
  <div>
    <table class="meta">
      <tr><td>請求書番号</td><td>${esc(draft ? '（未発行）' : doc.invoiceNo)}</td></tr>
      <tr><td>${draft ? '試算日' : '発行日'}</td><td>${ymd(doc.issueDate)}</td></tr>
    </table>
    <div class="issuer">
      <b>${esc(i.name)}</b><br>
      ${i.facilityName ? `${esc(i.facilityName)}<br>` : ''}
      ${i.address ? `${nl2br(i.address)}<br>` : ''}
      ${i.tel ? `TEL ${esc(i.tel)}<br>` : ''}
      ${i.registrationNumber ? `登録番号 ${esc(i.registrationNumber)}` : ''}
    </div>
  </div>
</div>`;
}

const periodSub = (doc: InvoiceDocument) =>
  `${periodLabel(doc.period)}ご利用分（${ymd(doc.period)}〜${ymd(lastDayOfMonth(doc.period))} チェックアウト）`;

// お部屋・人数の1行（例: 「オーシャンスイート57平米 1室・2名」）
const roomLine = (l: InvoiceLine) => `${esc(l.roomName)} ${l.roomCount}室・${l.adults}名`;

function invoicePage(doc: InvoiceDocument, draft = false): string {
  const t = doc.totals;
  const billed = doc.lines.filter((l) => l.billable);
  const rowOf = (l: InvoiceLine) => `<tr>
  <td class="nw">${md(l.checkOut)}<br><span class="muted small">${esc(l.bookingCode)}</span></td>
  <td>${
    l.cancelFee != null
      ? `${esc(l.cancelNote ?? 'キャンセル料')}（不課税）<br><span class="muted">ご宿泊予定 <span class="nw">${md(l.checkIn)}〜${l.nights}泊</span>　${roomLine(l)}　${esc(l.guestName)} 様${l.cancelledOn ? `・${md(l.cancelledOn)} 取消` : ''}</span>`
      : `ご宿泊 <span class="nw">${md(l.checkIn)}〜${l.nights}泊</span>　${roomLine(l)}<br><span class="muted">${esc(l.guestName)} 様</span>`
  }${l.deposit ? `<br><span class="muted small">ご利用額 ${yen(l.usage)} のうちデポジット ${yen(l.deposit)} お支払い済み（差し引き後の額）</span>` : ''}</td>
  <td class="n">${l.cancelFee != null ? '—' : yen(l.lodging - l.discount - depositSplitOf(l).lodging)}</td>
  <td class="n">${l.cancelFee == null && l.bathTax - depositSplitOf(l).bathTax ? yen(l.bathTax - depositSplitOf(l).bathTax) : '—'}</td>
  <td class="n">${yen(l.billed)}</td>
</tr>`;
  // 全施設分1枚（N3）で施設が2つ以上: 施設の見出し → その施設の対象行 → 施設小計（10%対象・入湯税・キャンセル料・ご請求額。消費税は出さない・M3）
  const multi = isMultiFacilityInvoice(doc);
  const rows = multi
    ? doc.facilities
        .map((f) => {
          const fl = billed.filter((l) => (l.facilityId ?? '') === f.id);
          if (!fl.length) return '';
          const ft = f.totals;
          return `<tr class="fac"><td colspan="5">${esc(f.name || '（施設未設定）')}${facilityContact(f) ? `<span class="muted small">　${facilityContact(f)}</span>` : ''}</td></tr>
  ${fl.map(rowOf).join('')}
  <tr class="sub"><td colspan="2">${esc(f.name || '（施設未設定）')} 小計（${fl.length}件）${ft.cancelFee ? `<br><span class="muted small">うちキャンセル料（不課税） ${yen(ft.cancelFee)}</span>` : ''}</td><td class="n">${yen(ft.taxable10)}</td><td class="n">${yen(ft.nonTaxable)}</td><td class="n">${yen(ft.billedTotal)}</td></tr>`;
        })
        .join('')
    : billed.map(rowOf).join('');
  return `
<section class="page">
${headerBlock(doc, DOC_INVOICE, `適格請求書　${periodSub(doc)}`, draft)}
<div class="amount"><span class="l">ご請求金額（税込）</span><span class="v">${yen(t.billedTotal)}</span></div>
<table class="t" style="width:115mm;margin-bottom:5mm">
  <colgroup><col style="width:47mm"><col style="width:38mm"><col style="width:30mm"></colgroup>
  <tr><th>区分</th><th class="n">対象額（税込）</th><th class="n">消費税額</th></tr>
  <tr><td>10%対象（宿泊料金）</td><td class="n">${yen(t.taxable10)}</td><td class="n">${yen(t.tax10)}</td></tr>
  <tr><td>不課税（入湯税）</td><td class="n">${yen(t.nonTaxable)}</td><td class="n">—</td></tr>
  ${t.cancelFee ? `<tr><td>不課税（キャンセル料）<br><span class="muted small">逸失利益に対する損害賠償金</span></td><td class="n">${yen(t.cancelFee)}</td><td class="n">—</td></tr>` : ''}
  <tr class="sum"><td>合計</td><td class="n">${yen(t.billedTotal)}</td><td class="n">${yen(t.tax10)}</td></tr>
</table>
<table class="t">
  <colgroup><col style="width:25mm"><col><col style="width:21mm"><col style="width:15mm"><col style="width:21mm"></colgroup>
  <tr><th>取引日<span class="muted small">※</span><br><span class="muted small">予約番号</span></th><th>内容</th><th class="n">宿泊料金<br><span class="muted small">10%・税込</span></th><th class="n">入湯税<br><span class="muted small">不課税</span></th><th class="n">金額</th></tr>
  ${rows}
  <tr class="sum"><td colspan="2">合計（${billed.length}件）</td><td class="n">${yen(t.taxable10)}</td><td class="n">${yen(t.nonTaxable)}</td><td class="n">${yen(t.billedTotal)}</td></tr>
</table>
<div class="box">
  <h3>お支払期限　${ymd(doc.dueDate)}</h3>
  ${doc.issuer.bankAccount ? `<div>お振込先：${nl2br(doc.issuer.bankAccount)}</div>` : ''}
  ${doc.issuer.note ? `<div class="note">${nl2br(doc.issuer.note)}</div>` : ''}
</div>
<div class="note">※ 取引日はチェックアウト日です。ご利用の全予約の内訳は、次ページの${DOC_STATEMENT}をご覧ください。</div>${multi ? `\n${FACILITY_ROUNDING_NOTE}` : ''}
</section>`;
}

// 全施設分1枚の紙面の注記（消費税の端数処理は請求書1枚で1回・M3）
const FACILITY_ROUNDING_NOTE =
  '<div class="note">※ 施設ごとの小計は10%対象（税込）・入湯税・キャンセル料・金額です。消費税額は請求書全体の10%対象額から1回だけ計算しています（施設ごとに計算した額の合計とは1円ほど異なることがあります）。</div>';

// 施設見出しに小さく出す施設の連絡先（M1）
const facilityContact = (f: Pick<InvoiceFacilityGroup, 'address' | 'tel'>) =>
  [f.address ? esc(f.address) : '', f.tel ? `TEL ${esc(f.tel)}` : ''].filter(Boolean).join('　');

// ご利用明細書のグループ（お支払方法ごと。ご請求の対象を先に）。見出しを表の外に出して「お支払方法」の列を省く。
export type StatementGroup = { method: string; billable: boolean; lines: InvoiceLine[] };
export function groupStatementLines(lines: InvoiceLine[]): StatementGroup[] {
  const map = new Map<string, StatementGroup>();
  for (const l of lines) {
    // 旧形式（paymentMethod なし）は paymentLabel をそのまま見出しに
    const method = l.paymentMethod ?? l.paymentLabel;
    const key = `${l.billable ? 0 : 1}|${method}`;
    const g = map.get(key) ?? { method, billable: l.billable, lines: [] };
    g.lines.push(l);
    map.set(key, g);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
}

/**
 * ご利用明細書の2階層のグループ（全施設分1枚・N3）: 施設（doc.facilities の並び）→ お支払方法（ご請求の対象を先）。
 * version 1・施設の無い紙面は、施設 id '' の1グループに全行をまとめる。
 */
export type StatementFacilitySection = { facility: InvoiceFacilityGroup; groups: StatementGroup[] };
export function groupStatementByFacility(doc: InvoiceDocument): StatementFacilitySection[] {
  if (doc.version === 2 && doc.facilities?.length) {
    return doc.facilities.map((facility) => ({
      facility,
      groups: groupStatementLines(doc.lines.filter((l) => (l.facilityId ?? '') === facility.id))
    }));
  }
  return [
    {
      facility: { id: '', name: doc.issuer.facilityName ?? '', totals: invoiceFacilitySubtotal(doc.lines) },
      groups: groupStatementLines(doc.lines)
    }
  ];
}

function statementPage(doc: InvoiceDocument, draft = false): string {
  const t = doc.totals;
  const multi = isMultiFacilityInvoice(doc);
  const head = `<colgroup><col style="width:32mm"><col><col style="width:29mm"><col style="width:19mm"><col style="width:13mm"><col style="width:19mm"><col style="width:19mm"></colgroup>
  <tr><th>ご宿泊<br><span class="muted small">予約番号</span></th><th>お部屋・プラン</th><th>ご宿泊者</th><th class="n">宿泊料金<br><span class="muted small">税込</span></th><th class="n">入湯税</th><th class="n">ご利用額</th><th class="n">ご請求額</th></tr>`;
  const groupBlock = (groups: StatementGroup[]) =>
    groups
    .map((g) => {
      const rows = g.lines
        .map(
          (l) => `<tr>
  <td class="nw">${md(l.checkIn)}〜${md(l.checkOut)}<span class="muted small">・${l.nights}泊</span><br><span class="muted small">${esc(l.bookingCode)}</span></td>
  <td>${roomLine(l)}<br><span class="muted">${esc(l.planName)}</span>${l.cancelFee != null ? `<br><span class="small">${esc(l.cancelNote ?? 'キャンセル料')}（不課税）${l.cancelledOn ? `・${md(l.cancelledOn)} 取消` : ''}</span>` : ''}</td>
  <td>${esc(l.guestName)} 様${l.bookerName ? `<br><span class="muted small">ご予約者 ${esc(l.bookerName)}</span>` : ''}</td>
  <td class="n">${l.cancelFee != null ? '—' : `${yen(l.lodging)}${l.discount ? `<br><span class="muted small">割引 −${yen(l.discount)}</span>` : ''}`}</td>
  <td class="n">${l.bathTax ? yen(l.bathTax) : '—'}</td>
  <td class="n">${yen(l.usage)}${l.deposit ? `<br><span class="muted small wrap">うちデポジット ${yen(l.deposit)} お支払い済み</span>` : ''}</td>
  <td class="n">${l.billable ? yen(l.billed) : `—${l.paymentNote ? `<br><span class="muted small wrap">${esc(l.paymentNote)}</span>` : ''}`}</td>
</tr>`
        )
        .join('');
      const usage = g.lines.reduce((s, l) => s + l.usage, 0);
      const billed = g.lines.reduce((s, l) => s + l.billed, 0);
      return `
<div class="grp"><span>お支払方法：${esc(g.method || '（未設定）')}</span><small>${g.billable ? 'ご請求の対象' : 'お支払い済み・別途精算（今回のご請求に含みません）'}・${g.lines.length}件</small></div>
<table class="t">
  ${head}
  ${rows}
  <tr class="sub"><td colspan="5">小計（${g.lines.length}件）</td><td class="n">${yen(usage)}</td><td class="n">${g.billable ? yen(billed) : '—'}</td></tr>
</table>`;
    })
    .join('');
  // 全施設分1枚（N3）で施設が2つ以上: 施設の見出し → お支払方法のグループ → 施設小計（ご利用額・ご請求額）
  const body = multi
    ? groupStatementByFacility(doc)
        .map(({ facility: f, groups }) => {
          const contact = facilityContact(f);
          return `
<div class="fac-h"><span>${esc(f.name || '（施設未設定）')}</span><small>${contact ? `${contact}・` : ''}${f.totals.count}件</small></div>${groupBlock(groups)}
<table class="t fac-sub">
  <colgroup><col><col style="width:19mm"><col style="width:19mm"></colgroup>
  <tr class="sub"><td>${esc(f.name || '（施設未設定）')} 小計（${f.totals.count}件）${f.totals.cancelFee ? `<span class="muted small">　うちキャンセル料（不課税） ${yen(f.totals.cancelFee)}</span>` : ''}</td><td class="n">${yen(f.totals.usageTotal)}</td><td class="n">${yen(f.totals.billedTotal)}</td></tr>
</table>`;
        })
        .join('')
    : groupBlock(groupStatementLines(doc.lines));
  return `
<section class="page">
${headerBlock(doc, DOC_STATEMENT, periodSub(doc), draft)}
${body || '<p class="note">対象のご予約はありません。</p>'}
<table class="t" style="margin-top:4mm">
  <colgroup><col><col style="width:19mm"><col style="width:19mm"></colgroup>
  <tr class="sum"><td>合計（${doc.lines.length}件）</td><td class="n">${yen(t.usageTotal)}</td><td class="n">${yen(t.billedTotal)}</td></tr>
</table>
<div class="note">
  ご利用総額 ${yen(t.usageTotal)} のうち、お支払い済み・別途精算 ${yen(t.paidTotal)}、今回のご請求 ${yen(t.billedTotal)}。<br>
  金額はご予約時の料金です（宿泊料金は税込・入湯税は別）。ご宿泊時の追加のご利用は含みません。
</div>${multi ? `\n${FACILITY_ROUNDING_NOTE}` : ''}
</section>`;
}

// 書類名（ご請求額が 0 円ならご利用明細書だけ）
export const invoiceDocName = (doc: Pick<InvoiceDocument, 'totals'>) =>
  doc.totals.billedTotal > 0 ? `${DOC_INVOICE}・${DOC_STATEMENT}` : DOC_STATEMENT;

// 予定請求書の書類名（例: ご請求書（予定）／ご請求 0 円なら ご利用明細書（予定））
export const draftInvoiceDocName = (doc: Pick<InvoiceDocument, 'totals'>) =>
  (doc.totals.billedTotal > 0 ? DOC_INVOICE : DOC_STATEMENT) + DRAFT_SUFFIX;

// 紙面の HTML（1ファイル完結）。ご請求額が 0 円ならご利用明細書だけ。opts.draft で予定請求書。
export function renderInvoiceHtml(doc: InvoiceDocument, opts: RenderInvoiceOptions = {}): string {
  const draft = opts.draft === true;
  const pages = (doc.totals.billedTotal > 0 ? invoicePage(doc, draft) : '') + statementPage(doc, draft);
  const title = draft ? `${draftInvoiceDocName(doc)} ${doc.recipient.name} ${periodLabel(doc.period)}` : `${invoiceDocName(doc)} ${doc.invoiceNo}`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=block" rel="stylesheet">
<style>${STYLE}${draft ? DRAFT_STYLE : ''}${isMultiFacilityInvoice(doc) ? FACILITY_STYLE : ''}</style></head><body>${draft ? '<div class="draft-wm" aria-hidden="true">予定</div>' : ''}${pages}</body></html>`;
}

// ダウンロード・添付のファイル名（例: ご請求書・ご利用明細書_PI-202610-00001_2026年10月.pdf）
export const invoiceFileName = (doc: Pick<InvoiceDocument, 'invoiceNo' | 'period' | 'totals'>, ext: 'pdf' | 'html') =>
  `${invoiceDocName(doc)}_${doc.invoiceNo}_${periodLabel(doc.period)}.${ext}`;

// 予定請求書のファイル名（例: ご請求書（予定）_○○トラベル_2026年10月.pdf）。ファイル名に使えない文字は全角に置き換える
const safeFilePart = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]/g,(c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 60);
export const draftInvoiceFileName = (doc: Pick<InvoiceDocument, 'period' | 'totals'>, partnerName: string, ext: 'pdf' | 'html') =>
  `${draftInvoiceDocName(doc)}_${safeFilePart(partnerName) || '取引先'}_${periodLabel(doc.period)}.${ext}`;
