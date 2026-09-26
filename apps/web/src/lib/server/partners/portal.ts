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
  const session = await getPartnerSession(db, partner, event.cookies.get(PARTNER_SESSION_COOKIE));
  return { db, partner, session };
}

// ログイン済みの取引先ページ共通: セッションが無い・公開停止中ならログイン画面へ戻す。
export async function requirePortalSession(event: Pick<RequestEvent, 'params' | 'cookies'>) {
  const { db, partner, session } = await resolvePortal(event);
  const token = event.params.token ?? '';
  if (!session) throw redirect(303, `/p/${token}`);
  if (partnerUnavailableReason(partner)) throw redirect(303, `/p/${token}`);
  return { db, partner, session };
}

// 取引先ページのヘッダー（layout）に渡す情報。
export function portalHeader(partner: PartnerContext, session: { login_id: string } | null) {
  return {
    partnerName: partner.name,
    facilityName: partner.facility_name,
    facilitySlug: partner.facility_slug,
    loginId: session?.login_id ?? null,
    bookingEnabled: isPartnerBookingOpen(partner)
  };
}

// 取引先ページの JSON API（予約の仮押さえ・決済の準備と確定）共通: 未ログイン 401・公開停止 403（リダイレクトしない）。
export async function requirePortalApi(event: Pick<RequestEvent, 'params' | 'cookies'>) {
  const { db, partner, session } = await resolvePortal(event);
  if (!session) throw error(401, 'ログインしてください。');
  if (partnerUnavailableReason(partner)) throw error(403, '現在ご利用いただけません。');
  return { db, partner, session };
}
