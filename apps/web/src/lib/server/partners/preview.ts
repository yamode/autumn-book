// 取引先ページの「確認モード」（管理画面の「確認ページを開く」・2026-10-07）。
// Book の管理者・スタッフが、取引先のアカウントを使わずに、その取引先から見た画面を確かめるためのもの。
//
// - 管理画面（/admin/partners/[id]/preview）で権限を確かめてから、署名付きのクッキー rms_partner_preview を
//   path /p/<urlToken> に置く。取引先ページは会員・運営のログイン状態を持ち込まない（hooks.server.ts）ので、
//   このクッキーの署名だけで確認モードと判断する。
// - 署名は HMAC-SHA256。鍵はサーバだけが持つ SUPABASE_SERVICE_ROLE_KEY から用途の接頭辞つきで作る
//   （クッキーを書き換えても、別の取引先・期限の延長は通らない）。有効期限は2時間。
// - 確認モードは見るだけ: requirePortalSession / requirePortalApi が GET 以外を断る（予約の確定・取消・保存・
//   アップロードなど、書き込みは入口で一律に止める）。予約入力の料金の再計算（/book/quote）だけは読み取りなので通す。
// - アクセスログには残さない（取引先の利用状況に運営の確認が混ざらないように）。
import type { Cookies } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { base64url, fromBase64url } from './crypto';

export const PARTNER_PREVIEW_COOKIE = 'rms_partner_preview';
/** 確認モードのセッションのアカウント ID（実在しない nil UUID。DB の検索は何も当たらない） */
export const PREVIEW_ACCOUNT_ID = '00000000-0000-0000-0000-000000000000';
export const PREVIEW_TTL_SECONDS = 2 * 3600;
export const PREVIEW_DENIED_MESSAGE = '管理者の確認モードのため、この操作はできません（予約の確定・取消・保存はできません）。';

const enc = new TextEncoder();

async function signingKey(): Promise<CryptoKey | null> {
  const secret = privateEnv.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!secret) return null;
  return crypto.subtle.importKey('raw', enc.encode(`autumn-book/partner-preview/v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function sign(payload: string): Promise<string | null> {
  const key = await signingKey();
  if (!key) return null;
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payload))));
}

/** 確認モードのクッキーの値（partnerId.期限.署名）。鍵が無い環境では null */
export async function issuePreviewToken(partnerId: string, now = Date.now()): Promise<string | null> {
  const payload = `${partnerId}.${Math.floor(now / 1000) + PREVIEW_TTL_SECONDS}`;
  const sig = await sign(payload);
  return sig ? `${payload}.${sig}` : null;
}

/** この取引先の、期限内で署名の正しい確認モードか */
export async function verifyPreviewToken(token: string | undefined, partnerId: string, now = Date.now()): Promise<boolean> {
  if (!token || token.length > 200) return false;
  const [id, exp, sig] = token.split('.');
  if (!id || !exp || !sig || id !== partnerId) return false;
  if (!/^\d+$/.test(exp) || Number(exp) * 1000 <= now) return false;
  const key = await signingKey();
  if (!key) return false;
  try {
    return await crypto.subtle.verify('HMAC', key, fromBase64url(sig) as Uint8Array<ArrayBuffer>, enc.encode(`${id}.${exp}`));
  } catch {
    return false;
  }
}

export function setPreviewCookie(cookies: Cookies, urlToken: string, token: string) {
  cookies.set(PARTNER_PREVIEW_COOKIE, token, {
    path: `/p/${urlToken}`,
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: PREVIEW_TTL_SECONDS
  });
}

export function clearPreviewCookie(cookies: Cookies, urlToken: string) {
  cookies.delete(PARTNER_PREVIEW_COOKIE, { path: `/p/${urlToken}` });
}
