// 取引先ページのパスキー（WebAuthn）の純関数（docs/auth-hardening.md §6.5・§6.3・§6.8・S6）。
// サーバ（lib/server/partners/passkeys.ts）と画面の両方から使う。DB・Cookie・@simplewebauthn には触らない。
import type { PartnerMfaPolicy } from './partner-mfa';

/** パスキーを使う相手（Relying Party）。rpID はドメイン、origin は https://<ドメイン>（ローカルは http://localhost:<port>） */
export type PasskeyRp = { rpID: string; origin: string };

/**
 * このリクエストのホストでパスキーを使えるか（使えるなら RP を返す・§6.5）。
 *   - ホスト名が PASSKEY_RP_ID（本番 book.yamado.app）と一致し、https のとき → その RP
 *   - ローカル（localhost）→ rpID 'localhost'・origin はいまのオリジン（http://localhost:5173 など）
 *   - それ以外（*.pages.dev のプレビュー・127.0.0.1 など）→ null（登録・認証とも無効。画面にもボタンを出さない）
 * WebAuthn は IP アドレスを rpID にできないので 127.0.0.1 は対象外。
 */
export function passkeyRelyingParty(url: Pick<URL, 'hostname' | 'origin' | 'protocol'>, configuredRpId: string | null | undefined): PasskeyRp | null {
  const host = String(url.hostname ?? '').toLowerCase();
  if (!host) return null;
  if (host === 'localhost') return { rpID: 'localhost', origin: url.origin };
  const rp = String(configuredRpId ?? '').trim().toLowerCase();
  if (!rp || host !== rp || url.protocol !== 'https:') return null;
  return { rpID: rp, origin: `https://${rp}` };
}

/** パスキーの名前（一覧に出す）。入力が空ならブラウザの要約（例「Chrome / Windows」）。60 文字まで */
export function passkeyDeviceName(input: unknown, fallback: string): string {
  const s = String(input ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 60);
  return s || fallback.slice(0, 60) || 'パスキー';
}

/**
 * パスキーを消してよいか（§6.5 の管理）。remainingAfter は消した後に残る数。
 *   - passkey_only で最後の 1 つ → 消せない（消すとログインできなくなる）
 *   - それ以外で最後の 1 つ → 消せるが確認を出す（warn）
 */
export function passkeyRemoval(policy: PartnerMfaPolicy, remainingAfter: number): { ok: boolean; warn: boolean; message: string | null } {
  if (remainingAfter > 0) return { ok: true, warn: false, message: null };
  if (policy === 'passkey_only') {
    return {
      ok: false,
      warn: false,
      message: 'この取引先はパスキーでのログインが必須のため、最後のパスキーは削除できません。先に別のパスキーを追加してください。'
    };
  }
  return {
    ok: true,
    warn: true,
    message: '最後のパスキーです。削除すると、本人確認はメールの認証コードだけになります。'
  };
}

/** パスワード設定リンクから入った直後に、パスキーの初回登録を許す長さ（分）。passkey_only でパスキーが 0 のときだけ（§6.8） */
export const PASSKEY_BOOTSTRAP_MINUTES = 30;

/** パスワード設定リンクから入ったセッションの印（rms_partner_sessions.mfa_method・aal は 1 のまま） */
export const MFA_SETUP_MARK = 'setup';

/**
 * 本人確認（aal2）なしでパスキーを登録してよいか（§6.8「passkey_only でパスキー 0」の復旧）。
 * passkey_only はメールの認証コードに落とせないため、パスキーが 1 つも無いアカウントは本人確認の手段が無い。
 * そこで「宿・マスタが発行したパスワード設定リンク（＝本人のメールに届いたもの）から入った直後 30 分」だけ、最初の 1 つを登録できる。
 * 登録した後は、そのパスキーで本人確認してから使う（登録だけでは aal2 にしない）。
 */
export function canBootstrapPasskey(
  args: { policy: PartnerMfaPolicy; passkeyCount: number; mfaMethod: string | null | undefined; sessionCreatedAt: string | null | undefined },
  now = Date.now()
): boolean {
  if (args.policy !== 'passkey_only' || args.passkeyCount > 0 || args.mfaMethod !== MFA_SETUP_MARK) return false;
  const at = Date.parse(String(args.sessionCreatedAt ?? ''));
  if (!Number.isFinite(at) || at - now > 5 * 60_000) return false;
  return now - at < PASSKEY_BOOTSTRAP_MINUTES * 60_000;
}

/**
 * マスタユーザーが取引先ページから本人確認の方針を変えてよいか（§6.3）。厳しくする方向（step_up → always）だけ。
 * 緩める方向・パスキーのみへの変更は宿（管理画面）だけ。
 */
export function masterCanChangeMfaPolicy(from: PartnerMfaPolicy, to: PartnerMfaPolicy): boolean {
  return from === 'step_up' && to === 'always';
}

/** 方針の説明（管理画面・セキュリティタブ） */
export const PARTNER_MFA_POLICY_HELP: Record<PartnerMfaPolicy, string> = {
  step_up: 'カードの登録・保存済みカードでのご予約・ユーザー管理などの前と、新しい環境からのログインのときだけ本人確認（メールの認証コードまたはパスキー）を求めます。',
  always: 'ログインのたびに本人確認（メールの認証コードまたはパスキー）を求めます。',
  passkey_only: 'ログインのたびにパスキーでの本人確認を求めます（メールの認証コードは使えません）。パスキーを登録していないユーザーはログインできません。'
};

/** 「1人1ID」の案内（ログイン画面・セキュリティ・ユーザー管理・設定メール共通の文言・§6.5） */
export const ONE_PERSON_ONE_ID_NOTICE =
  'パスキーはご利用の端末（または Apple / Google アカウント）に保存されます。ログインIDは 1 人につき 1 つ発行してください（複数名で 1 つの ID を共有すると、パスキーの登録・紛失時の復旧ができず、操作の記録も個人に紐づきません）。ユーザーの追加は「アカウント」→「ユーザー管理」から 30 名まで無料で行えます。';

/**
 * ログイン用のチャレンジ（rms_partner_mfa_challenges・セッション無し）が、この限定URLの取引先のものか。
 * ログイン用は account_id が null で partner_id を持つ（autumn-shared 20261009215711）。本人用（account_id あり）は使わせない。
 */
export function loginChallengeMatches(row: { account_id: string | null; partner_id: string | null } | null, partnerId: string): boolean {
  return Boolean(row && partnerId && row.account_id === null && row.partner_id === partnerId);
}

/** credential_id（base64url）として受け付ける形か。長さは WebAuthn の上限（1023 バイト）を base64url にした程度まで */
export function isCredentialId(v: unknown): v is string {
  return typeof v === 'string' && v.length >= 16 && v.length <= 1400 && /^[A-Za-z0-9_-]+$/.test(v);
}

/** ブラウザ（@simplewebauthn/browser）の失敗を画面の文言にする */
export function passkeyErrorMessage(e: unknown, mode: 'register' | 'auth'): string {
  const name = (e as { name?: string } | null)?.name ?? '';
  const code = (e as { code?: string } | null)?.code ?? '';
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError') return 'このパスキーは既に登録されています。';
  if (name === 'NotAllowedError' || name === 'AbortError' || code === 'ERROR_CEREMONY_ABORTED') {
    return mode === 'register' ? 'パスキーの登録を取りやめました（または時間切れになりました）。' : 'パスキーでの確認を取りやめました（または時間切れになりました）。';
  }
  if (name === 'SecurityError' || code === 'ERROR_INVALID_DOMAIN' || code === 'ERROR_INVALID_RP_ID') return 'このページのアドレスではパスキーを使えません。';
  if (name === 'NotSupportedError') return 'このブラウザ・端末ではパスキーを使えません。';
  return mode === 'register' ? 'パスキーを登録できませんでした。' : 'パスキーで確認できませんでした。';
}
