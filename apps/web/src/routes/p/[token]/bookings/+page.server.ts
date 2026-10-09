import { fail } from '@sveltejs/kit';
import { canPartnerCancel, describeDeadline, intentAmountOf } from '$lib/partner-booking';
import {
  cancelPartnerBooking,
  contextsForBookings,
  partnerFacilityName,
  canUpdateCard,
  cardConsentText,
  confirmPartnerIntent,
  bookingPlanName,
  depositSummary,
  cancelFeeBasisLabel,
  cancelFeeSettlementLabel,
  cancelKeptNote,
  listPartnerBookings,
  previewPartnerCancels,
  type PaymentResult
} from '$lib/server/partners/booking';
import { readBookingExtras, splitExtraOptions } from '$lib/server/partners/booking-extras';
import { PartnerStoreError } from '$lib/server/partners/store';
import { bookingNameHolderText } from '$lib/pms-partner-guest';
import { isCreditOver } from '$lib/partner-credit';
import { portalAal2, portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import { isPaymentIntentId, isSetupIntentId } from '$lib/server/payments/verify';
import { stripePublishableKey } from '$lib/server/stripe';
import {
  bookingAttachmentPolicy,
  listBookingAttachments,
  partnerBookingAttachmentsEnabled,
  type BookingAttachmentRow
} from '$lib/server/partners/booking-attachments';
import { portalAttachmentView } from '$lib/server/partners/portal-attachments';
import { PARTNER_ATTACHMENT_ACCEPT, PARTNER_ATTACHMENT_HINT } from '$lib/partner-attachments';

// 予約画面・支払の再開から戻ったときに出す結果（ブラウザが確定の連絡を済ませた後。表示だけに使う）
const RESULT_STATUSES = new Set<PaymentResult['status']>(['paid', 'already', 'unpaid', 'refunded_late', 'card_saved', 'card_updated', 'card_late', 'card_expiry']);

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  let payment: PaymentResult | { status: 'error'; message: string } | null = null;
  const q = event.url.searchParams;
  // Stripe の本人認証でリダイレクトした決済手段の戻り（?payment_intent= / ?setup_intent=。カードは通常モーダルで済み、ここへは来ない）:
  // 支払完了を確かめて予約を確定する（Webhook より先に戻ってきても確定できるように・冪等）
  const returned = q.get('payment_intent') ?? q.get('setup_intent') ?? '';
  if (isPaymentIntentId(returned) || isSetupIntentId(returned)) {
    payment = await confirmPartnerIntent(db, returned, event.url.origin, partner.id).catch((e) => ({
      status: 'error' as const,
      message: e instanceof Error ? e.message : String(e)
    }));
    if (payment.status === 'unknown') payment = { status: 'unpaid' };
  } else if (q.get('result')) {
    // 同じ画面で確定まで済ませて来たとき（?code=&result=）
    const r = q.get('result') as PaymentResult['status'];
    payment = { status: RESULT_STATUSES.has(r) ? r : 'unpaid', bookingCode: q.get('code') ?? undefined };
    if (r === 'card_updated' && q.get('charge')) payment.charge = { status: q.get('charge') === 'paid' ? 'paid' : 'failed', message: '' };
  }
  // 予約の一覧（取消の期限・キャンセル料の見込み・添付を含む）は後から流す（list: Promise・2026-10-10）。
  // 画面は届くまで一覧の枠を出す。読めなかったときは一覧の位置に案内を出す（以前はエラーの画面）。
  // 支払の戻り（上の payment）は確定を済ませてから一覧を読むので、先に待っている
  const attEnabled = partnerBookingAttachmentsEnabled();
  const listLoad = (async () => {
    const rows = await listPartnerBookings(db, { partnerId: partner.id, limit: 300 });
    // 取消の期限は予約の施設の設定で判定する（N6: 施設ごとの cancelDays・2026-10-09 複数施設化）
    const byFacility = await contextsForBookings(db, partner, rows);
    const settingsOf = (b: (typeof rows)[number]) => (byFacility.get(b.facility_id) ?? partner).booking_settings;
    // 取消の期限の文言も予約の施設の設定で（施設ごとに cancelDays・cutoffHour が違いうる）
    const cancelTextOf = (b: (typeof rows)[number]) => {
      const bs = settingsOf(b);
      return bs.cancelDays == null ? null : describeDeadline(bs.cancelDays, bs.cutoffHour);
    };
    // 施設の列（複数施設化 S4・2026-10-09）: オンの施設が2つ以上か、一覧に2つ以上の施設の予約があるときだけ出す（1施設の取引先は今と同じ）
    const facilityIds = new Set(rows.map((b) => b.facility_id).filter(Boolean));
    const multiFacility = partner.facilities.filter((f) => f.enabled).length >= 2 || facilityIds.size >= 2;
    // 絞り込みの施設（予約のある施設・施設の並び順）
    const facilityFilter = multiFacility
      ? partner.facilities.filter((f) => facilityIds.has(f.id)).map((f) => ({ id: f.id, name: f.name }))
      : [];
    // 取り消せる予約のキャンセル料の見込み（確認欄に出す・取消時に同じ額かを確かめる）と、
    // 添付ファイル（2026-10-07・PARTNER_BOOKING_ATTACHMENTS が on のときだけ。一覧の全予約ぶんを1回で引く）は並べて読む。どちらも読めなくても一覧は出す
    const [previews, attMap] = await Promise.all([
      previewPartnerCancels(
        db,
        partner.facility_id,
        rows.filter((b) => b.status === 'confirmed' && canPartnerCancel(b.check_in_date, settingsOf(b)))
      ).catch(() => ({}) as Awaited<ReturnType<typeof previewPartnerCancels>>),
      attEnabled
        ? listBookingAttachments(db, partner.id, rows.map((b) => b.id)).catch(() => new Map<string, BookingAttachmentRow[]>())
        : Promise.resolve(new Map<string, BookingAttachmentRow[]>())
    ]);
    const attachmentsOf = (b: (typeof rows)[number]) => {
      if (!attEnabled) return null;
      const policy = bookingAttachmentPolicy(b);
      const target = { bookingId: b.id };
      return {
        items: (attMap.get(b.id) ?? []).map((r) => portalAttachmentView(event.params.token, target, r, session, policy.canDelete)),
        // 確認モードは見るだけ（ドロップ枠を出さない。API も 403）
        canAdd: policy.canAdd && !session.preview,
        note: session.preview ? '管理者の確認モードのため、添付ファイルは追加・削除できません。' : policy.note
      };
    };
    return {
      error: null as string | null,
      multiFacility,
      facilityFilter,
      bookings: rows.map((b) => ({
        id: b.id,
        // 予約の施設（施設の列・絞り込み。取消・支払・添付はサーバで予約の施設に合成し直して動く）
        facilityId: b.facility_id,
        facilityName: partnerFacilityName(partner, b.facility_id),
        cancelText: cancelTextOf(b),
        code: b.booking_code,
        status: b.status,
        checkedIn: !!b.checkedIn,
        canCancel: b.status === 'pending_payment' || (b.status === 'confirmed' && !b.checkedIn && canPartnerCancel(b.check_in_date, settingsOf(b))),
        paymentStatus: b.payment_status,
        paymentOption: b.payment_option,
        cardLabel: b.card_label,
        chargeError: b.charge_error,
        canUpdateCard: canUpdateCard(b),
        // 支払の再開・カード登録のときの決済部品の種類（予約時決済 = payment / チェックアウト日決済 = setup）
        payMode:
          b.payment_option === 'online_checkin'
            ? ('setup' as const)
            : b.payment_option === 'online' || b.payment_option === 'deposit_online'
              ? ('payment' as const)
              : null,
        // 支払の再開で払う額（デポジットはデポジットの額・Phase 3b）
        payAmount: intentAmountOf(b),
        // デポジット予約: 「デポジット ○円 お支払い済み・残額 ○円（請求書／現地）」（支払後だけ）
        depositText: depositSummary(b),
        isDeposit: b.payment_option === 'deposit_online',
        // カード登録の同意文（入力欄の直下に出し、登録完了時に同じ文面を記録する）
        consentText: b.payment_option === 'online_checkin' ? cardConsentText(partnerFacilityName(partner, b.facility_id), b) : null,
        paymentExpiresAt: b.payment_expires_at,
        paidAmount: b.paid_amount,
        checkIn: b.check_in_date,
        checkOut: b.check_out_date,
        nights: b.nights,
        roomName: b.room_name ?? b.room_code ?? '',
        roomCount: b.room_count,
        // 取引先向けのプラン名（予約時点）。無い予約は元の名前から既定の表示名
        planName: bookingPlanName(b),
        mealType: b.meal_type,
        rooms: (b.detail.rooms ?? []).map((r) => r.adults),
        adultTotal: b.adult_total,
        guestName: b.guest_name,
        guestKana: b.guest_kana,
        // 旅行会社名義（Phase 2）の予約だけ「ご予約名義」の中身（予約時の紐づけ先の正式名称＋お部屋の宿泊者名）。それ以外は null
        nameHolder: b.name_mode === 'partner' ? bookingNameHolderText(b.name_holder || b.partner_name, b.guest_name) || null : null,
        // 予約時に受付枠（与信）を超えていた予約（Phase 3a・取引先にも見せる＝決定 #3）
        creditOver: isCreditOver(b.credit_result),
        phone: b.guest_phone,
        email: b.guest_email,
        address: [b.detail.guest?.zip_code, b.detail.guest?.address].filter(Boolean).join(' '),
        allergies: b.detail.guest?.allergies ?? '',
        arrival: b.detail.arrival ?? '',
        // 予約者（ご担当者）・交通手段・取引先特典（2026-10-01〜の予約だけ。無ければ画面に出さない）
        ...readBookingExtras(b.detail),
        // 入力項目の一覧（旧形式の「予約時決済割引」の行は料金の明細へ、予約者・交通手段・特典の行は上の項目へ移すので外す）
        options: splitExtraOptions(b.detail).filter((o) => o.label !== PREPAY_DISCOUNT_LABEL),
        ...priceOf(b),
        notes: b.detail.notes ?? '',
        paymentMethodName: b.payment_method_name,
        bookedBy: b.booked_by,
        createdAt: b.created_at,
        cancelledAt: b.cancelled_at,
        cancelledBy: b.cancelled_by,
        refundAmount: b.refund_amount ?? null,
        // 添付ファイル（2026-10-07）: 一覧・追加できるか・追加できない理由。機能が off なら null
        attachments: attachmentsOf(b),
        cancelPreview: previews[b.id] ?? null,
        // 取消済みのキャンセル料（精算の方法と一緒に出す）
        cancelFee:
          b.status === 'cancelled' && b.cancel_fee_settlement
            ? {
                fee: b.cancel_fee ?? 0,
                waived: !!b.cancel_fee_waived,
                basis: cancelFeeBasisLabel(b),
                settlement: cancelFeeSettlementLabel(b).replace(/^→ /, ''),
                kept: cancelKeptNote(b)
              }
            : null
      }))
    };
  })();
  const list = listLoad.catch(
    (): Awaited<typeof listLoad> => ({
      error: '予約一覧を読み込めませんでした。時間をおいて開き直してください。',
      multiFacility: false,
      facilityFilter: [],
      bookings: []
    })
  );
  return {
    // 添付ファイルの欄の設定（off なら null・画面に出さない）
    attachmentConfig: attEnabled ? { accept: PARTNER_ATTACHMENT_ACCEPT, hint: PARTNER_ATTACHMENT_HINT } : null,
    portal: portalHeader(partner, session),
    done: q.get('done'),
    payment,
    // 同じ画面で払う決済部品（支払の再開・カードの登録し直し）に渡す公開可能キー。オンライン決済を出せないときは null
    stripeKey: stripePublishableKey(),
    // 本人確認（aal2）が済んでいるか。カードの登録し直しは本人確認が要る（docs/auth-hardening.md §5.2・S4）
    aal2: portalAal2(session),
    list
  };
};

const PREPAY_DISCOUNT_LABEL = '予約時決済割引';
// 料金の明細: 宿泊料金（割引前）・予約時決済割引・入湯税・合計（請求額）。
// 2026-09-26 以降の予約は割引を prepay_discount_amount に持ち total_amount は割引前。
// それより前の予約は total_amount が割引後で、割引は入力項目（'2%引き（-2,304円）'）にだけ残っているので、そこから戻す。
function priceOf(b: {
  total_amount: number;
  bath_tax_amount: number | null;
  prepay_discount_amount?: number | null;
  detail: { options?: { label: string; value: string }[] };
}) {
  const bathTax = b.bath_tax_amount ?? 0;
  const o = (b.detail.options ?? []).find((x) => x.label === PREPAY_DISCOUNT_LABEL);
  const label = o ? o.value.replace(/[（(].*$/, '').trim() : '';
  const stored = b.prepay_discount_amount ?? 0;
  if (stored > 0) return { lodging: b.total_amount, discount: stored, discountLabel: label, bathTax, total: b.total_amount + bathTax - stored };
  const m = o?.value.match(/-([\d,]+)円/);
  const legacy = m ? Number(m[1].replace(/,/g, '')) : 0;
  return { lodging: b.total_amount + legacy, discount: legacy, discountLabel: label, bathTax, total: b.total_amount + bathTax };
}

export const actions = {
  cancel: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const fd = await event.request.formData();
    try {
      const b = await cancelPartnerBooking(db, partner, String(fd.get('id') ?? ''), 'partner', {
        reason: String(fd.get('reason') ?? ''),
        // 確認欄で見せたキャンセル料（日をまたいで変わっていたら取り消さない）
        expectedFee: fd.get('expectedFee') == null || fd.get('expectedFee') === '' ? null : Number(fd.get('expectedFee')),
        accountId: session.id,
        ip: requestMeta(event).ip,
        origin: event.url.origin
      });
      return { cancelled: b.booking_code };
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(400, { message: e.message });
      throw e;
    }
  }
};
