// 限定URL（/p/<token>）の共通処理: 取引先の解決・セッションクッキー・リクエスト情報。
import { error, redirect, type Cookies, type RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  findPartnerByUrlToken,
  getPartnerSession,
  partnerAdminClient,
  partnerUnavailableReason,
  PartnerStoreError,
  SESSION_TTL_HOURS,
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

export async function resolvePortal(event: Pick<RequestEvent, 'params' | 'cookies'>): Promise<{
  db: SupabaseClient;
  partner: PartnerContext;
  session: Awaited<ReturnType<typeof getPartnerSession>>;
}> {
  const db = partnerAdminClient();
  if (!db) throw error(503, '現在ご利用いただけません。');
  const token = event.params.token ?? '';
  let partner: PartnerContext | null;
  try {
    partner = await findPartnerByUrlToken(db, token);
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
export async function requirePortalSession(event: Pick<RequestEvent, 'params' | 'cookies' | 'request'>) {
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
    loginId: session?.login_id ?? null,
    isMaster: session?.is_master === true,
    // 管理画面からの確認モード（帯を出し、予約の確定ボタンを止める）
    preview: session?.preview === true,
    bookingEnabled: isPartnerBookingOpen(partner)
  };
}

// 取引先ページの JSON API（予約の仮押さえ・決済の準備と確定）共通: 未ログイン 401・公開停止 403（リダイレクトしない）。
export async function requirePortalApi(event: Pick<RequestEvent, 'params' | 'cookies' | 'request'>) {
  const { db, partner, session } = await resolvePortal(event);
  if (!session) throw error(401, 'ログインしてください。');
  if (partnerUnavailableReason(partner) && !session.preview) throw error(403, '現在ご利用いただけません。');
  denyPreviewWrite(event, session);
  return { db, partner, session };
}
