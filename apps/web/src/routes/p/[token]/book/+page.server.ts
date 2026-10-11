import { fail, redirect } from '@sveltejs/kit';
import { canBookFor, describeDeadline, partnerPlanName, isStripePaymentOption, normalizeBooker, PARTNER_TRANSPORT_OPTIONS, partnerPaymentChoices, paymentOptionLabel, perksForPlan } from '$lib/partner-booking';
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
import type { RequestEvent } from '@sveltejs/kit';
import {
  CANCEL_POLICY_LABELS,
  earnEstimateOf,
  isMemberPage,
  memberBenefitLines,
  memberMaxRooms,
  memberPageBookingOpen,
  perksSnapshotOf,
  type MemberHoldRoom
} from '$lib/partner-member-page';
import { loadMemberPagePlans, memberHoldBack, memberPageHold, memberPlanKey } from '$lib/server/partners/member-hold';
import { HOLD_NAV_COOKIE } from '$lib/booking-nav';
import { holdRateCheck } from '$lib/server/hold-rate-limit';
import { bookingSessionId } from '$lib/server/supabase-data';
import { logPartnerAccess, type PartnerContext, type PartnerSessionAccount } from '$lib/server/partners/store';
import { deferTask, portalLogActor } from '$lib/server/partners/portal';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---- 特別会員の専用ページ（kind='member'・docs/vip-member-page.md §13.4.3・§14） ----
// 確認画面（GET）: 部屋ごとの専用料金・このプランの専用特典・会員特典・獲得予定ポイントの目安・キャンセル方式と「予約へ進む」だけ。
// 宿泊者・支払・ポイントの入力は公式の予約確認（/booking/hold）に任せる。
async function memberBookLoad(
  event: RequestEvent<{ token: string }>,
  ctx: { db: SupabaseClient; partner: PartnerContext; session: PartnerSessionAccount }
) {
  const { db, partner, session } = ctx;
  const token = event.params.token;
  if (!memberPageBookingOpen(partner)) throw redirect(303, `/p/${token}/calendar`);
  const q = event.url.searchParams;
  const roomCode = q.get('room') ?? '';
  const planCode = q.get('plan') ?? '';
  const planName = q.get('name') ?? '';
  if (!roomCode || !planCode) throw redirect(303, `/p/${token}/calendar`);
  const s = partner.booking_settings;
  const checkIn = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '') ? (q.get('date') as string) : todayJst();
  const guests = Math.min(6, Math.max(1, Math.round(Number(q.get('guests') ?? 2)) || 2));
  const nights = Math.min(s.maxNights, Math.max(1, Math.round(Number(q.get('nights') ?? 1)) || 1));
  const roomCount = Math.min(memberMaxRooms(s), Math.max(1, Math.round(Number(q.get('rooms') ?? 1)) || 1));
  const holdRooms: MemberHoldRoom[] = Array.from({ length: roomCount }, () => ({ roomCode, planCode, planName, adults: guests }));
  const [quote, plans, contents] = await Promise.all([
    quotePartnerBooking(db, partner, { roomCode, planCode, planName, checkIn, nights, rooms: holdRooms.map((r) => ({ adults: r.adults })) }, { credit: false }),
    loadMemberPagePlans(db, partner.facility_id).catch(() => new Map()),
    loadPartnerContents(db, partner).catch(() => null)
  ]);
  const plan = plans.get(memberPlanKey(planCode, planName)) ?? null;
  const total = quote.ok ? quote.total : 0;
  const roomContent = contents?.rooms.find((r) => r.code === roomCode);
  deferTask(
    event,
    logPartnerAccess(db, {
      partnerId: partner.id,
      ...portalLogActor(session, { page: 'book', roomCode, planCode, date: checkIn, nights, rooms: roomCount }),
      channel: 'web',
      action: 'view',
      ip: requestMeta(event).ip
    })
  );
  return {
    portal: portalHeader(partner, session),
    // 予約の施設（フォームの hidden facility_id）
    facilityId: partner.facility_id,
    target: { roomCode, planCode, planName, displayName: partnerPlanName(s.planNames, planCode, planName), checkIn, guests, nights, roomCount },
    photo: roomContent?.photos[0]?.url ?? null,
    // 専用料金（部屋ごとの泊明細 quote.rooms[i].nights・合計・入湯税）。取引先の予約時決済割（quote.prepay）は使わない（公式の早期決済割が付く・Q3）
    quote,
    // このプランに付く専用特典（1 段目）
    perks: perksSnapshotOf(s.perks, planCode) ?? [],
    // 会員特典（2 段目・還元率・キャンセル方式・ポイント利用可）。確認モードは null
    memberBenefits: session.member ? memberBenefitLines(session.member.rankLabel, session.member.rewardRate, s.cancelPolicyMode) : null,
    // 獲得予定ポイントの目安（専用料金の合計 × 還元率。ポイント利用・割引の前）
    earnEstimate: session.member ? earnEstimateOf(total, session.member.rewardRate) : 0,
    cancelMode: { mode: s.cancelPolicyMode, label: CANCEL_POLICY_LABELS[s.cancelPolicyMode], rules: s.cancelPolicyMode === 'rank' ? null : s.cancelRules },
    // このプランの支払方法（会員）。公式サイトで公開していないプランは null（予約へ進めない・Q1）
    pay: plan?.pay ?? null,
    canBook: quote.ok && !!plan && canBookFor(checkIn, s) && !session.preview,
    deadlineText: describeDeadline(s.leadDays, s.cutoffHour),
    back: partnerBackTarget(token, q.get('from')),
    // 「予約へ進む」のフォームの hidden rooms（JSON）の元
    holdRooms
  };
}

/** 専用ページの確認画面の data.member（docs/vip-member-page.md §14） */
export type MemberBookData = Awaited<ReturnType<typeof memberBookLoad>>;

// 専用ページの「予約へ進む」（POST・default）: 仮押さえ → 公式の予約確認へ
async function memberBookHold(
  event: RequestEvent<{ token: string }>,
  ctx: { db: SupabaseClient; partner: PartnerContext; session: PartnerSessionAccount }
) {
  const fd = await event.request.formData();
  const ip = event.request.headers.get('cf-connecting-ip') ?? requestMeta(event).ip ?? 'unknown';
  // 接続元ごとの回数制限（公式と同じ KV hold:<ip>）。DB 側にも同じ上限がある（束で数える・公式と共用）
  if (!(await holdRateCheck(event.platform, ip))) {
    return fail(429, { message: 'お申し込みが集中しています。しばらく時間をおいてからお試しください。', code: 'rate_limited' as const });
  }
  let partner: PartnerContext;
  try {
    partner = await portalFacilityContext(ctx.db, ctx.partner, String(fd.get('facility_id') ?? ''));
  } catch (e) {
    if (e instanceof PartnerStoreError) return fail(409, { message: e.message, code: 'invalid' as const });
    throw e;
  }
  const res = await memberPageHold({ db: ctx.db, partner, session: ctx.session, fd, sessionId: bookingSessionId(event.cookies), clientKey: ip });
  if (!res.ok) return fail(res.status, { message: res.message, code: res.code, ...(res.soldOut ? { soldOut: res.soldOut } : {}) });
  const back = memberHoldBack(event.params.token, partner, res.checkIn, res.nights, res.rooms);
  event.cookies.set(HOLD_NAV_COOKIE, JSON.stringify({ id: res.groupId, back, via: '' }), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 2
  });
  deferTask(
    event,
    logPartnerAccess(ctx.db, {
      partnerId: partner.id,
      ...portalLogActor(ctx.session, { group_id: res.groupId, date: res.checkIn, nights: res.nights, rooms: res.rooms.length }),
      channel: 'web',
      action: 'member_hold',
      ip
    })
  );
  throw redirect(303, `/booking/hold?id=${res.groupId}`);
}

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  const token = event.params.token;
  // 特別会員の専用ページ: data は { portal, member }（取引先の項目は無い）。画面は data.portal.kind === 'member' で
  // data.member だけを使う（型は取引先の形のまま・member は MemberBookData | null。docs/vip-member-page.md §14）
  if (isMemberPage(partner.kind)) {
    const member = await memberBookLoad(event, { db, partner, session });
    return { portal: member.portal, member } as never;
  }
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
  const [quote, rt, booker, profileRow, contents, terms, facility, bookingNote, bookingForm, standardFields, nameHolder, adminFeePercent] = await Promise.all([
    quotePartnerBooking(db, partner, { roomCode, planCode, planName, checkIn, nights, rooms: Array.from({ length: roomCount }, () => ({ adults: guests })) }, { credit: true }),
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
    // 特別会員の専用ページの確認画面（取引先は null）
    member: null as MemberBookData | null,
    // displayName: 取引先向けのプラン名（画面表示用。予約の照合・PMS には元の planName を使う）
    target: { roomCode, planCode, planName, displayName: partnerPlanName(s.planNames, planCode, planName), checkIn, guests, nights, roomCount },
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
    capacity: { min: Number(rt.data?.capacity_min ?? 1) || 1, max: Number(rt.data?.capacity_max ?? 6) || 6 },
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
    transportOptions: PARTNER_TRANSPORT_OPTIONS,
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
    // 特別会員の専用ページ: 仮押さえ → 公式の予約確認（/booking/hold）へ（取引先予約の確定はしない）
    if (isMemberPage(selected.kind)) return memberBookHold(event, { db, partner: selected, session });
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
        origin: event.url.origin
      });
      throw redirect(303, `/p/${event.params.token}/bookings?done=${encodeURIComponent(created.bookingCode)}`);
    } catch (e) {
      if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 600 ? e.status : 400, { message: e.message });
      throw e;
    }
  }
};
