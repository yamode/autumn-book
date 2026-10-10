import { redirect, type RequestEvent } from '@sveltejs/kit';
import { logPartnerAccess, partnerCreditCheck, partnerUnavailableReason, todayJst } from '$lib/server/partners/store';
import { showsCredit, stayMonths } from '$lib/partner-credit';
import { loadPartnerContents } from '$lib/server/partners/contents';
import { availablePaymentOptions, isPartnerBookingOpen } from '$lib/server/partners/booking';
import { describeDeadline, partnerPaymentChoices, paymentOptionLabel, perksForPlan } from '$lib/partner-booking';
import { buildPlanTerms, type PlanTerms } from '$lib/partner-plan-terms';
import { deferTask, portalHeader, PORTAL_HEADERS, requestMeta, resolvePortal } from '$lib/server/partners/portal';
import { sbFacilityByUuid } from '$lib/server/supabase-data';
import { loadPortalReference } from '$lib/server/partners/portal-reference';

// 取引先専用ページ: 料金カレンダー（部屋タイプごと）とプランのご紹介（プランごと）で共通の読み込み。
// 最初から全幅カードを並べ（日付前は今後3か月の最安〜）、日程・泊数・人数・室数を選ぶと
// その日程で予約できるプランと料金に切り替える。料金・空室は月の JSON（/calendar/month）を画面側で読む。
//
// 読み込みの分け方（2026-10-10・メニュー切替を軽くする）:
//   待つ … 認証・リダイレクト・ヘッダー（portal）・検索条件（params）・予約受付の設定など、検索バーと一覧の骨組みに要るもの
//   後から流す（stay: Promise）… 写真・紹介（loadPartnerContents）・キャンセル規定・受付枠（与信）・施設の IN/OUT。
//     画面（PartnerStaySearch）は届くまでカードの枠を出す。どれも読めなくても一覧は出す（Promise は失敗しない）
//   アクセスログは応答を待たせない（waitUntil）
export async function loadStayPage(
  event: Pick<RequestEvent, 'params' | 'cookies' | 'url' | 'setHeaders' | 'request' | 'getClientAddress'> & { platform?: App.Platform },
  page: 'calendar' | 'plans'
) {
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

  deferTask(
    event,
    logPartnerAccess(db, {
      partnerId: partner.id,
      accountId: session.id,
      channel: 'web',
      action: 'view',
      detail: { page, date, nights, guests, rooms },
      ip: requestMeta(event).ip
    })
  );

  // キャンセル規定・お子様の区分（プラン詳細のモーダル用。読めなくても一覧は出す）
  const termsPromise = db
    .rpc('rms_partner_plan_terms', { p_facility: partner.facility_id })
    .then(({ data, error: e }) => (e ? new Map<string, PlanTerms>() : buildPlanTerms(data)), () => new Map<string, PlanTerms>());
  // 御社の受付枠（与信・Phase 3a）: 紐づけ先が与信 ON の旅行会社のときだけ。表示中の日程が触る月（日程なしは今月）を
  // ページの読み込みごとに1回だけ読む（RPC の呼び出しを抑える）。読めなくても一覧は出す
  const creditMonths = date ? stayMonths(date, nights) : [todayJst().slice(0, 7)];
  const creditPromise =
    partner.pms_guest_id && showsCredit(partner.credit_over_action)
      ? partnerCreditCheck(db, partner, creditMonths).catch(() => null)
      : Promise.resolve(null);
  const toPerk = (p: { id: string; title: string; description: string; imageUrl: string }) => ({ id: p.id, title: p.title, description: p.description, imageUrl: p.imageUrl });
  const payIds = availablePaymentOptions(partner);

  // 一覧に後から足すもの（写真・紹介・規定・受付枠・IN/OUT）。失敗しない Promise にして画面へ流す
  const stayLoad = Promise.all([
    // 写真・紹介（読めなくても一覧は出す）。オンの施設が無い取引先（N9）は出さない（ヘッダーの下に案内）
    partner.facility_available ? loadPartnerContents(db, partner).catch(() => ({ rooms: [], plans: [] })) : Promise.resolve({ rooms: [], plans: [] }),
    // カードの IN / OUT（読めなければ出さない）
    sbFacilityByUuid(partner.facility_id).catch(() => undefined),
    termsPromise,
    creditPromise
  ])
    .then(([contents, facility, terms, credit]) => ({
      times: facility ? { checkin: facility.checkinTime, checkout: facility.checkoutTime } : null,
      // 受付枠（月別の延べ室数・N5）。与信 ON の旅行会社でなければ null（見出しの脇に何も出さない）
      credit: credit?.enabled ? { months: credit.months.map((m) => ({ month: m.month, limit: m.limit, booked: m.booked })) } : null,
      rooms: contents.rooms,
      // プランの紹介（プランのご紹介ページの位置へのリンク用）
      planAnchors: contents.plans.map((p) => ({ planCode: p.planCode, planLabel: p.planLabel, anchor: p.anchor })),
      // ---- プラン詳細のモーダル用 ----
      // プランの紹介（写真・説明・仕様・お料理など）。キーは planCode■planLabel（料金カレンダーの planName）
      planContents: contents.plans,
      // キャンセルポリシー・お子様（同じキー）
      planTerms: Object.fromEntries(terms),
      // プランごとの専用特典（全プラン対象を含む）
      planPerks: Object.fromEntries(
        [...new Set(contents.plans.map((p) => p.planCode))].map((code) => [code, perksForPlan(s.perks, code).map(toPerk)])
      )
    }));
  // 日付を選ぶ前の「今後3か月の最安」（部屋 × プランごと）。ページの読み込みと同時に始めて後から流す（portal-reference.ts）。
  // 日程ありの料金は今までどおり画面が月の JSON を読む。失敗は ok: false で返し、画面がお知らせを出す
  const reference = date
    ? null
    : loadPortalReference(event, db, partner, guests, todayJst()).then(
        (plans) => ({ ok: true as const, plans }),
        () => ({ ok: false as const, plans: [] })
      );
  // 読めなかったときは一覧を料金だけで出す（画面へ流す Promise は失敗させない）
  const stay = stayLoad.catch(
    (): Awaited<typeof stayLoad> => ({ times: null, credit: null, rooms: [], planAnchors: [], planContents: [], planTerms: {}, planPerks: {} })
  );

  return {
    portal: portalHeader(partner, session),
    today: todayJst(),
    params: { date, nights, guests, rooms },
    showInventory: partner.show_inventory,
    planNames: s.planNames,
    booking: { enabled: isPartnerBookingOpen(partner), leadDays: s.leadDays, cutoffHour: s.cutoffHour, maxNights: s.maxNights, maxRooms: s.maxRooms },
    // 専用特典の付くプラン（「専用特典」のしるし用。全プラン対象の特典があれば全部に付く）
    perkPlanCodes: [...new Set(s.perks.flatMap((p) => p.planCodes))],
    commonPerk: s.perks.some((p) => !p.planCodes.length),
    commonPerks: s.perks.filter((p) => !p.planCodes.length).map(toPerk),
    // 予約受付の締切・取消の期限・使える支払方法（表示用。確定時にサーバで再確認する）
    deadlineText: describeDeadline(s.leadDays, s.cutoffHour),
    cancelText: s.cancelDays == null ? null : describeDeadline(s.cancelDays, s.cutoffHour),
    paymentLabels: partnerPaymentChoices(s).filter((o) => payIds.includes(o.id)).map((o) => paymentOptionLabel(o.id, s)),
    // 後から流し込む一覧の中身（上のコメント）
    stay,
    // 日付を選ぶ前の最安（日程ありは null）
    reference
  };
}

export type StayPageData = Awaited<ReturnType<typeof loadStayPage>>;
export type StayPageExtras = Awaited<StayPageData['stay']>;
