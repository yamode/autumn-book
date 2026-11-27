import { fail, redirect } from '@sveltejs/kit';
import { canBookFor, describeDeadline, partnerPlanName, isStripePaymentOption, normalizeBooker, partnerPaymentChoices, paymentOptionLabel, perksForPlan } from '$lib/partner-booking';
import { availablePaymentOptions, createPartnerBooking, creditOverPaymentOptions, isPartnerBookingOpen, quotePartnerBooking, resolvePaymentOption } from '$lib/server/partners/booking';
import { parseBookingForm } from '$lib/server/partners/booking-form';
import { getBookerProfile, getPmsPartnerGuest, PartnerStoreError, todayJst } from '$lib/server/partners/store';
import { portalFacilityContext, portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';
import { stripePublishableKey } from '$lib/server/stripe';
import { isBillablePaymentOption } from '$lib/partner-invoice';
import { partnerBackTarget } from '$lib/partner-stay';
import { loadPartnerContents } from '$lib/server/partners/contents';
import { buildPlanTerms, type PlanTerms } from '$lib/partner-plan-terms';
import { planCancelPolicy } from '$lib/partner-cancel-fee';
import { sbFacilityByUuid } from '$lib/server/supabase-data';
import { loadBookingNote } from '$lib/server/booking-notes';
import { loadStandardFieldTexts, partnerBookingForm } from '$lib/server/booking-questions';
import { loadCancelAdminFeePercent } from '$lib/server/payment-settings';
import { listStagedAttachments, partnerBookingAttachmentsEnabled } from '$lib/server/partners/booking-attachments';
import { portalAttachmentView } from '$lib/server/partners/portal-attachments';
import { PARTNER_ATTACHMENT_ACCEPT, PARTNER_ATTACHMENT_HINT } from '$lib/partner-attachments';
import { isMemberPage, memberBookRedirect } from '$lib/partner-member-page';
import { waitUntilOf } from '$lib/server/access-log-core';

// ---- 特別会員の専用ページ（kind='member'） ----
// 会員さまの予約は公式サイトのプライベートブック（プラン詳細の ?/hold）で作る（v0.355.0）。B面の会員はここへ来ない
// （resolvePortal が GET を /private-book へ転送し、POST は 410）。来るのは管理者の確認モードだけで、
// GET は料金カレンダーのプラン詳細へ戻し（memberBookRedirect）、POST は確認モードの関所（requirePortalSession）が断る。

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  const token = event.params.token;
  // 特別会員の専用ページ: 確認画面は無い（2026-11-27〜）。料金カレンダーのプラン詳細へ戻す（memberBookRedirect）
  if (isMemberPage(partner.kind)) throw redirect(303, memberBookRedirect(token, event.url.searchParams));
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
  // 複数部屋タイプの予約（mix=部屋タイプのコードをカンマ区切りで部屋の順に・同じプランの部屋タイプ違い）。室数と合わなければ同じ部屋タイプ N 室
  const mixCodes = (q.get('mix') ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const roomCodes = mixCodes.length >= 2 && mixCodes.length <= s.maxRooms ? mixCodes : Array.from({ length: roomCount }, () => roomCode);
  const roomCountEff = roomCodes.length;
  const [quote, rt, booker, profileRow, contents, terms, facility, bookingNote, bookingForm, standardFields, nameHolder, adminFeePercent] = await Promise.all([
    quotePartnerBooking(db, partner, { roomCode, planCode, planName, checkIn, nights, rooms: roomCodes.map((code) => ({ adults: guests, roomCode: code })) }, { credit: true }),
    db.schema('pms').from('room_types').select('code, name, capacity_min, capacity_max').eq('facility_id', partner.facility_id).in('code', [...new Set(roomCodes)]),
    // 予約者の既定値（マイページの設定。未設定ならアカウントの表示名・メール）
    getBookerProfile(db, partner.id, session.id).catch(() => null),
    // マイページで設定済みか（未設定なら「マイページで設定しておくと…」の案内を出す）
    db.from('rms_partner_accounts').select('booker_profile').eq('id', session.id).eq('partner_id', partner.id).maybeSingle(),
    // 右欄の写真（お部屋の紹介の1枚目）。読めなくても予約はできる
    loadPartnerContents(db, partner).catch(() => null),
    // 左カラムのキャンセルポリシー・お子様（料金カレンダー・プランのご紹介と同じ取得口）
    db
      .rpc('rms_partner_plan_terms', { p_facility: partner.facility_id })
      .then(
        ({ data: t, error: e }) => (e ? { map: new Map<string, PlanTerms>(), raw: null } : { map: buildPlanTerms(t), raw: t as unknown }),
        () => ({ map: new Map<string, PlanTerms>(), raw: null })
      ),
    // 右欄の所在地・注意事項のチェックイン／アウト
    sbFacilityByUuid(partner.facility_id).catch(() => undefined),
    // 左カラムの注意事項（施設のマスタ。管理画面「予約時の注意事項」）
    loadBookingNote(partner.facility_id),
    // 予約時に聞く項目: プランの項目（テンプレート or プラン独自）→ この取引先だけ追加で聞く項目
    partnerBookingForm(db, partner, planCode, planName),
    // 毎回聞く項目（アレルギー・備考）の見出し・例文（施設の設定 → 既定）
    loadStandardFieldTexts(partner.facility_id),
    // 予約名義（Phase 2）: 「旅行会社名で取る」で紐づけ先が読めるときだけ、確認画面に名義の行を出す（RPC と同じ条件）。
    // 読めなければ null（予約は宿泊者名で取られる）
    partner.booking_name_mode === 'partner'
      ? getPmsPartnerGuest(db, partner.tenant_id, partner.pms_guest_id)
          .then((g) => g?.recipientName || null)
          .catch(() => null)
      : Promise.resolve(null),
    // 予約時決済の事務手数料（取消時に返金しない率・施設の設定・2026-10-07）。予約時決済を選んだときに案内する
    loadCancelAdminFeePercent(partner.facility_id)
  ]);
  const roomContent = contents?.rooms.find((r) => r.code === roomCode);
  const planContent = contents?.plans.find((p) => p.planCode === planCode && p.planLabel === planName);
  const saved = normalizeBooker(profileRow.data?.booker_profile);
  const payIds = availablePaymentOptions(partner);

  return {
    portal: portalHeader(partner, session),
    // displayName: 取引先向けのプラン名（画面表示用。予約の照合・PMS には元の planName を使う）
    target: {
      roomCode,
      planCode,
      planName,
      displayName: partnerPlanName(s.planNames, planCode, planName),
      checkIn,
      guests,
      nights,
      roomCount: roomCountEff,
      // 部屋ごとの部屋タイプ（複数部屋タイプのとき。同じ部屋タイプ N 室なら全部同じ値）と、部屋タイプの名前
      roomCodes,
      roomNames: Object.fromEntries((rt.data ?? []).map((r) => [String(r.code), String(r.name ?? r.code)]))
    },
    // 右欄の見出し（一休の形: 写真・施設名・所在地）と左カラムのキャンセルポリシー・注意事項
    summary: {
      photo: roomContent?.photos[0]?.url ?? planContent?.photos[0]?.url ?? null,
      facilityName: partner.facility_name,
      // 公開用の住所が県名から始まるときは住所だけ（「秋田県 秋田県男鹿市…」のように県名が重なるため）
      area: facility ? (facility.addressPublic && facility.prefecture && facility.addressPublic.startsWith(facility.prefecture) ? facility.addressPublic : [facility.prefecture, facility.addressPublic].filter(Boolean).join(' ')) : '',
      checkinTime: facility?.checkinTime ?? null,
      checkoutTime: facility?.checkoutTime ?? null
    },
    terms: terms.map.get(`${planCode}■${planName}`) ?? null,
    // 「◯月◯日までキャンセル料無料」の帯: 最初に料率がかかるのが宿泊日の何日前か（料率の段が無ければ null）
    cancelFeeFromDays: (() => {
      const days = (planCancelPolicy(terms.raw, planCode, planName)?.rules ?? []).filter((r) => r.rate_percent > 0).map((r) => r.days_before);
      return days.length ? Math.max(...days) : null;
    })(),
    cancelDays: s.cancelDays,
    cancelCutoffHour: s.cutoffHour,
    bookingNote,
    // 「戻る」は来たページ（料金カレンダー／プランのご紹介）へ。決め打ちで料金カレンダーに戻さない
    back: partnerBackTarget(token, q.get('from')),
    quote,
    canBook: canBookFor(checkIn, s),
    deadlineText: describeDeadline(s.leadDays, s.cutoffHour),
    cancelText: s.cancelDays == null ? null : describeDeadline(s.cancelDays, s.cutoffHour),
    adminFeePercent,
    // 確認の段の最後に個人情報の同意チェックを出すか（取引先ごとの設定・既定は出す）
    privacyConsent: s.privacyConsent,
    // 1室の人数の選択肢: 複数部屋タイプのときは全部屋タイプで収まる範囲（下限の最大・上限の最小）
    capacity: {
      min: Math.max(1, ...(rt.data ?? []).map((r) => Number(r.capacity_min ?? 1) || 1)),
      max: Math.min(...(rt.data?.length ? rt.data.map((r) => Number(r.capacity_max ?? 6) || 6) : [6]))
    },
    settings: { maxRooms: s.maxRooms, maxNights: s.maxNights, notice: s.notice, options: bookingForm.questions, askGender: bookingForm.askGender },
    standardFields,
    // 予約名義の名義人（紐づけ先の正式名称）。null = 宿泊者名義（行を出さない）
    nameHolder,
    // 固定の3種＋自由入力の支払方法のうち、許可されていていま使えるもの（表示名は設定の名前）
    // billable: 請求書払い（宿泊料金・入湯税は取引先へ請求し、ご宿泊者様には請求しない）
    paymentOptions: partnerPaymentChoices(s)
      .filter((o) => payIds.includes(o.id))
      .map((o) => ({ id: o.id, label: paymentOptionLabel(o.id, s), note: o.note, billable: isBillablePaymentOption(o.id, s) })),
    booker: booker ?? normalizeBooker(null),
    bookerSaved: !!(saved.name && saved.email),
    // このプランに付く取引先特典（予約画面は1プラン固定。確定時にサーバで同じ規則で付け直す）
    perks: perksForPlan(s.perks, planCode).map((p) => ({ id: p.id, title: p.title, description: p.description, imageUrl: p.imageUrl })),
    // 同じ画面で払う決済部品に渡す公開可能キー（オンライン決済を出せないときは null）
    // 受付枠を超えたとき（deposit）は後払いの取引先でも全額の予約時決済・デポジットを出すので、そのときも渡す
    stripeKey: payIds.some(isStripePaymentOption) || creditOverPaymentOptions(partner).length ? stripePublishableKey() : null,
    // 添付ファイル（2026-10-07・PARTNER_BOOKING_ATTACHMENTS が on のときだけ）。1件ずつ仮置きし、確定時に予約へ結ぶ
    // staged: このログインIDの仮置き（24時間以内・予約に結ばれていないもの）。開き直しても欄に出し、消す・そのまま使うができる
    attachments: partnerBookingAttachmentsEnabled()
      ? {
          accept: PARTNER_ATTACHMENT_ACCEPT,
          hint: PARTNER_ATTACHMENT_HINT,
          staged: session.preview
            ? []
            : (await listStagedAttachments(db, partner.id, session.id)).map((r) => portalAttachmentView(token, { stagedFor: session.id }, r, session, true))
        }
      : null
  };
};

// 後払い（銀行振込等）・自由入力の支払方法（決済なし）の確定。オンライン決済は同じ画面で払うため /book/reserve（API）から確定する。
export const actions = {
  default: async (event) => {
    const { db, partner: selected, session } = await requirePortalSession(event);
    // 特別会員の専用ページ（確認モードだけここへ来る・送信は上の関所で断る）: 取引先予約の確定はしない
    if (isMemberPage(selected.kind)) return fail(404, { message: 'ページが見つかりません。' });
    const fd = await event.request.formData();
    const input = parseBookingForm(fd);
    try {
      // 予約する施設はフォームの施設（hidden facility_id・選んでいる施設ではない・§7.8）
      const partner = await portalFacilityContext(db, selected, String(fd.get('facility_id') ?? ''));
      // 支払方法が1つだけならそれに決まる（createPartnerBooking と同じ規則）
      const option = resolvePaymentOption(partner, input.paymentOption)?.option ?? input.paymentOption;
      if (isStripePaymentOption(option)) return fail(400, { message: 'お支払い情報を入力してから予約してください。' });
      const created = await createPartnerBooking(db, partner, { id: session.id, login_id: session.login_id }, input, {
        ip: requestMeta(event).ip,
        origin: event.url.origin,
        // 前受金のご請求書のメール（PDF 生成）は応答の後に回す
        waitUntil: waitUntilOf(event.platform)
      });
      throw redirect(303, `/p/${event.params.token}/bookings?done=${encodeURIComponent(created.bookingCode)}`);
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 600 ? e.status : 400, { message: e.message });
      throw e;
    }
  }
};
