import { fail, redirect } from '@sveltejs/kit';
import { canBookFor, describeDeadline, partnerPlanName, isStripePaymentOption, normalizeBooker, PARTNER_TRANSPORT_OPTIONS, partnerPaymentChoices, paymentOptionLabel, perksForPlan } from '$lib/partner-booking';
import { availablePaymentOptions, createPartnerBooking, isPartnerBookingOpen, quotePartnerBooking } from '$lib/server/partners/booking';
import { parseBookingForm } from '$lib/server/partners/booking-form';
import { getBookerProfile, PartnerStoreError, todayJst } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import { stripePublishableKey } from '$lib/server/stripe';
import { isBillablePaymentOption } from '$lib/partner-invoice';
import { partnerBackTarget } from '$lib/partner-stay';
import { loadPartnerContents } from '$lib/server/partners/contents';
import { buildPlanTerms, type PlanTerms } from '$lib/partner-plan-terms';
import { sbFacilityByUuid } from '$lib/server/supabase-data';
import { loadBookingNote } from '$lib/server/booking-notes';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  const token = event.params.token;
  if (!isPartnerBookingOpen(partner)) throw redirect(303, `/p/${token}/calendar`);

  const q = event.url.searchParams;
  const roomCode = q.get('room') ?? '';
  const planCode = q.get('plan') ?? '';
  const planName = q.get('name') ?? '';
  const checkIn = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '') ? (q.get('date') as string) : todayJst();
  const guests = Math.min(20, Math.max(1, Math.round(Number(q.get('guests') ?? 2)) || 2));
  if (!roomCode || !planCode) throw redirect(303, `/p/${token}/calendar`);

  const s = partner.booking_settings;
  // カレンダーで選んだ泊数（無ければ1泊・上限は取引先ごとの最大泊数）
  const nights = Math.min(s.maxNights, Math.max(1, Math.round(Number(q.get('nights') ?? 1)) || 1));
  // 料金カレンダーで選んだ室数（同じ部屋タイプを N 室・各室とも guests 名）
  const roomCount = Math.min(s.maxRooms, Math.max(1, Math.round(Number(q.get('rooms') ?? 1)) || 1));
  const [quote, rt, booker, profileRow, contents, terms, facility, bookingNote] = await Promise.all([
    quotePartnerBooking(db, partner, { roomCode, planCode, planName, checkIn, nights, rooms: Array.from({ length: roomCount }, () => ({ adults: guests })) }),
    db.schema('pms').from('room_types').select('capacity_min, capacity_max').eq('facility_id', partner.facility_id).eq('code', roomCode).maybeSingle(),
    // 予約者の既定値（マイページの設定。未設定ならアカウントの表示名・メール）
    getBookerProfile(db, partner.id, session.id).catch(() => null),
    // マイページで設定済みか（未設定なら「マイページで設定しておくと…」の案内を出す）
    db.from('rms_partner_accounts').select('booker_profile').eq('id', session.id).eq('partner_id', partner.id).maybeSingle(),
    // 右欄の写真（お部屋の紹介の1枚目）。読めなくても予約はできる
    loadPartnerContents(db, partner).catch(() => null),
    // 左カラムのキャンセルポリシー・お子様（料金カレンダー・プランのご紹介と同じ取得口）
    db
      .rpc('rms_partner_plan_terms', { p_facility: partner.facility_id })
      .then(({ data: t, error: e }) => (e ? new Map<string, PlanTerms>() : buildPlanTerms(t)), () => new Map<string, PlanTerms>()),
    // 右欄の所在地・注意事項のチェックイン／アウト
    sbFacilityByUuid(partner.facility_id).catch(() => undefined),
    // 左カラムの注意事項（施設のマスタ。管理画面「予約時の注意事項」）
    loadBookingNote(partner.facility_id)
  ]);
  const roomContent = contents?.rooms.find((r) => r.code === roomCode);
  const planContent = contents?.plans.find((p) => p.planCode === planCode && p.planLabel === planName);
  const saved = normalizeBooker(profileRow.data?.booker_profile);
  const payIds = availablePaymentOptions(partner);

  return {
    portal: portalHeader(partner, session),
    // displayName: 取引先向けのプラン名（画面表示用。予約の照合・PMS には元の planName を使う）
    target: { roomCode, planCode, planName, displayName: partnerPlanName(s.planNames, planCode, planName), checkIn, guests, nights, roomCount },
    // 右欄の見出し（一休の形: 写真・施設名・所在地）と左カラムのキャンセルポリシー・注意事項
    summary: {
      photo: roomContent?.photos[0]?.url ?? planContent?.photos[0]?.url ?? null,
      facilityName: partner.facility_name,
      area: facility ? [facility.prefecture, facility.addressPublic].filter(Boolean).join(' ') : '',
      checkinTime: facility?.checkinTime ?? null,
      checkoutTime: facility?.checkoutTime ?? null
    },
    terms: terms.get(`${planCode}■${planName}`) ?? null,
    bookingNote,
    // 「戻る」は来たページ（料金カレンダー／プランのご紹介）へ。決め打ちで料金カレンダーに戻さない
    back: partnerBackTarget(token, q.get('from')),
    quote,
    canBook: canBookFor(checkIn, s),
    deadlineText: describeDeadline(s.leadDays, s.cutoffHour),
    cancelText: s.cancelDays == null ? null : describeDeadline(s.cancelDays, s.cutoffHour),
    capacity: { min: Number(rt.data?.capacity_min ?? 1) || 1, max: Number(rt.data?.capacity_max ?? 6) || 6 },
    settings: { maxRooms: s.maxRooms, maxNights: s.maxNights, notice: s.notice, options: s.options },
    // 固定の3種＋自由入力の支払方法のうち、許可されていていま使えるもの（表示名は設定の名前）
    // billable: 請求書払い（宿泊料金・入湯税は取引先へ請求し、ご宿泊者様には請求しない）
    paymentOptions: partnerPaymentChoices(s)
      .filter((o) => payIds.includes(o.id))
      .map((o) => ({ id: o.id, label: paymentOptionLabel(o.id, s), note: o.note, billable: isBillablePaymentOption(o.id, s) })),
    booker: booker ?? normalizeBooker(null),
    bookerSaved: !!(saved.name && saved.email),
    transportOptions: PARTNER_TRANSPORT_OPTIONS,
    // このプランに付く取引先特典（予約画面は1プラン固定。確定時にサーバで同じ規則で付け直す）
    perks: perksForPlan(s.perks, planCode).map((p) => ({ id: p.id, title: p.title, description: p.description, imageUrl: p.imageUrl })),
    // 同じ画面で払う決済部品に渡す公開可能キー（オンライン決済を出せないときは null）
    stripeKey: payIds.some(isStripePaymentOption) ? stripePublishableKey() : null
  };
};

// 後払い（銀行振込等）・自由入力の支払方法（決済なし）の確定。オンライン決済は同じ画面で払うため /book/reserve（API）から確定する。
export const actions = {
  default: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    const input = parseBookingForm(await event.request.formData(), partner.booking_settings.options.map((o) => o.id));
    // 支払方法が1つだけならそれに決まる（createPartnerBooking と同じ規則）
    const payIds = availablePaymentOptions(partner);
    const option = payIds.length === 1 ? payIds[0] : input.paymentOption;
    if (isStripePaymentOption(option)) return fail(400, { message: 'お支払い情報を入力してから予約してください。' });
    try {
      const created = await createPartnerBooking(db, partner, { id: session.id, login_id: session.login_id }, input, {
        ip: requestMeta(event).ip,
        origin: event.url.origin
      });
      throw redirect(303, `/p/${event.params.token}/bookings?done=${encodeURIComponent(created.bookingCode)}`);
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 600 ? e.status : 400, { message: e.message });
      throw e;
    }
  }
};
