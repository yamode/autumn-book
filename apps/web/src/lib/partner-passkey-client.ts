// 取引先ページのパスキー（ブラウザ側・docs/auth-hardening.md §6.5・S6）。@simplewebauthn/browser の薄い包み。
// ライブラリはパスキーを使うときだけ読み込む（動的 import）。サーバとのやり取りは JSON（{ challengeId, options } → 応答）。
import { passkeyErrorMessage } from './partner-passkey';

type Json = Record<string, unknown> | null;

async function postJson(url: string, body: unknown): Promise<{ status: number; json: Json }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  return { status: res.status, json: (await res.json().catch(() => null)) as Json };
}

const lib = () => import('@simplewebauthn/browser');

/** このブラウザでパスキー（WebAuthn）を使えるか */
export async function passkeySupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    return (await lib()).browserSupportsWebAuthn();
  } catch {
    return false;
  }
}

export type PasskeyResult = { ok: true; data?: Json } | { ok: false; message: string; status?: number; data?: Json };

/** パスキーを登録する（アカウント → セキュリティ・/mfa の初回登録）。403 mfa_required のときは data.next に /mfa の URL */
export async function registerPasskey(token: string, name: string): Promise<PasskeyResult> {
  const opt = await postJson(`/p/${token}/account/security/passkey/options`, {});
  if (!opt.json?.ok) return { ok: false, status: opt.status, data: opt.json, message: String(opt.json?.message ?? 'パスキーを登録できませんでした。') };
  let response;
  try {
    const { startRegistration } = await lib();
    response = await startRegistration({ optionsJSON: opt.json.options as never });
  } catch (e) {
    return { ok: false, message: passkeyErrorMessage(e, 'register') };
  }
  const v = await postJson(`/p/${token}/account/security/passkey/verify`, { challengeId: opt.json.challengeId, response, name });
  if (!v.json?.ok) return { ok: false, status: v.status, data: v.json, message: String(v.json?.message ?? 'パスキーを登録できませんでした。') };
  return { ok: true, data: v.json };
}

/** 本人確認（ステップアップ）をパスキーで行う。通ればセッションが aal2 になる */
export async function stepUpWithPasskey(token: string): Promise<PasskeyResult> {
  const opt = await postJson(`/p/${token}/mfa/passkey/options`, {});
  if (opt.status === 401) return { ok: false, status: 401, message: 'ログインの有効期限が切れました。' };
  if (!opt.json?.ok) return { ok: false, status: opt.status, message: String(opt.json?.message ?? 'パスキーで確認できませんでした。') };
  let response;
  try {
    const { startAuthentication } = await lib();
    response = await startAuthentication({ optionsJSON: opt.json.options as never });
  } catch (e) {
    return { ok: false, message: passkeyErrorMessage(e, 'auth') };
  }
  const v = await postJson(`/p/${token}/mfa/passkey/verify`, { challengeId: opt.json.challengeId, response });
  if (!v.json?.ok) return { ok: false, status: v.status, message: String(v.json?.message ?? 'パスキーで確認できませんでした。') };
  return { ok: true };
}

/**
 * パスキーでログインする（ログイン画面）。autofill=true は Conditional UI（ログインID欄の候補から選ぶ・選ばれるまで待つ）。
 * 成功すれば data.next（料金カレンダー）。取りやめ（別の操作で中断）は message 空で返す。
 */
export async function loginWithPasskey(token: string, opts: { autofill?: boolean } = {}): Promise<PasskeyResult> {
  const { startAuthentication, browserSupportsWebAuthnAutofill } = await lib();
  if (opts.autofill && !(await browserSupportsWebAuthnAutofill().catch(() => false))) return { ok: false, message: '' };
  const opt = await postJson(`/p/${token}/passkey/login/options`, {});
  if (!opt.json?.ok) return { ok: false, status: opt.status, message: opts.autofill ? '' : String(opt.json?.message ?? 'パスキーでログインできませんでした。') };
  let response;
  try {
    response = await startAuthentication({ optionsJSON: opt.json.options as never, useBrowserAutofill: Boolean(opts.autofill) });
  } catch (e) {
    // Conditional UI はボタンを押したとき・画面を離れたときに中断される（文言は出さない）
    if (opts.autofill) return { ok: false, message: '' };
    return { ok: false, message: passkeyErrorMessage(e, 'auth') };
  }
  const v = await postJson(`/p/${token}/passkey/login/verify`, { challengeId: opt.json.challengeId, response });
  if (!v.json?.ok) return { ok: false, status: v.status, message: String(v.json?.message ?? 'パスキーでログインできませんでした。') };
  return { ok: true, data: v.json };
}
