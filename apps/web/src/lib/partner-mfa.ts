// 取引先ページのステップアップ（第2要素）と メール OTP の純関数（docs/auth-hardening.md §5.2・§6.2〜6.4・S3）。
// サーバ（lib/server/partners/mfa.ts・portal.ts・store.ts）と画面の両方から使う。DB・Cookie には触らない。
//
// 用語:
//   aal … セッションの保証レベル。1 = パスワードだけ、2 = 第2要素済み（rms_partner_sessions.aal）
//   mfa_at … 第2要素を通した時刻。aal2 は mfa_at から 12 時間だけ有効
//   mfa_method … 'email'（初版はメール OTP のみ・パスキーは S6）。
//     'required' は「ログイン直後に本人確認が要る（まだ済んでいない）」の印（aal=1 のときだけ意味を持つ・§6.2 の 2・3 と always）

export type PartnerMfaPolicy = 'step_up' | 'always' | 'passkey_only';
export const PARTNER_MFA_POLICIES: readonly PartnerMfaPolicy[] = ['step_up', 'always', 'passkey_only'];

export const PARTNER_MFA_POLICY_LABELS: Record<PartnerMfaPolicy, string> = {
  step_up: '重要な操作の前だけ（標準）',
  always: 'ログインのたびに',
  passkey_only: 'パスキーのみ'
};

/** DB の値を方針に揃える（不明・null は既定の step_up・M6） */
export function normalizeMfaPolicy(v: unknown): PartnerMfaPolicy {
  return PARTNER_MFA_POLICIES.includes(v as PartnerMfaPolicy) ? (v as PartnerMfaPolicy) : 'step_up';
}

/** aal2 の有効期間（mfa_at から・§5.2） */
export const MFA_AAL2_HOURS = 12;
/** 前回の本人確認からこれだけ空いたら、ログイン直後に求める（§6.2 の 3） */
export const MFA_REVERIFY_DAYS = 30;
/** メール OTP: 有効 10 分・1 チャレンジ 5 回まで・再送は 60 秒に 1 回・1 時間に 5 通（§6.4） */
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_SECONDS = 60;
export const OTP_HOURLY_MAX = 5;
export const OTP_LENGTH = 6;

/** ログイン直後の本人確認待ちの印（rms_partner_sessions.mfa_method） */
export const MFA_PENDING_MARK = 'required';

export type SessionAal = { aal?: number | null; mfaAt?: string | null; mfaMethod?: string | null; preview?: boolean };

/** aal2 が今も有効か（aal=2 かつ mfa_at から 12 時間以内） */
export function isAal2Valid(s: SessionAal, now = Date.now()): boolean {
  if (s.aal !== 2 || !s.mfaAt) return false;
  const at = Date.parse(s.mfaAt);
  if (!Number.isFinite(at)) return false;
  // 未来の時刻（時計のずれ）は 5 分まで許す
  if (at - now > 5 * 60_000) return false;
  return now - at < MFA_AAL2_HOURS * 3600_000;
}

/**
 * 取引先ページ全体の関所（requirePortalSession / requirePortalApi）: 本人確認が済むまで /mfa 以外を使わせないか。
 *   - ログイン直後の印（mfa_method='required'・aal1）が付いている → true
 *   - 方針が always / passkey_only で aal2 が有効でない → true（12 時間で切れたら再び求める）
 *   - 確認モード（管理画面からの閲覧）は対象外
 */
export function portalMfaGate(s: SessionAal, policy: PartnerMfaPolicy, now = Date.now()): boolean {
  if (s.preview) return false;
  if (s.mfaMethod === MFA_PENDING_MARK && s.aal !== 2) return true;
  if (policy === 'always' || policy === 'passkey_only') return !isAal2Valid(s, now);
  return false;
}

export type LoginStepUpReason = 'always' | 'new_environment' | 'reverify';

/**
 * ログインの直後に本人確認（/mfa）を求めるか（§6.2）。求めない → null。
 *   - always / passkey_only: 毎回（メールが無くても求める＝/mfa でメールの登録を案内する）
 *   - step_up: メールがあるときだけ、新しい環境（端末も IP も初見）か、前回の本人確認から 30 日以上
 *     （一度も本人確認していない＝lastMfaAt が null は「30 日」に数えない。配備直後に全員へ一斉に求めないため）
 */
export function loginStepUpReason(
  args: { policy: PartnerMfaPolicy; newEnvironment: boolean; hasEmail: boolean; lastMfaAt: string | null },
  now = Date.now()
): LoginStepUpReason | null {
  if (args.policy === 'always' || args.policy === 'passkey_only') return 'always';
  if (!args.hasEmail) return null;
  if (args.newEnvironment) return 'new_environment';
  const last = args.lastMfaAt ? Date.parse(args.lastMfaAt) : NaN;
  if (Number.isFinite(last) && now - last >= MFA_REVERIFY_DAYS * 86400_000) return 'reverify';
  return null;
}

/** 使える本人確認の方法（初版はメール OTP のみ。パスキーは S6 で足す）。passkey_only はメールに落とさない */
export type MfaMethod = 'email' | 'passkey';
export function mfaMethodsFor(policy: PartnerMfaPolicy, account: { email?: string | null }, passkeyCount = 0): MfaMethod[] {
  const methods: MfaMethod[] = [];
  if (passkeyCount > 0) methods.push('passkey');
  if (policy !== 'passkey_only' && String(account.email ?? '').trim()) methods.push('email');
  return methods;
}

/** 入力されたコードを揃える（全角数字・空白・ハイフンを許す）。6 桁の数字でなければ null */
export function normalizeOtp(input: unknown): string | null {
  const s = String(input ?? '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-－ー]/g, '');
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(s) ? s : null;
}

/** コードの入力の問題（画面の文言）。問題なければ null */
export function otpProblem(input: unknown): string | null {
  if (!String(input ?? '').trim()) return '認証コードを入力してください。';
  return normalizeOtp(input) ? null : `認証コードは${OTP_LENGTH}桁の数字です。`;
}

/** 6 桁のコードを作る（先頭 0 可・偏りなし）。rand は 32bit 符号なし整数を返すもの（既定は crypto.getRandomValues） */
export function generateOtp(rand: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]): string {
  const range = 10 ** OTP_LENGTH;
  // 2^32 を range で割り切れる範囲だけ使う（剰余の偏りを避ける）
  const limit = Math.floor(0x1_0000_0000 / range) * range;
  for (let i = 0; i < 100; i += 1) {
    const r = rand() >>> 0;
    if (r < limit) return String(r % range).padStart(OTP_LENGTH, '0');
  }
  throw new Error('認証コードを作れませんでした');
}

/** 同じ長さの文字列を時間一定で比べる（ハッシュの比較用） */
export function timingSafeEqualText(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export type OtpChallengeLike = { created_at: string; expires_at: string; attempts: number; used_at: string | null };

/**
 * 次のコードを送れるまでの秒数（0 = 今すぐ送れる）。challenges はそのアカウントのメールのチャレンジ（新しい順・直近 1 時間以上を含む）。
 *   - 直近 1 時間に 5 通 → 一番古いものが 1 時間を過ぎるまで
 *   - 最後の送信から 60 秒
 *   - 試行の上限で止めた（attempts が上限・expires_at を止めた時刻にしている）ものは、止めてから 60 秒
 */
export function otpResendWaitSeconds(challenges: readonly OtpChallengeLike[], now = Date.now()): number {
  const hourAgo = now - 3600_000;
  const recent = challenges.map((c) => ({ ...c, at: Date.parse(c.created_at) })).filter((c) => Number.isFinite(c.at) && c.at > hourAgo);
  let wait = 0;
  if (recent.length >= OTP_HOURLY_MAX) {
    const oldest = Math.min(...recent.map((c) => c.at));
    wait = Math.max(wait, oldest + 3600_000 - now);
  }
  const latest = challenges[0];
  if (latest) {
    const at = Date.parse(latest.created_at);
    if (Number.isFinite(at)) wait = Math.max(wait, at + OTP_RESEND_SECONDS * 1000 - now);
    if (latest.attempts >= OTP_MAX_ATTEMPTS && !latest.used_at) {
      const lockedAt = Date.parse(latest.expires_at);
      if (Number.isFinite(lockedAt)) wait = Math.max(wait, lockedAt + OTP_RESEND_SECONDS * 1000 - now);
    }
  }
  return Math.max(0, Math.ceil(wait / 1000));
}

/** チャレンジが入力を受け付けられる状態か（未使用・期限内・試行の上限前） */
export function otpChallengeState(c: OtpChallengeLike | null, now = Date.now()): 'open' | 'expired' | 'locked' | 'used' | 'none' {
  if (!c) return 'none';
  if (c.used_at) return 'used';
  if (c.attempts >= OTP_MAX_ATTEMPTS) return 'locked';
  const exp = Date.parse(c.expires_at);
  if (!Number.isFinite(exp) || exp <= now) return 'expired';
  return 'open';
}

/** メールアドレスを伏せる（ab***@example.com）。ログ・画面の表示用 */
export function maskEmail(email: string | null | undefined): string {
  const s = String(email ?? '').trim();
  const at = s.lastIndexOf('@');
  if (at < 1) return s ? '***' : '';
  const local = s.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${s.slice(at)}`;
}

/**
 * /mfa から戻る先（純関数）。next は戻りたいページ（パス＋クエリ）。
 * /p/<token> の中のパスだけ（外・別トークン・不正な値は料金カレンダーへ）。/mfa 自身・ログアウト・ログイン画面も料金カレンダーへ。
 */
export function safePortalNext(token: string, next: string | null | undefined): string {
  const base = `/p/${token}`;
  const fallback = `${base}/calendar`;
  const raw = String(next ?? '').trim();
  // スキーム相対（//evil）・バックスラッシュは最初から断る
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  let u: URL;
  try {
    u = new URL(raw, 'http://portal.invalid');
  } catch {
    return fallback;
  }
  if (u.origin !== 'http://portal.invalid' || !u.pathname.startsWith(`${base}/`)) return fallback;
  const rest = u.pathname.slice(base.length);
  if (/^\/(mfa|logout|setup)(\/|$)/.test(rest)) return fallback;
  return `${u.pathname}${u.search}`;
}

/** /mfa の URL（戻り先つき） */
export const portalMfaUrl = (token: string, next: string) => `/p/${token}/mfa?next=${encodeURIComponent(safePortalNext(token, next))}`;

/** JSON API が本人確認を求めるときの応答の形（403） */
export type MfaRequiredBody = { ok: false; code: 'mfa_required'; message: string; next: string };
export const MFA_REQUIRED_MESSAGE = 'この操作には本人確認（メールの認証コード）が必要です。';
