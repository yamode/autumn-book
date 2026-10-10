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
import { randomToken, sha256Hex } from './crypto';
import { isAal2Valid, normalizeMfaPolicy, portalMfaGate, portalMfaUrl } from '$lib/partner-mfa';

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

// ---- 端末クッキー（新しい環境からのログインの判定・docs/auth-hardening.md §4.3） ----
// rms_partner_device（path /p/<token>・httpOnly・secure・Lax・1 年・乱数 16B）。ログイン・パスワード設定のときに無ければ発行する。
// DB（セッションの device_id・ログの detail.device）には値そのものではなくハッシュの頭 32 文字を残す。
export const PARTNER_DEVICE_COOKIE = 'rms_partner_device';
const DEVICE_COOKIE_MAX_AGE = 365 * 24 * 3600;

/** この端末の識別子（ハッシュ）。クッキーが無い・形が違えば新しく発行してクッキーに書く */
export async function partnerDeviceId(event: Pick<RequestEvent, 'params' | 'cookies'>): Promise<string> {
  let value = event.cookies.get(PARTNER_DEVICE_COOKIE) ?? '';
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(value)) {
    value = randomToken(16);
    event.cookies.set(PARTNER_DEVICE_COOKIE, value, {
      path: cookiePath(event.params.token ?? ''),
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: DEVICE_COOKIE_MAX_AGE
    });
  }
  return (await sha256Hex(`device:${value}`)).slice(0, 32);
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

/** 接続元の国・都市（ログイン通知用）。Cloudflare の request.cf（platform.cf）から。無ければ cf-ipcountry ヘッダ、それも無ければ null */
export function requestLocation(event: Pick<RequestEvent, 'request'> & { platform?: App.Platform }): string | null {
  const cf = (event.platform as { cf?: { country?: unknown; city?: unknown } } | undefined)?.cf;
  const country = typeof cf?.country === 'string' ? cf.country : event.request.headers.get('cf-ipcountry');
  const city = typeof cf?.city === 'string' ? cf.city : null;
  const parts = [country && country !== 'XX' ? country : null, city].filter(Boolean);
  return parts.length ? parts.join(' ') : null;
}

// 取引先ページ共通の応答ヘッダ。URL にトークンを含むので、リファラで外へ漏らさない・検索に載せない・保存させない。
// referrer-policy は same-origin（外部サイトへはリファラを送らない）。no-referrer にするとブラウザが通常のフォーム送信
// （ログアウト等の画面遷移を伴う POST）で `Origin: null` を送り、SvelteKit の CSRF 検査で 403 になる（2026-10-10 修正）
export const PORTAL_HEADERS = {
  'cache-control': 'private, no-store',
  'referrer-policy': 'same-origin',
  'x-robots-tag': 'noindex, nofollow'
};

/**
 * 応答を待たせない後始末（アクセスログ・最終アクセスの更新などの書き込み）。
 * Cloudflare では waitUntil に渡して応答の後も続ける。無い環境（vite dev・テスト）は投げっぱなし（失敗は握りつぶす）。
 */
export function deferTask(event: { platform?: App.Platform }, task: Promise<unknown>) {
  const guarded = task.catch(() => undefined);
  const ctx = event.platform?.context;
  if (ctx?.waitUntil) ctx.waitUntil(guarded);
}

// ---- 取引先の設定（束）の一時保存（2026-10-10・メニュー切替を軽くする） ----
// 同じ isolate の中で、トークンごとに 30 秒だけ使い回す（取引先・施設の設定の読み込みは DB の往復が複数あるため）。
// そのため管理画面・RMS で取引先の設定（公開停止・予約受付・料金・施設のオン/オフ等）を変えると、取引先ページへの反映が最長 30 秒遅れる。
// 使い回すのは GET（画面の表示・料金の JSON）だけ。POST（ログイン・予約の確定・支払い・保存・取消）は毎回 DB から読み直す。
// セッション（ログイン・ログアウト・アカウントの停止）は毎回 DB で確かめるので、ここでは遅れない。
const BUNDLE_TTL_MS = 30_000;
const BUNDLE_CACHE_MAX = 200;
const bundleCache = new Map<string, { at: number; bundle: PartnerBundle }>();

async function loadPartnerBundle(db: SupabaseClient, token: string, useCache: boolean): Promise<PartnerBundle | null> {
  const now = Date.now();
  if (useCache) {
    const hit = bundleCache.get(token);
    if (hit && now - hit.at < BUNDLE_TTL_MS) return hit.bundle;
  }
  const bundle = await findPartnerBundleByUrlToken(db, token);
  if (bundle) {
    // 古いものから捨てる（Map は入れた順）
    bundleCache.delete(token);
    if (bundleCache.size >= BUNDLE_CACHE_MAX) bundleCache.delete(bundleCache.keys().next().value as string);
    bundleCache.set(token, { at: now, bundle });
  } else {
    bundleCache.delete(token);
  }
  return bundle;
}

/** テスト用: 一時保存を空にする */
export function clearPartnerBundleCache() {
  bundleCache.clear();
}

export async function resolvePortal(
  event: Pick<RequestEvent, 'params' | 'cookies'> & { url?: URL; request?: Request; platform?: App.Platform }
): Promise<{
  db: SupabaseClient;
  partner: PartnerContext;
  session: Awaited<ReturnType<typeof getPartnerSession>>;
}> {
  const db = partnerAdminClient();
  if (!db) throw error(503, '現在ご利用いただけません。');
  const token = event.params.token ?? '';
  // 取引先の設定を30秒使い回すのは、表示だけの GET / HEAD に限る（レビュー指摘 2026-10-10）:
  //   - リクエストが分からない呼び出しは使い回さない（POST の書き込みで古い設定を使わない）
  //   - 確認モード（管理画面の「確認ページを開く」）は、管理画面で変えた直後の設定を確かめるための入口なので毎回読む
  //   - 料金表の出力（CSV / PDF / 印刷）は、停止・トークン再発行をすぐ効かせるため毎回読む
  const method = event.request?.method;
  const rateSheetOutput = /\/rate-sheet\/(csv|pdf|print)\/?$/.test(event.url?.pathname ?? '');
  const useCache =
    (method === 'GET' || method === 'HEAD') && !event.cookies.get(PARTNER_PREVIEW_COOKIE) && !rateSheetOutput;
  const partnerPromise = (async () => {
    try {
      const bundle = await loadPartnerBundle(db, token, useCache);
      // 施設の選択（?f= → クッキー → 既定の施設 → オンの先頭）で合成する（§7.8）
      return bundle ? composeForRequest(event, bundle) : null;
    } catch (e) {
      if (e instanceof PartnerStoreError) throw error(503, '現在ご利用いただけません。');
      throw e;
    }
  })();
  // セッションの問い合わせは取引先の読み込みと並べて投げる（取引先が見つからない・読めないときは捨てる）
  const sessionPromise = getPartnerSession(db, partnerPromise.catch(() => null), event.cookies.get(PARTNER_SESSION_COOKIE), {
    defer: (p) => deferTask(event, p)
  });
  sessionPromise.catch(() => undefined);
  const partner = await partnerPromise;
  if (!partner) throw error(404, 'ページが見つかりません。');
  let session = await sessionPromise;
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

// 本人確認（第2要素）の関所（docs/auth-hardening.md §6.2・S3）: ログイン直後の本人確認待ち（mfa_method='required'）と、
// 方針 always / passkey_only で aal2 が切れているセッションは、/mfa（と、メールの登録・ログアウト）以外を使わせない。
// opts.mfaGate=false: /mfa 自身・セキュリティのメール登録など、本人確認の前に使う必要のある入口だけが渡す。
type PortalGateOptions = { mfaGate?: boolean };

/** 戻り先（いま開いているページ・form action の ?/xxx は外す） */
function gateNext(event: { url?: URL }, token: string): string {
  if (!event.url) return `/p/${token}/calendar`;
  const u = new URL(event.url);
  for (const k of [...u.searchParams.keys()]) if (k.startsWith('/')) u.searchParams.delete(k);
  const q = u.searchParams.toString();
  return `${u.pathname}${q ? `?${q}` : ''}`;
}

/** セッションと取引先の方針から、関所で止めるか（確認モードは止めない） */
export function portalNeedsMfa(partner: Pick<PartnerContext, 'mfa_policy'>, session: { aal?: number; mfaAt?: string | null; mfaMethod?: string | null; preview?: boolean }) {
  return portalMfaGate(session, normalizeMfaPolicy(partner.mfa_policy));
}

/** セッションの aal2 が今も有効か（表示用。確認モードは false） */
export const portalAal2 = (session: { aal?: number; mfaAt?: string | null; preview?: boolean } | null) => Boolean(session && !session.preview && isAal2Valid(session));

// ログイン済みの取引先ページ共通: セッションが無い・公開停止中ならログイン画面へ戻す。
export async function requirePortalSession(
  event: Pick<RequestEvent, 'params' | 'cookies' | 'request'> & { url?: URL; platform?: App.Platform },
  opts: PortalGateOptions = {}
) {
  const { db, partner, session } = await resolvePortal(event);
  const token = event.params.token ?? '';
  if (!session) throw redirect(303, `/p/${token}`);
  // 確認モードは公開停止中でも見られる（公開前の確認のため）
  if (partnerUnavailableReason(partner) && !session.preview) throw redirect(303, `/p/${token}`);
  denyPreviewWrite(event, session);
  if (opts.mfaGate !== false && portalNeedsMfa(partner, session)) throw redirect(303, portalMfaUrl(token, gateNext(event, token)));
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
export async function requirePortalApi(
  event: Pick<RequestEvent, 'params' | 'cookies' | 'request'> & { url?: URL; platform?: App.Platform },
  opts: PortalGateOptions = {}
) {
  const { db, partner, session } = await resolvePortal(event);
  if (!session) throw error(401, 'ログインしてください。');
  if (partnerUnavailableReason(partner) && !session.preview) throw error(403, '現在ご利用いただけません。');
  denyPreviewWrite(event, session);
  if (opts.mfaGate !== false && portalNeedsMfa(partner, session)) throw error(403, '本人確認（メールの認証コードまたはパスキー）が済んでいません。画面を読み直してください。');
  return { db, partner, session };
}
