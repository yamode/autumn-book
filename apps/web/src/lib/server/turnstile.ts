// Cloudflare Turnstile のサーバ側検証（docs/auth-hardening.md §4.2・S2）。
//
// - サイトキー（PUBLIC_TURNSTILE_SITE_KEY・wrangler.jsonc の vars）とシークレット（TURNSTILE_SECRET_KEY・Pages の秘密）が
//   **両方そろっているときだけ**検証する。どちらかが未設定なら検証をスキップして通す（ローカル dev・プレビューを止めない。
//   本番は必ず両方設定する・§12.2）。片方だけだと「画面に部品が無いのに検証する」「部品があるのに検証しない」になるため両方で判定。
// - 検証は siteverify（サーバ間）。remoteip に接続元 IP を付ける。トークンは 1 回限り・5 分有効。
// - siteverify に届かない・タイムアウトのときは通さない（false）。ログインはアカウント単位ロックと KV の制限でも守っている。
import { env } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export const TURNSTILE_RESPONSE_FIELD = 'cf-turnstile-response';
const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** 検証するか（純関数）: サイトキーとシークレットの両方があるときだけ */
export const turnstileConfigured = (siteKey: string | null | undefined, secret: string | null | undefined) =>
  Boolean(String(siteKey ?? '').trim() && String(secret ?? '').trim());

/** siteverify を呼ぶ。success=true のときだけ true */
export async function verifyTurnstile(
  token: string | null | undefined,
  ip: string | null | undefined,
  secret: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const response = String(token ?? '').trim();
  // トークンは最大 2048 文字（Cloudflare の仕様）
  if (!response || response.length > 2048) return false;
  const body = new URLSearchParams({ secret, response });
  if (ip && ip !== 'unknown') body.set('remoteip', ip);
  try {
    const res = await fetchImpl(SITEVERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/**
 * フォームの Turnstile を確かめる（action の冒頭で呼ぶ）。未設定なら skipped で通す。
 * fd: 送られたフォーム（cf-turnstile-response を読む）、ip: requestMeta(event).ip
 */
export async function checkTurnstile(fd: FormData, ip: string | null | undefined): Promise<{ ok: boolean; skipped: boolean }> {
  const secret = env.TURNSTILE_SECRET_KEY ?? '';
  if (!turnstileConfigured(publicEnv.PUBLIC_TURNSTILE_SITE_KEY, secret)) return { ok: true, skipped: true };
  const ok = await verifyTurnstile(String(fd.get(TURNSTILE_RESPONSE_FIELD) ?? ''), ip, secret.trim());
  return { ok, skipped: false };
}

/** 取引先ページ・管理ログインで Turnstile に失敗したときの文言（§4.2） */
export const TURNSTILE_FAILED_MESSAGE = '確認に失敗しました。ページを読み直してください。';
