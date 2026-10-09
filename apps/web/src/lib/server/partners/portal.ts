// 限定URL（/p/<token>）の共通処理: 取引先の解決・セッションクッキー・リクエスト情報。
import { error, redirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  composePartnerContext,
  defaultPartnerFacilityId,
  findPartnerBundleByUrlToken,
  getPartnerSession,
  loadPartnerContext,
  NO_PARTNER_FACILITY_MESSAGE,
  partnerAdminClient,
  partnerUnavailableReason,
  PartnerStoreError,
  SESSION_TTL_HOURS,
  type PartnerBundle,
  type PartnerContext,
  type RequestMeta
} from './store';
import { isPartnerBookingOpen } from './booking';
import { PARTNER_PREVIEW_COOKIE, PREVIEW_ACCOUNT_ID, PREVIEW_DENIED_MESSAGE, verifyPreviewToken } from './preview';

export const PARTNER_SESSION_COOKIE = 'rms_partner_session';

export const cookiePath = (urlToken: string) => `/p/${urlToken}`;

export function setPartnerSessionCookie(cookies: Cookies, urlToken: string, sessionToken: string) {
  cookies.set(PARTNER_SESSION_COOKIE, sessionToken, {
    path: cookiePath(urlToken),
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_HOURS * 3600
  });
}

export function clearPartnerSessionCookie(cookies: Cookies, urlToken: string) {
  cookies.delete(PARTNER_SESSION_COOKIE, { path: cookiePath(urlToken) });
}

// ---- 選択中の施設（複数施設化・docs/partner-multi-facility.md §7.8・決定 N1・2026-10-09） ----
//
// URL は今のまま（/p/<token>/…）。選んでいる施設はクッキー rms_partner_facility（path /p/<token>・1年・値は施設の slug）に持ち、
// ?f=<slug> が付けばそれを採用してクッキーも更新する。決め方:
//   1. ?f=<slug> がオンの施設 → それ（クッキーも更新）。オフ・不明なら無視
//   2. クッキーがオンの施設 → それ
//   3. primary_facility_id（オンなら）
//   4. オンの施設の先頭（sort_order → 施設の並び）
//   5. オンが1つも無い → null（N9: ログインはできるが料金・予約は案内文。合成は facility_available=false）
// 切替の画面: ヘッダーのセグメント（オンが2つ以上のときだけ・N12）→ POST /p/<token>/facility（f・next）→ 303（S4・2026-10-09）。

export const PARTNER_FACILITY_COOKIE = 'rms_partner_facility';
const FACILITY_COOKIE_MAX_AGE = 365 * 24 * 3600;

export type PartnerFacilitySource = 'query' | 'cookie' | 'primary' | 'first' | 'none';

/** 施設の選択（純関数）。facilities は取引先の施設（オン／オフとも）、slug は ?f= / クッキーの値 */
export function selectPartnerFacility(
  facilities: readonly { id: string; slug: string; enabled: boolean }[],
  primaryFacilityId: string | null,
  choice: { query?: string | null; cookie?: string | null }
): { facilityId: string | null; source: PartnerFacilitySource } {
  const enabled = facilities.filter((f) => f.enabled);
  const bySlug = (slug: string | null | undefined) => (slug ? enabled.find((f) => f.slug === slug) : undefined);
  const q = bySlug(choice.query);
  if (q) return { facilityId: q.id, source: 'query' };
  const c = bySlug(choice.cookie);
  if (c) return { facilityId: c.id, source: 'cookie' };
  const p = enabled.find((f) => f.id === primaryFacilityId);
  if (p) return { facilityId: p.id, source: 'primary' };
  if (enabled[0]) return { facilityId: enabled[0].id, source: 'first' };
  return { facilityId: null, source: 'none' };
}

export function setPartnerFacilityCookie(cookies: Cookies, urlToken: string, slug: string) {
  cookies.set(PARTNER_FACILITY_COOKIE, slug, {
    path: cookiePath(urlToken),
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: FACILITY_COOKIE_MAX_AGE
  });
}

/** ヘッダーの切替に出す施設（オンの施設・並び順）。2つ以上のときだけ切替を出す（N12: 1施設の取引先は今と同じ画面） */
export function portalFacilityChoices(partner: Pick<PartnerContext, 'facilities'>): { slug: string; name: string }[] {
  return partner.facilities.filter((f) => f.enabled).map((f) => ({ slug: f.slug, name: f.name }));
}

/**
 * 施設を切り替えた後に戻る先（純関数）。next は切替を押したページ（パス＋クエリ）。
 *   - /p/<token> の中のパスだけ（外・別トークン・不正な値はトップへ）
 *   - ?f= は外す（残すと次の読み込みでクッキーより優先され、切り替えた施設が元に戻る）
 *   - 予約入力（/book…）は前の施設の部屋・プランなので、料金カレンダーへ戻す
 */
export function facilitySwitchTarget(token: string, next: string | null | undefined): string {
  const base = `/p/${token}`;
  let u: URL;
  try {
    u = new URL(String(next ?? ''), 'http://portal.invalid');
  } catch {
    return base;
  }
  if (u.origin !== 'http://portal.invalid' || !(u.pathname === base || u.pathname.startsWith(`${base}/`))) return base;
  if (/^\/book(\/|$)/.test(u.pathname.slice(base.length))) return `${base}/calendar`;
  u.searchParams.delete('f');
  const q = u.searchParams.toString();
  return `${u.pathname}${q ? `?${q}` : ''}`;
}

// 取引先の施設の束から、リクエスト（?f=・クッキー）に従って施設を選んで合成する。?f= が効いたらクッキーも更新する。
function composeForRequest(
  event: Pick<RequestEvent, 'params' | 'cookies'> & { url?: URL },
  bundle: PartnerBundle
): PartnerContext | null {
  const token = event.params.token ?? '';
  const facilities = bundle.facilities.map((f) => ({ id: f.facility_id, slug: f.slug, enabled: f.enabled }));
  const cookie = event.cookies.get(PARTNER_FACILITY_COOKIE) ?? null;
  const { facilityId, source } = selectPartnerFacility(facilities, bundle.common.primary_facility_id, {
    query: event.url?.searchParams.get('f') ?? null,
    cookie
  });
  const partner = composePartnerContext(bundle, facilityId ?? defaultPartnerFacilityId(bundle));
  if (partner && source === 'query' && cookie !== partner.facility_slug) setPartnerFacilityCookie(event.cookies, token, partner.facility_slug);
  // オフになった施設を指していたクッキーは消す（次の操作でもう一方の施設へ切り替わる・§13）
  else if (cookie && source !== 'cookie' && source !== 'query') event.cookies.delete(PARTNER_FACILITY_COOKIE, { path: cookiePath(token) });
  return partner;
}

/**
 * 予約画面（/book・/book/quote・/book/reserve・添付）用: フォームの施設（hidden facility_id）で合成し直す（§7.8）。
 * 選んでいる施設（クッキー）ではなく、画面を開いたときの施設で見積・確定する（切替直後の二重送信で施設がずれないように）。
 * 空・同じ施設ならそのまま。オンでない施設・取引先の施設でなければ 409。
 */
export async function portalFacilityContext(
  db: SupabaseClient,
  partner: PartnerContext,
  facilityId: string | null | undefined
): Promise<PartnerContext> {
  const id = String(facilityId ?? '').trim();
  if (!id || id === partner.facility_id) return partner;
  const ctx = /^[0-9a-f-]{36}$/i.test(id) ? await loadPartnerContext(db, partner.id, id) : null;
  if (!ctx || ctx.facility_id !== id || !ctx.facility_available) {
    throw new PartnerStoreError('予約する施設を確かめられませんでした。画面を読み直してください。', 409, 'facility_mismatch');
  }
  return ctx;
}

/** オンの施設が1つも無い取引先の案内（N9）。オンの施設があれば null */
export const partnerNoFacilityMessage = (partner: Pick<PartnerContext, 'facility_available'>) =>
  partner.facility_available ? null : NO_PARTNER_FACILITY_MESSAGE;

export function requestMeta(event: Pick<RequestEvent, 'request'>): RequestMeta {
  return {
    ip: event.request.headers.get('cf-connecting-ip') ?? event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    userAgent: event.request.headers.get('user-agent')
  };
}

// 取引先ページ共通の応答ヘッダ。URL にトークンを含むので、リファラで外へ漏らさない・検索に載せない・保存させない。
export const PORTAL_HEADERS = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'no-referrer',
  'x-robots-tag': 'noindex, nofollow'
};

export async function resolvePortal(event: Pick<RequestEvent, 'params' | 'cookies'> & { url?: URL }): Promise<{
  db: SupabaseClient;
  partner: PartnerContext;
  session: Awaited<ReturnType<typeof getPartnerSession>>;
}> {
  const db = partnerAdminClient();
  if (!db) throw error(503, '現在ご利用いただけません。');
  const token = event.params.token ?? '';
  let partner: PartnerContext | null;
  try {
    const bundle = await findPartnerBundleByUrlToken(db, token);
    // 施設の選択（?f= → クッキー → 既定の施設 → オンの先頭）で合成する（§7.8）
    partner = bundle ? composeForRequest(event, bundle) : null;
  } catch (e) {
    if (e instanceof PartnerStoreError) throw error(503, '現在ご利用いただけません。');
    throw e;
  }
  if (!partner) throw error(404, 'ページが見つかりません。');
  let session = await getPartnerSession(db, partner, event.cookies.get(PARTNER_SESSION_COOKIE));
  // 取引先のログインが無く、管理画面の「確認ページを開く」の署名付きクッキーがあれば確認モード（preview.ts）
  if (!session && (await verifyPreviewToken(event.cookies.get(PARTNER_PREVIEW_COOKIE), partner.id))) {
    session = { id: PREVIEW_ACCOUNT_ID, login_id: '管理者の確認', display_name: '管理者の確認', is_master: false, sessionId: '', preview: true };
  }
  return { db, partner, session };
}

// 確認モードは見るだけ。GET 以外（予約の確定・取消・保存・アップロード等）は入口で一律に断る
function denyPreviewWrite(event: Pick<RequestEvent, 'request'>, session: { preview?: boolean } | null) {
  if (session?.preview && event.request.method !== 'GET' && event.request.method !== 'HEAD') throw error(403, PREVIEW_DENIED_MESSAGE);
}

// ログイン済みの取引先ページ共通: セッションが無い・公開停止中ならログイン画面へ戻す。
export async function requirePortalSession(event: Pick<RequestEvent, 'params' | 'cookies' | 'request'> & { url?: URL }) {
  const { db, partner, session } = await resolvePortal(event);
  const token = event.params.token ?? '';
  if (!session) throw redirect(303, `/p/${token}`);
  // 確認モードは公開停止中でも見られる（公開前の確認のため）
  if (partnerUnavailableReason(partner) && !session.preview) throw redirect(303, `/p/${token}`);
  denyPreviewWrite(event, session);
  return { db, partner, session };
}

// 取引先ページのヘッダー（layout）に渡す情報。
// isMaster: マスタユーザー（Book が発行したログインID）か。アカウント画面の「ユーザー管理」タブの表示に使う
// （表示だけ。ユーザー管理の読み書きは store.ts の requireMasterAccount で毎回 DB を確かめる）。
export function portalHeader(partner: PartnerContext, session: { login_id: string; is_master?: boolean; preview?: boolean } | null) {
  return {
    partnerName: partner.name,
    facilityName: partner.facility_name,
    facilitySlug: partner.facility_slug,
    // 選んでいる施設（予約画面の hidden facility_id・切替の現在地）と、オンの施設が無いときの案内（N9）
    facilityId: partner.facility_id,
    noFacilityMessage: partnerNoFacilityMessage(partner),
    // ヘッダーの施設切替（オンの施設。2つ以上のときだけ出す・N12）
    facilityChoices: portalFacilityChoices(partner),
    loginId: session?.login_id ?? null,
    isMaster: session?.is_master === true,
    // 管理画面からの確認モード（帯を出し、予約の確定ボタンを止める）
    preview: session?.preview === true,
    // メニューの「予約一覧」: どれかのオンの施設で予約を受けていれば出す（選んでいる施設だけで決めない・2026-10-09 複数施設化）。
    // 選んでいる施設の予約受付（料金カレンダーの「予約する」）は各ページの booking.enabled で別に判定する
    bookingEnabled: isPartnerBookingOpen(partner) || partner.facilities.some((f) => f.enabled && f.bookingEnabled)
  };
}

// 取引先ページの JSON API（予約の仮押さえ・決済の準備と確定）共通: 未ログイン 401・公開停止 403（リダイレクトしない）。
export async function requirePortalApi(event: Pick<RequestEvent, 'params' | 'cookies' | 'request'> & { url?: URL }) {
  const { db, partner, session } = await resolvePortal(event);
  if (!session) throw error(401, 'ログインしてください。');
  if (partnerUnavailableReason(partner) && !session.preview) throw error(403, '現在ご利用いただけません。');
  denyPreviewWrite(event, session);
  return { db, partner, session };
}
