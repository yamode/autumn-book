// プライベートブック（特別会員を公式サイト＝A面の中で扱う・docs/private-book.md）の純関数と型。
// サーバ（$lib/server/private-book.ts・hooks・各ページの load / action）と画面の両方から使う。
//
//   状態はクッキー ab_private_book（中身は専用ページの partnerId だけ）。クッキーは「どのページを選んだか」の希望でしかなく、
//   リクエストのたびに privateBookVerdict で「会員でログイン中・そのページを今使える・kind=member・公開期間内」を確かめ直す。
//   料金は施設ごと: pbFacilitySpecial が真の施設だけ特別料金、それ以外の施設はふつうの料金（「この施設はふつうの料金です」）。
import { memberPageBookingOpen, memberPagePlansComingSoon } from './partner-member-page';

/** 状態のクッキー（httpOnly・path=/・セッション限り）。中身は専用ページの partnerId */
export const PB_COOKIE = 'ab_private_book';

/** 入口（GET）・出口（POST） */
export const PB_ENTRY_PATH = '/private-book';
export const PB_EXIT_PATH = '/private-book/off';

/** 入口の URL（どのページを選ぶか ?page=<partnerId>）。partnerId が UUID でなければ ?page なし（本人 → 家族の順で選ぶ） */
export function privateBookEntryHref(partnerId: string | null | undefined): string {
  const id = parsePbCookie(partnerId);
  return id ? `${PB_ENTRY_PATH}?page=${id}` : PB_ENTRY_PATH;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 使える専用ページ（memberPagesFor の要るところだけ） */
export type PbPage = { partnerId: string; name: string; via: 'self' | 'family' };

/** locals.privateBook・画面に渡す状態 */
export type PrivateBookState = {
  /** いま選んでいる専用ページ */
  partnerId: string;
  /** 専用ページの名前（「○○様 専用ページ」） */
  pageName: string;
  via: 'self' | 'family';
  /** 切り替えられるページ（本人 → 家族の順） */
  pages: PbPage[];
};

/** クッキーの値 → partnerId（UUID でなければ null） */
export function parsePbCookie(raw: string | null | undefined): string | null {
  const v = String(raw ?? '').trim();
  return UUID_RE.test(v) ? v.toLowerCase() : null;
}

/** 本人のページを先に、次にご家族のご招待のページ（同じ種類の中は元の順） */
export function sortPbPages<T extends Pick<PbPage, 'via'>>(pages: readonly T[]): T[] {
  return [...pages.filter((p) => p.via === 'self'), ...pages.filter((p) => p.via !== 'self')];
}

/**
 * 入口で選ぶページ。requested（?page=）があれば、それが使えるページの中にあるときだけそれ。
 * 無ければ本人のページ → ご家族のページ。使えるページが無ければ null
 */
export function choosePrivateBookPage<T extends PbPage>(pages: readonly T[], requested?: string | null): T | null {
  const want = parsePbCookie(requested);
  if (requested && !want) return null;
  if (want) return pages.find((p) => p.partnerId.toLowerCase() === want) ?? null;
  return sortPbPages(pages)[0] ?? null;
}

/** 専用ページの行（kind・公開・公開期間） */
export type PbPartnerGate = { kind: string; is_active: boolean; valid_from: string | null; valid_until: string | null };

/** 公開期間・公開停止（store.ts の partnerUnavailableReason と同じ条件の真偽版） */
export function pbPartnerAvailable(p: Pick<PbPartnerGate, 'is_active' | 'valid_from' | 'valid_until'>, today: string): boolean {
  if (!p.is_active) return false;
  if (p.valid_from && today < p.valid_from) return false;
  if (p.valid_until && today > p.valid_until) return false;
  return true;
}

/**
 * クッキーを信じずに状態を決める（毎リクエスト）。どれか1つでも欠ければ null（呼び出し側がクッキーを消す）。
 *   - クッキーが UUID
 *   - 会員でログイン中
 *   - そのページが「会員が使える公開中の専用ページ」（rms_member_pages_for）に入っている
 *   - rms_member_page_access が真（本人か PMS の家族が対象者・退会者は偽）
 *   - kind='member'・公開中・公開期間内
 */
export function privateBookVerdict(args: {
  cookie: string | null | undefined;
  isMember: boolean;
  pages: readonly PbPage[];
  access: boolean;
  partner: PbPartnerGate | null;
  today: string;
}): PrivateBookState | null {
  const id = parsePbCookie(args.cookie);
  if (!id || !args.isMember) return null;
  const page = args.pages.find((p) => p.partnerId.toLowerCase() === id);
  if (!page || !args.access) return null;
  const p = args.partner;
  if (!p || p.kind !== 'member' || !pbPartnerAvailable(p, args.today)) return null;
  return {
    partnerId: page.partnerId,
    pageName: page.name,
    via: page.via,
    pages: sortPbPages(args.pages).map((x) => ({ partnerId: x.partnerId, name: x.name, via: x.via }))
  };
}

/** 施設ごとの専用ページの設定（その施設で合成した PartnerContext の要るところだけ） */
export type PbFacilityGate = {
  kind: string;
  booking_enabled: boolean;
  facility_available: boolean;
  facility_id: string;
  pricing: { rules: { action: string; dateTo: string | null }[] };
};

/**
 * この施設を特別料金で出すか。専用ページでその施設の予約受付がオン（施設オン・予約受付オン）で、
 * 販売中の料金ルール（期限切れでない「出す」ルール）があるとき。偽ならその施設はふつうの料金で出す
 */
export function pbFacilitySpecial(ctx: PbFacilityGate | null | undefined, facilityId: string, today: string): boolean {
  if (!ctx || ctx.facility_id !== facilityId) return false;
  return memberPageBookingOpen(ctx) && !memberPagePlansComingSoon(ctx, today);
}

/** 画面に渡す施設ごとの表示（状態でなければ null＝何も出さない） */
export type PbFacilityView = { special: boolean } | null;

/** 予約かごの保存キー（状態のときは専用ページごとに分ける・通常のかごと混ぜない） */
export function pbCartStorageKey(partnerId: string | null | undefined, base = 'ab_booking_cart_v1'): string {
  return partnerId ? `${base}:pb:${partnerId}` : base;
}

/** 戻り先（自サイトのパスだけ。外部 URL・// は fallback） */
export function pbSafeBack(raw: string | null | undefined, fallback = '/search'): string {
  const v = String(raw ?? '');
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return fallback;
  // 入口・出口へは戻さない（行ったり来たりしない）
  if (v === PB_ENTRY_PATH || v.startsWith(`${PB_ENTRY_PATH}?`) || v.startsWith(`${PB_ENTRY_PATH}/`)) return fallback;
  return v;
}

// ---------------------------------------------------------------------------
// 料金（専用ページの料金ルールの泊ごとの1名料金 → A面の形）
// ---------------------------------------------------------------------------

/** loadPartnerRates の days（PartnerRateDay）の要るところだけ */
export type PbRateDay = {
  date: string;
  closed: boolean;
  rooms: {
    roomCode: string;
    remainingRooms: number | null;
    plans: { planCode: string; planName: string; pricesPerPerson: Record<string, number> }[];
  }[];
};

/** 料金カレンダーのプランのキー（= booking.rate_plans.code・member-hold の memberPlanKey と同じ） */
export const pbPlanKey = (planCode: string, planName: string) => `${planCode}■${planName}`;

export type PbStayQuote = {
  roomCode: string;
  planKey: string;
  /** 1室の全泊の合計（人数ぶん） */
  total: number;
  /** 泊ごとの残室の最小（料金カレンダーが残室を出さないときは null） */
  remaining: number | null;
};

const addDays = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

/**
 * checkIn から nights 泊・1室 adults 名の部屋タイプ×プランごとの合計。どれかの泊が休館・料金なし・その人数の料金なしなら出さない。
 * plans（キーの集合）を渡せばその中だけ。roomCodes を渡せばその部屋タイプだけ
 */
export function pbStayQuotes(
  days: readonly PbRateDay[],
  checkIn: string,
  nights: number,
  adults: number,
  opts: { plans?: ReadonlySet<string>; roomCodes?: ReadonlySet<string> } = {}
): PbStayQuote[] {
  if (!(nights >= 1) || !(adults >= 1)) return [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = byDate.get(checkIn);
  if (!first || first.closed) return [];
  const out: PbStayQuote[] = [];
  for (const room of first.rooms) {
    if (opts.roomCodes && !opts.roomCodes.has(room.roomCode)) continue;
    for (const plan of room.plans) {
      const key = pbPlanKey(plan.planCode, plan.planName);
      if (opts.plans && !opts.plans.has(key)) continue;
      let total = 0;
      let remaining: number | null = null;
      let unknown = false;
      let ok = true;
      for (let i = 0; i < nights; i += 1) {
        const day = byDate.get(addDays(checkIn, i));
        const r = day && !day.closed ? day.rooms.find((x) => x.roomCode === room.roomCode) : undefined;
        const p = r?.plans.find((x) => x.planCode === plan.planCode && x.planName === plan.planName);
        const unit = p?.pricesPerPerson[String(adults)];
        if (!r || unit == null || !Number.isFinite(unit)) {
          ok = false;
          break;
        }
        total += unit * adults;
        if (r.remainingRooms == null) unknown = true;
        else remaining = remaining == null ? r.remainingRooms : Math.min(remaining, r.remainingRooms);
      }
      if (ok) out.push({ roomCode: room.roomCode, planKey: key, total, remaining: unknown ? null : remaining });
    }
  }
  return out;
}

/** A面の料金の1行（plan_offers と同じ形） */
export type PbOffer = { ratePlanId: string; roomTypeId: string; total: number; perPerson: number; remaining: number };

/**
 * ふつうの料金の行に特別料金の行を重ねる。同じプラン×部屋タイプは特別料金に差し替え、ふつうに無い組（公式の販売状況で出ていない）は足す。
 * specialKeys は特別料金になった組（`${ratePlanId}|${roomTypeId}`）
 */
export function mergePbOffers<T extends Omit<PbOffer, 'perPerson'>>(normal: readonly T[], special: readonly PbOffer[]): { offers: (T | PbOffer)[]; specialKeys: Set<string> } {
  const key = (o: Pick<PbOffer, 'ratePlanId' | 'roomTypeId'>) => `${o.ratePlanId}|${o.roomTypeId}`;
  const sp = new Map(special.map((o) => [key(o), o]));
  const out: (T | PbOffer)[] = normal.map((o) => {
    const s = sp.get(key(o));
    return s ? { ...o, total: s.total, perPerson: s.perPerson, remaining: s.remaining } : o;
  });
  const have = new Set(normal.map(key));
  for (const s of special) if (!have.has(key(s))) out.push(s);
  return { offers: out, specialKeys: new Set(sp.keys()) };
}

/** 1名1泊（合計 ÷ (人数×泊数)・四捨五入） */
export const pbPerPerson = (total: number, adults: number, nights: number) => Math.round(total / Math.max(1, adults * nights));

/** 空室カレンダーの1日（stay-calendar.ts の StayCalendarDay と同じ形） */
export type PbCalendarDay = { date: string; price: number; remaining: number; rooms: number };

/**
 * 特別料金の空室カレンダー: from〜to のチェックイン日ごとに、nights 泊・1室 adults 名で出せる組の最安「1名1泊」。
 * 残室は部屋タイプごとの泊の最小（remaining は 1 つの部屋タイプの最大・rooms は部屋タイプの合計）。
 * 料金カレンダーが残室を出さない組（null）は fallback（ふつうの空室カレンダーのその日）の値を使い、それも無ければ出さない。
 * canBook（締切）が偽の日は出さない
 */
export function pbStayCalendarDays(
  days: readonly PbRateDay[],
  range: { from: string; to: string },
  nights: number,
  adults: number,
  opts: {
    plans?: ReadonlySet<string>;
    roomCodes?: ReadonlySet<string>;
    canBook?: (date: string) => boolean;
    fallback?: ReadonlyMap<string, { remaining: number; rooms: number }>;
  } = {}
): PbCalendarDay[] {
  const out: PbCalendarDay[] = [];
  for (let date = range.from; date <= range.to; date = addDays(date, 1)) {
    if (opts.canBook && !opts.canBook(date)) continue;
    const quotes = pbStayQuotes(days, date, nights, adults, { plans: opts.plans, roomCodes: opts.roomCodes });
    if (!quotes.length) continue;
    const fb = opts.fallback?.get(date);
    let price: number | null = null;
    const perRoom = new Map<string, number>();
    let unknown = false;
    for (const q of quotes) {
      if (q.remaining === null) unknown = true;
      else if (q.remaining <= 0) continue;
      else perRoom.set(q.roomCode, Math.max(perRoom.get(q.roomCode) ?? 0, q.remaining));
      const pp = pbPerPerson(q.total, adults, nights);
      if (price === null || pp < price) price = pp;
    }
    if (price === null) continue;
    if (perRoom.size) {
      const vals = [...perRoom.values()];
      out.push({ date, price, remaining: Math.max(...vals), rooms: vals.reduce((s, n) => s + n, 0) });
    } else if (unknown && fb && fb.remaining > 0) {
      out.push({ date, price, remaining: fb.remaining, rooms: fb.rooms });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 専用ページを全施設で販売する（VIP の専用ページ・member-bookings.ts の createVipPage / ensureVipPages）
// ---------------------------------------------------------------------------

/**
 * 専用ページに足す施設: Book の施設のうち、施設設定の行がまだ無いもの（並びは Book の施設の並び）。
 * 行があってオフの施設は足さない（スタッフが止めた施設を毎回オンに戻さない＝何度呼んでも同じ結果）
 */
export function vipFacilitiesToAdd(bookFacilityIds: readonly string[], existing: readonly { facility_id: string }[]): string[] {
  const have = new Set(existing.map((r) => r.facility_id));
  return bookFacilityIds.filter((id, i) => !have.has(id) && bookFacilityIds.indexOf(id) === i);
}

// ---------------------------------------------------------------------------
// B面（/p/<token>）の特別会員の道を畳む（作る順番 5・v0.355.0）
// ---------------------------------------------------------------------------

/** 旧 B面の特別会員の URL を開いたときの行き先。redirect = 公式サイトへ転送、gone = 410（POST など・二重送信で予約を作らない） */
export type MemberPortalForward = { kind: 'redirect'; location: string } | { kind: 'gone' };

const BOOKING_CODE_RE = /^[A-Za-z0-9-]{1,40}$/;

/**
 * 特別会員の専用ページ（kind='member'）の B面の URL → 公式サイトの行き先（純関数）。確認モードでは呼ばない（B面のまま）。
 *   sub は /p/<token> の後ろ（先頭 / つき・空は '/'）。
 *   - GET / HEAD 以外 → gone
 *   - /bookings → /account/reservations（マイページのご予約一覧）
 *   - /bookings/<予約番号>[/amend | /amend/room/<n> | /options] → /account/reservations/<予約番号> の同じ形
 *     （それ以外の下の階層・形の違う予約番号はご予約の詳細・一覧へ）
 *   - それ以外（/・/calendar・/plans・/rooms・/rate-sheet・/book …）→ /private-book?page=<partnerId>
 *     （入口が「会員ログイン・使えるページか」を確かめ、対象でなければクッキーを消して公式サイトへ戻す）
 */
export function memberPortalForward(sub: string, method: string, partnerId: string): MemberPortalForward {
  const m = method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return { kind: 'gone' };
  const path = (sub || '/').replace(/\/+$/, '') || '/';
  if (path === '/bookings') return { kind: 'redirect', location: '/account/reservations' };
  const hit = /^\/bookings\/([^/]+)(\/.*)?$/.exec(path);
  if (hit) {
    let code = '';
    try {
      code = decodeURIComponent(hit[1]);
    } catch {
      code = '';
    }
    if (!BOOKING_CODE_RE.test(code)) return { kind: 'redirect', location: '/account/reservations' };
    const base = `/account/reservations/${encodeURIComponent(code)}`;
    const rest = hit[2] ?? '';
    const keep = /^\/(?:amend(?:\/room\/\d{1,2})?|options)$/.test(rest) ? rest : '';
    return { kind: 'redirect', location: `${base}${keep}` };
  }
  return { kind: 'redirect', location: privateBookEntryHref(partnerId) };
}

/**
 * DB が作る専用ページの予約詳細の URL（/p/<token>/bookings/<予約番号>・確定メールやゲスト取消の照会の member_page_url）
 * → マイページの予約詳細（/account/reservations/<予約番号>）。形が違えば null
 */
export function memberPageUrlToAccount(url: string | null | undefined): string | null {
  const hit = /^\/p\/[A-Za-z0-9_-]+(\/bookings\/[^/?#]+)$/.exec(String(url ?? ''));
  if (!hit) return null;
  const to = memberPortalForward(hit[1], 'GET', '');
  return to.kind === 'redirect' && to.location.startsWith('/account/reservations/') ? to.location : null;
}
