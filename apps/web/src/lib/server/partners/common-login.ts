// 取引先の共通ログイン画面（/partner・docs/partner-common-login.md）。
// ログインID（全取引先で一意）またはパスキーの持ち主から取引先を引き、その取引先の限定URL（/p/<token>）の文脈に載せ替える。
// ログイン後の画面・セッション・権限は取引先URLのログインと同じ（セッションクッキーは /p/<token> に書く）。
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMemberPage } from '$lib/partner-member-page';
import { verifyPassword } from './crypto';
import { resolvePortal } from './portal';
import { PartnerStoreError } from './store';

/** ログインIDの持ち主の取引先（限定URLのトークン）。見つからない・特別会員の専用ページは null */
export async function findPartnerTokenByLoginId(db: SupabaseClient, loginId: string): Promise<string | null> {
  const id = loginId.trim().toLowerCase();
  if (!id || id.length > 128) return null;
  const { data, error } = await db
    .from('rms_partner_accounts')
    .select('partner:rms_partners!inner(url_token, kind)')
    .eq('login_id', id)
    .maybeSingle();
  if (error) throw new PartnerStoreError('ログインできませんでした。', 503);
  const partner = (data as { partner?: { url_token?: string | null; kind?: string | null } } | null)?.partner;
  if (!partner?.url_token || isMemberPage(partner.kind)) return null;
  return partner.url_token;
}

/** 取引先 id → 限定URLのトークン（パスキーの持ち主から引くとき）。特別会員の専用ページは null */
export async function findPartnerTokenById(db: SupabaseClient, partnerId: string): Promise<string | null> {
  const { data, error } = await db.from('rms_partners').select('url_token, kind').eq('id', partnerId).maybeSingle();
  if (error) throw new PartnerStoreError('ログインできませんでした。', 503);
  const row = data as { url_token?: string | null; kind?: string | null } | null;
  if (!row?.url_token || isMemberPage(row.kind)) return null;
  return row.url_token;
}

/**
 * パスワードだけ照合する（セッションは作らない・失敗の数えもしない）。停止中・公開期間外の取引先で、
 * 正しい ID・パスワードのときだけその案内を出すために使う（§1。試行の制限は呼ぶ側の KV で掛かっている）
 */
export async function partnerPasswordMatches(db: SupabaseClient, partnerId: string, loginId: string, password: string): Promise<boolean> {
  const { data } = await db
    .from('rms_partner_accounts')
    .select('password_hash, is_active')
    .eq('partner_id', partnerId)
    .eq('login_id', loginId.trim().toLowerCase())
    .maybeSingle();
  const row = data as { password_hash?: string | null; is_active?: boolean } | null;
  const ok = await verifyPassword(password, row?.password_hash);
  return ok && Boolean(row?.is_active);
}

/**
 * 共通画面のリクエストを、引いた取引先の限定URLのリクエストとして解決する（resolvePortal と同じ取引先の合成）。
 * 共通画面には取引先のセッション・施設のクッキーが来ない（path が違う）ので、セッションは無し・施設は既定の施設になる。
 * アクセス制限は入口では見ない（ID・パスワードを確かめてから portalAccessDenial で判定し、制限の有無で ID の有無を漏らさない）
 */
export function resolveCommonPortal(event: RequestEvent, urlToken: string) {
  return resolvePortal(
    {
      params: { token: urlToken },
      cookies: event.cookies,
      url: event.url,
      request: event.request,
      platform: event.platform
    },
    { skipAccessCheck: true }
  );
}
