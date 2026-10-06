import { redirect, type RequestEvent } from '@sveltejs/kit';
import { logPartnerAccess, partnerUnavailableReason, todayJst } from '$lib/server/partners/store';
import { loadPartnerContents } from '$lib/server/partners/contents';
import { availablePaymentOptions, isPartnerBookingOpen } from '$lib/server/partners/booking';
import { describeDeadline, partnerPaymentChoices, paymentOptionLabel, perksForPlan } from '$lib/partner-booking';
import { buildPlanTerms, type PlanTerms } from '$lib/partner-plan-terms';
import { portalHeader, PORTAL_HEADERS, requestMeta, resolvePortal } from '$lib/server/partners/portal';
import { sbFacilityByUuid } from '$lib/server/supabase-data';

// 取引先専用ページ: 料金カレンダー（部屋タイプごと）とプランのご紹介（プランごと）で共通の読み込み。
// 最初から全幅カードを並べ（日付前は今後3か月の最安〜）、日程・泊数・人数・室数を選ぶと
// その日程で予約できるプランと料金に切り替える。料金・空室は月の JSON（/calendar/month）を画面側で読む。
export async function loadStayPage(event: Pick<RequestEvent, 'params' | 'cookies' | 'url' | 'setHeaders' | 'request' | 'getClientAddress'>, page: 'calendar' | 'plans') {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await resolvePortal(event);
  const token = event.params.token;
  if (!session) throw redirect(303, `/p/${token}`);
  // 管理画面からの確認モードは公開停止中でも見られる
  if (partnerUnavailableReason(partner) && !session.preview) throw redirect(303, `/p/${token}`);

  const q = event.url.searchParams;
  const s = partner.booking_settings;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get('date') ?? '') ? (q.get('date') as string) : '';
  const nights = Math.min(s.maxNights, Math.max(1, Math.round(Number(q.get('nights') ?? 1)) || 1));
  const guestsRaw = Math.round(Number(q.get('guests') ?? 2));
  const guests = guestsRaw >= 1 && guestsRaw <= 6 ? guestsRaw : 2;
  const rooms = Math.min(s.maxRooms, Math.max(1, Math.round(Number(q.get('rooms') ?? 1)) || 1));

  // キャンセル規定・お子様の区分（プラン詳細のモーダル用。読めなくても一覧は出す）
  const termsPromise = db
    .rpc('rms_partner_plan_terms', { p_facility: partner.facility_id })
    .then(({ data, error: e }) => (e ? new Map<string, PlanTerms>() : buildPlanTerms(data)), () => new Map<string, PlanTerms>());
  const [contents, , facility, terms] = await Promise.all([
    // 写真・紹介（読めなくても一覧は出す）
    loadPartnerContents(db, partner).catch(() => ({ rooms: [], plans: [] })),
    logPartnerAccess(db, {
      partnerId: partner.id,
      accountId: session.id,
      channel: 'web',
      action: 'view',
      detail: { page, date, nights, guests, rooms },
      ip: requestMeta(event).ip
    }),
    // カードの IN / OUT（読めなければ出さない）
    sbFacilityByUuid(partner.facility_id).catch(() => undefined),
    termsPromise
  ]);
  const toPerk = (p: { id: string; title: string; description: string; imageUrl: string }) => ({ id: p.id, title: p.title, description: p.description, imageUrl: p.imageUrl });
  const payIds = availablePaymentOptions(partner);

  return {
    portal: portalHeader(partner, session),
    today: todayJst(),
    params: { date, nights, guests, rooms },
    times: facility ? { checkin: facility.checkinTime, checkout: facility.checkoutTime } : null,
    showInventory: partner.show_inventory,
    planNames: s.planNames,
    booking: { enabled: isPartnerBookingOpen(partner), leadDays: s.leadDays, cutoffHour: s.cutoffHour, maxNights: s.maxNights, maxRooms: s.maxRooms },
    rooms: contents.rooms,
    // プランの紹介（プランのご紹介ページの位置へのリンク用）
    planAnchors: contents.plans.map((p) => ({ planCode: p.planCode, planLabel: p.planLabel, anchor: p.anchor })),
    // 専用特典の付くプラン（「専用特典」のしるし用。全プラン対象の特典があれば全部に付く）
    perkPlanCodes: [...new Set(s.perks.flatMap((p) => p.planCodes))],
    commonPerk: s.perks.some((p) => !p.planCodes.length),
    // ---- プラン詳細のモーダル用 ----
    // プランの紹介（写真・説明・仕様・お料理など）。キーは planCode■planLabel（料金カレンダーの planName）
    planContents: contents.plans,
    // キャンセルポリシー・お子様（同じキー）
    planTerms: Object.fromEntries(terms),
    // プランごとの専用特典（全プラン対象を含む）
    planPerks: Object.fromEntries(
      [...new Set(contents.plans.map((p) => p.planCode))].map((code) => [code, perksForPlan(s.perks, code).map(toPerk)])
    ),
    commonPerks: s.perks.filter((p) => !p.planCodes.length).map(toPerk),
    // 予約受付の締切・取消の期限・使える支払方法（表示用。確定時にサーバで再確認する）
    deadlineText: describeDeadline(s.leadDays, s.cutoffHour),
    cancelText: s.cancelDays == null ? null : describeDeadline(s.cancelDays, s.cutoffHour),
    paymentLabels: partnerPaymentChoices(s).filter((o) => payIds.includes(o.id)).map((o) => paymentOptionLabel(o.id, s))
  };
}

export type StayPageData = Awaited<ReturnType<typeof loadStayPage>>;
