// 取引先ログインの第1段階（docs/auth-hardening.md §4・S2）の純関数。
// サーバ（store.ts・portal.ts）と画面（アカウント → セキュリティ、管理画面のアクセスログ）の両方から使う。

/** セッションの期限: 発行から 7 日 */
export const PARTNER_SESSION_TTL_HOURS = 24 * 7;
/** セッションの期限: 最終アクセスから 24 時間（M3: 7 日 or 最終アクセスから 24 時間の早い方） */
export const PARTNER_SESSION_IDLE_HOURS = 24;
/** 新しい環境の判定で振り返る長さ（日） */
export const NEW_ENVIRONMENT_LOOKBACK_DAYS = 90;

/**
 * セッションが生きているか（M3）。
 * 発行から 7 日（expires_at）を過ぎたか、最終アクセス（last_seen_at）から 24 時間を過ぎたら切れ。
 * last_seen_at は 5 分に 1 回しか更新しないので、実際のアイドル許容は最大 5 分ほど短くなる（安全側）。
 */
export function isPartnerSessionAlive(
  s: { expires_at: string; last_seen_at?: string | null; created_at?: string | null },
  now = Date.now()
): boolean {
  const exp = Date.parse(s.expires_at);
  if (!Number.isFinite(exp) || exp <= now) return false;
  const seen = Date.parse(String(s.last_seen_at ?? s.created_at ?? ''));
  // 最終アクセスが読めない行は発行から 7 日だけで判断する（古い行を一斉に切らない）
  if (!Number.isFinite(seen)) return true;
  return now - seen < PARTNER_SESSION_IDLE_HOURS * 3600_000;
}

export type LoginHistoryEntry = { deviceId: string | null; ip: string | null };

/**
 * 新しい環境からのログインか（§4.3）。
 * 直近の履歴に「同じ端末（device_id）」も「同じ IP」も無いときだけ true。
 * IP だけ変わる（モバイル回線の切替）は頻発するので、端末が一致すれば新しい環境とはみなさない。
 * 履歴が空（初めてのログイン）も true。
 */
export function isNewEnvironment(history: readonly LoginHistoryEntry[], deviceId: string | null, ip: string | null): boolean {
  const sameDevice = Boolean(deviceId) && history.some((h) => h.deviceId && h.deviceId === deviceId);
  if (sameDevice) return false;
  const sameIp = Boolean(ip) && history.some((h) => h.ip && h.ip === ip);
  return !sameIp;
}

/** ユーザーエージェントを「ブラウザ / OS」に縮める（通知メール・端末一覧の表示用）。分からなければ「不明なブラウザ」 */
export function summarizeUserAgent(ua: string | null | undefined): string {
  const s = String(ua ?? '');
  if (!s.trim()) return '不明なブラウザ';
  const browser = /Edg(e|A|iOS)?\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /SamsungBrowser\//.test(s)
        ? 'Samsung Internet'
        : /Firefox\/|FxiOS\//.test(s)
          ? 'Firefox'
          : /Chrome\/|CriOS\//.test(s)
            ? 'Chrome'
            : /Safari\//.test(s)
              ? 'Safari'
              : null;
  const os = /iPhone/.test(s)
    ? 'iPhone'
    : /iPad/.test(s)
      ? 'iPad'
      : /Android/.test(s)
        ? 'Android'
        : /Windows/.test(s)
          ? 'Windows'
          : /Mac OS X|Macintosh/.test(s)
            ? 'Mac'
            : /CrOS/.test(s)
              ? 'ChromeOS'
              : /Linux/.test(s)
                ? 'Linux'
                : null;
  if (!browser && !os) return 'その他のブラウザ';
  return [browser ?? 'ブラウザ', os].filter(Boolean).join(' / ');
}

/** アカウント → セキュリティに出すログの種類（§4.4。本人確認の mfa_* と email_change は S3。passkey_* は S6 で足す） */
export const SECURITY_LOG_ACTIONS = [
  'login',
  'login_failed',
  'login_locked',
  'login_rate_limited',
  'login_new_device',
  'password_set',
  'logout',
  'logout_others',
  'logout_session',
  // 本人確認（S3）
  'mfa_sent',
  'mfa_ok',
  'mfa_failed',
  'mfa_locked',
  'email_change'
] as const;

/** アクセスログの表示名（取引先ページのセキュリティ・管理画面のアクセスログ共通） */
export const LOGIN_LOG_LABELS: Record<string, string> = {
  login: 'ログイン',
  login_failed: 'ログイン失敗',
  login_locked: 'ロック中のログイン',
  login_rate_limited: 'ログイン制限中の試行',
  login_new_device: '新しい環境からのログイン',
  password_set: 'パスワード設定',
  logout: 'ログアウト',
  logout_others: '他の端末をログアウト',
  logout_session: '端末をログアウト',
  child_logout_all: 'ユーザーの全端末をログアウト',
  mfa_sent: '認証コードの送信',
  mfa_ok: '本人確認',
  mfa_failed: '認証コードの誤り',
  mfa_locked: '認証コードの誤りが続いたため停止',
  email_change: 'メールアドレスの変更'
};

/** JST の日時（通知メール用） */
export const formatJst = (d: Date) =>
  d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
