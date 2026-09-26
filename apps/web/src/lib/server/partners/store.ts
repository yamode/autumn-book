// 取引先ポータル（特別レートの限定公開）の DB 読み書き。autumn-rms から移設（2026-09-26）。
//
// 取引先関連の表（rms_partner_*）は RLS で service_role 以外を拒否しているため、読み書きはすべて
// service_role クライアント（./admin-client.ts・取引先モジュール専用）で行う。service_role は RLS を
// バイパスするので、入口の検証が命綱:
//   - 限定URLのトークン → 取引先、クッキーのセッション → その取引先のアカウント、
//     API キー → 取引先、の順に必ず結び付きを確かめてから読む。
//   - 取引先の施設は Book が扱う施設（FACILITY_UUID）に限る。
// 取引先・アカウント・API キーの発行や設定（スタッフ用の機能）は autumn-rms に残している。
// 表名・cookie 名・API キーの接頭辞（rms_ / rmsp_）は既存データと発行済みのキーをそのまま使うため変えない。
import type { SupabaseClient } from '@supabase/supabase-js';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { normalizePartnerPricing, type PartnerPricing } from '$lib/partner-pricing';
import { normalizePartnerBookingSettings, type PartnerBookingSettings } from '$lib/partner-booking';
import { partnerServiceClient } from './admin-client';
import { randomToken, sha256Hex, verifyPassword, hashPassword } from './crypto';

export type PartnerKind = 'agent' | 'corporate' | 'other';
export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = {
  agent: '旅行会社・エージェント',
  corporate: '法人',
  other: 'その他'
};

export type PartnerRow = {
  id: string;
  tenant_id: string;
  facility_id: string;
  name: string;
  kind: PartnerKind;
  contact_name: string | null;
  contact_email: string | null;
  url_token: string;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  max_days_ahead: number;
  show_inventory: boolean;
  include_advance: boolean;
  pricing: PartnerPricing;
  note: string | null;
  // 予約受付（migration 20260926054852）
  booking_enabled: boolean;
  booking_settings: PartnerBookingSettings;
  payment_method_id: string | null;
  created_at: string;
  updated_at: string;
};

export type PartnerAccountRow = {
  id: string;
  partner_id: string;
  login_id: string;
  display_name: string | null;
  email: string | null;
  password_hash: string | null;
  password_set_at: string | null;
  setup_token_expires_at: string | null;
  failed_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  is_active: boolean;
  created_at: string;
};

export type PartnerApiKeyRow = {
  id: string;
  partner_id: string;
  label: string | null;
  key_prefix: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type PartnerAccessLogRow = {
  id: number;
  account_id: string | null;
  api_key_id: string | null;
  channel: 'web' | 'api';
  action: string;
  detail: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

// 公開期間などを見て「いま見せてよいか」を判定するための最小情報。
export type PartnerContext = PartnerRow & { facility_slug: string; facility_name: string };

export const SETUP_TOKEN_TTL_HOURS = 24 * 7;
export const SESSION_TTL_HOURS = 24 * 7;
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
export const API_KEY_PREFIX = 'rmsp_';

export class PartnerStoreError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'bad_request'
  ) {
    super(message);
  }
}

// service_role クライアント（SUPABASE_SERVICE_ROLE_KEY 未設定なら null → 呼び出し側で 503）。
export function partnerAdminClient(): SupabaseClient | null {
  return partnerServiceClient();
}

// Book が扱う施設（core.facilities の UUID）か。取引先の facility_id はこの範囲に限る。
const BOOK_FACILITY_IDS = new Set(Object.values(FACILITY_UUID));
export const isBookFacility = (facilityId: string) => BOOK_FACILITY_IDS.has(facilityId);

// 表が無い（migration 未適用）ときの PostgREST / Postgres のエラーか。
export function isMissingTableError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|does not exist/i.test(error.message ?? '');
}

function raise(error: { code?: string; message?: string } | null, fallback: string): never {
  if (isMissingTableError(error)) {
    throw new PartnerStoreError('取引先ポータルの DB（autumn-shared migration 20260926025319）が未適用です。', 503, 'migration_missing');
  }
  throw new PartnerStoreError(`${fallback}${error?.message ? `（${error.message}）` : ''}`, 500, 'db_error');
}

const PARTNER_COLUMNS =
  'id, tenant_id, facility_id, name, kind, contact_name, contact_email, url_token, is_active, valid_from, valid_until, max_days_ahead, show_inventory, include_advance, pricing, note, booking_enabled, booking_settings, payment_method_id, created_at, updated_at';
const ACCOUNT_COLUMNS =
  'id, partner_id, login_id, display_name, email, password_hash, password_set_at, setup_token_expires_at, failed_attempts, locked_until, last_login_at, is_active, created_at';

function toPartner(row: Record<string, unknown>): PartnerRow {
  return {
    ...(row as unknown as PartnerRow),
    pricing: normalizePartnerPricing(row.pricing),
    booking_enabled: row.booking_enabled === true,
    booking_settings: normalizePartnerBookingSettings(row.booking_settings),
    payment_method_id: (row.payment_method_id as string | null) ?? null
  };
}

// ---- 日付（JST） ----

export const todayJst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
export const addDaysIso = (iso: string, days: number) =>
  new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

// 取引先に「いま」料金を見せてよいか。だめなら理由を返す。
export function partnerUnavailableReason(p: Pick<PartnerRow, 'is_active' | 'valid_from' | 'valid_until'>, today = todayJst()): string | null {
  if (!p.is_active) return 'この料金カレンダーは現在公開を停止しています。';
  if (p.valid_from && today < p.valid_from) return `この料金カレンダーの公開は ${p.valid_from} からです。`;
  if (p.valid_until && today > p.valid_until) return 'この料金カレンダーの公開期間は終了しました。';
  return null;
}

// ============================================================================
// 取引先側（限定URL・API）
// ============================================================================

async function withFacility(db: SupabaseClient, row: Record<string, unknown>): Promise<PartnerContext | null> {
  const partner = toPartner(row);
  // Book が扱っていない施設の取引先は「見つからない」扱い（別施設の料金・予約を出さない）。
  if (!isBookFacility(partner.facility_id)) return null;
  const { data } = await db.schema('core').from('facilities').select('slug, name').eq('id', partner.facility_id).maybeSingle();
  if (!data?.slug) return null;
  return { ...partner, facility_slug: String(data.slug), facility_name: String(data.name ?? data.slug) };
}

// 限定URLのトークンから取引先を引く。無ければ null（存在の有無は取引先に区別させない）。
export async function findPartnerByUrlToken(db: SupabaseClient, urlToken: string): Promise<PartnerContext | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(urlToken)) return null;
  const { data, error } = await db.from('rms_partners').select(PARTNER_COLUMNS).eq('url_token', urlToken).maybeSingle();
  if (error) raise(error, '取引先を読み込めませんでした。');
  return data ? withFacility(db, data) : null;
}

export type RequestMeta = { ip: string | null; userAgent: string | null };

export async function logPartnerAccess(
  db: SupabaseClient,
  entry: {
    partnerId: string;
    accountId?: string | null;
    apiKeyId?: string | null;
    channel: 'web' | 'api';
    action: string;
    detail?: Record<string, unknown>;
    ip?: string | null;
  }
) {
  // 記録の失敗で閲覧を止めない。
  await db
    .from('rms_partner_access_logs')
    .insert({
      partner_id: entry.partnerId,
      account_id: entry.accountId ?? null,
      api_key_id: entry.apiKeyId ?? null,
      channel: entry.channel,
      action: entry.action,
      detail: entry.detail ?? null,
      ip: entry.ip ?? null
    })
    .then(
      () => undefined,
      () => undefined
    );
}

async function startSession(db: SupabaseClient, accountId: string, meta: RequestMeta): Promise<string> {
  const token = randomToken(32);
  const { error } = await db.from('rms_partner_sessions').insert({
    account_id: accountId,
    token_hash: await sha256Hex(token),
    expires_at: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString(),
    user_agent: meta.userAgent?.slice(0, 300) ?? null,
    ip: meta.ip
  });
  if (error) raise(error, 'ログインできませんでした。');
  // 期限切れセッションの掃除（ついでに・失敗は無視）。
  await db.from('rms_partner_sessions').delete().lt('expires_at', new Date().toISOString()).then(
    () => undefined,
    () => undefined
  );
  return token;
}

export type LoginResult = { ok: true; sessionToken: string } | { ok: false; message: string };

const GENERIC_LOGIN_ERROR = 'ログインIDまたはパスワードが違います。';

export async function loginPartner(
  db: SupabaseClient,
  partner: PartnerContext,
  loginId: string,
  password: string,
  meta: RequestMeta
): Promise<LoginResult> {
  const { data, error } = await db
    .from('rms_partner_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('partner_id', partner.id)
    .eq('login_id', loginId.trim().toLowerCase())
    .maybeSingle();
  if (error) raise(error, 'ログインできませんでした。');
  const account = data as PartnerAccountRow | null;

  // 該当なしでも同じ計算をして、応答時間でアカウントの有無が分からないようにする。
  const passwordOk = await verifyPassword(password, account?.password_hash);
  if (!account || !account.is_active || !account.password_hash) {
    await logPartnerAccess(db, { partnerId: partner.id, channel: 'web', action: 'login_failed', detail: { loginId: loginId.slice(0, 64) }, ip: meta.ip });
    return { ok: false, message: GENERIC_LOGIN_ERROR };
  }
  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'login_locked', ip: meta.ip });
    return { ok: false, message: `ログインの失敗が続いたため、一時的にロックしています。${LOCK_MINUTES}分ほどおいてからお試しください。` };
  }
  if (!passwordOk) {
    const attempts = account.failed_attempts + 1;
    const lock = attempts >= MAX_FAILED_ATTEMPTS;
    await db
      .from('rms_partner_accounts')
      .update({
        failed_attempts: lock ? 0 : attempts,
        locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : account.locked_until
      })
      .eq('id', account.id);
    await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'login_failed', detail: { locked: lock }, ip: meta.ip });
    return { ok: false, message: GENERIC_LOGIN_ERROR };
  }

  await db
    .from('rms_partner_accounts')
    .update({ failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() })
    .eq('id', account.id);
  const sessionToken = await startSession(db, account.id, meta);
  await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'login', ip: meta.ip });
  return { ok: true, sessionToken };
}

export type PartnerSessionAccount = Pick<PartnerAccountRow, 'id' | 'login_id' | 'display_name'> & { sessionId: string };

// クッキーのセッションから、この取引先のアカウントを引く。別の取引先のセッションは通さない。
export async function getPartnerSession(
  db: SupabaseClient,
  partner: PartnerContext,
  sessionToken: string | undefined
): Promise<PartnerSessionAccount | null> {
  if (!sessionToken) return null;
  const { data } = await db
    .from('rms_partner_sessions')
    .select('id, expires_at, last_seen_at, account:rms_partner_accounts!inner(id, partner_id, login_id, display_name, is_active)')
    .eq('token_hash', await sha256Hex(sessionToken))
    .maybeSingle();
  const row = data as
    | {
        id: string;
        expires_at: string;
        last_seen_at: string;
        account: { id: string; partner_id: string; login_id: string; display_name: string | null; is_active: boolean };
      }
    | null;
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (row.account.partner_id !== partner.id || !row.account.is_active) return null;
  // 最終アクセスの更新は5分に1回まで（毎リクエスト書き込まない）。
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    await db.from('rms_partner_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', row.id);
  }
  return { id: row.account.id, login_id: row.account.login_id, display_name: row.account.display_name, sessionId: row.id };
}

export async function endPartnerSession(db: SupabaseClient, sessionToken: string | undefined) {
  if (!sessionToken) return;
  await db.from('rms_partner_sessions').delete().eq('token_hash', await sha256Hex(sessionToken));
}

// パスワード設定リンクのトークンから、この取引先のアカウントを引く（期限切れは null）。
export async function findAccountBySetupToken(
  db: SupabaseClient,
  partner: PartnerContext,
  setupToken: string
): Promise<PartnerAccountRow | null> {
  if (!setupToken || setupToken.length > 128) return null;
  const { data } = await db
    .from('rms_partner_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('setup_token_hash', await sha256Hex(setupToken))
    .eq('partner_id', partner.id)
    .maybeSingle();
  const account = data as PartnerAccountRow | null;
  if (!account || !account.is_active) return null;
  if (!account.setup_token_expires_at || new Date(account.setup_token_expires_at).getTime() <= Date.now()) return null;
  return account;
}

// パスワードを設定し、既存セッションを切って新しいセッションを返す（設定後そのままログイン）。
export async function setPartnerPassword(
  db: SupabaseClient,
  partner: PartnerContext,
  account: PartnerAccountRow,
  password: string,
  meta: RequestMeta
): Promise<string> {
  const { error } = await db
    .from('rms_partner_accounts')
    .update({
      password_hash: await hashPassword(password),
      password_set_at: new Date().toISOString(),
      setup_token_hash: null,
      setup_token_expires_at: null,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: new Date().toISOString()
    })
    .eq('id', account.id)
    .eq('partner_id', partner.id);
  if (error) raise(error, 'パスワードを設定できませんでした。');
  await db.from('rms_partner_sessions').delete().eq('account_id', account.id);
  const sessionToken = await startSession(db, account.id, meta);
  await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'password_set', ip: meta.ip });
  return sessionToken;
}

// API キー（Authorization: Bearer）から取引先を引く。無効・取り消し済みは null。
export async function findPartnerByApiKey(
  db: SupabaseClient,
  apiKey: string
): Promise<{ partner: PartnerContext; apiKeyId: string } | null> {
  if (!apiKey.startsWith(API_KEY_PREFIX) || apiKey.length > 128) return null;
  const { data, error } = await db
    .from('rms_partner_api_keys')
    .select('id, partner_id, revoked_at, last_used_at')
    .eq('key_hash', await sha256Hex(apiKey))
    .maybeSingle();
  if (error) raise(error, 'API キーを確認できませんでした。');
  const key = data as { id: string; partner_id: string; revoked_at: string | null; last_used_at: string | null } | null;
  if (!key || key.revoked_at) return null;
  const { data: partnerRow, error: partnerError } = await db.from('rms_partners').select(PARTNER_COLUMNS).eq('id', key.partner_id).maybeSingle();
  if (partnerError) raise(partnerError, '取引先を読み込めませんでした。');
  const partner = partnerRow ? await withFacility(db, partnerRow) : null;
  if (!partner) return null;
  if (!key.last_used_at || Date.now() - new Date(key.last_used_at).getTime() > 5 * 60_000) {
    await db.from('rms_partner_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id);
  }
  return { partner, apiKeyId: key.id };
}

