// 取引先ポータル（特別レートの限定公開）の DB 読み書き。autumn-rms から移設（2026-09-26）。
//
// 取引先関連の表（rms_partner_*）は RLS で service_role 以外を拒否しているため、読み書きはすべて
// service_role クライアント（./admin-client.ts・取引先モジュール専用）で行う。service_role は RLS を
// バイパスするので、入口の検証が命綱:
//   - 限定URLのトークン → 取引先、クッキーのセッション → その取引先のアカウント、
//     API キー → 取引先、の順に必ず結び付きを確かめてから読む。
//   - 取引先の施設は Book が扱う施設（FACILITY_UUID）に限る。
// 取引先・アカウント・API キーの発行や設定（スタッフ用の機能）も 2026-09-26 に Book の /admin/partners へ移した。
// 表名・cookie 名・API キーの接頭辞（rms_ / rmsp_）は既存データと発行済みのキーをそのまま使うため変えない。
import type { SupabaseClient } from '@supabase/supabase-js';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { normalizePartnerPricing, type PartnerPricing } from '$lib/partner-pricing';
import { normalizeBooker, normalizePartnerBookingSettings, validateBooker, type PartnerBooker, type PartnerBookingSettings } from '$lib/partner-booking';
import { partnerServiceClient } from './admin-client';
// 循環 import（memorandum → store）だが、どちらも呼び出し時にしか参照しないので問題ない
import { removeAllPartnerDocumentFiles } from './memorandum';
import { randomToken, sha256Hex, verifyPassword, hashPassword } from './crypto';
import { canManageAccount } from '$lib/partner-account-roles';

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
  // マスタユーザー（Book のスタッフが発行）／子ユーザー（マスタが作成）。migration 20261001083643
  is_master: boolean;
  created_by_account: string | null;
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
  'id, partner_id, login_id, display_name, email, password_hash, password_set_at, setup_token_expires_at, failed_attempts, locked_until, last_login_at, is_active, is_master, created_by_account, created_at';

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
// スタッフ側（Book の管理画面 /admin/partners）。autumn-rms v0.103.0 から移設（2026-09-26）。
// 呼び出し元（routes/admin/partners/**）は staffPartnerScope で「スタッフの役割」と「その施設へのアクセス（RLS）」を
// 確かめてから呼ぶこと。ここでは取引先の施設 = 開いている施設の突き合わせ（requireStaffPartner）を必ず行う。
// ============================================================================

export async function listPartners(db: SupabaseClient, facilityId: string): Promise<PartnerRow[]> {
  const { data, error } = await db
    .from('rms_partners')
    .select(PARTNER_COLUMNS)
    .eq('facility_id', facilityId)
    .order('is_active', { ascending: false })
    .order('name');
  if (error) raise(error, '取引先を読み込めませんでした。');
  return (data ?? []).map(toPartner);
}

// 取引先ごとのアカウント数・有効 API キー数（一覧表示用）。
export async function countPartnerCredentials(db: SupabaseClient, partnerIds: string[]) {
  const out = new Map<string, { accounts: number; activeAccounts: number; apiKeys: number }>();
  if (!partnerIds.length) return out;
  const [accounts, keys] = await Promise.all([
    db.from('rms_partner_accounts').select('partner_id, is_active, password_hash').in('partner_id', partnerIds),
    db.from('rms_partner_api_keys').select('partner_id, revoked_at').in('partner_id', partnerIds)
  ]);
  for (const id of partnerIds) out.set(id, { accounts: 0, activeAccounts: 0, apiKeys: 0 });
  for (const a of (accounts.data ?? []) as { partner_id: string; is_active: boolean; password_hash: string | null }[]) {
    const c = out.get(a.partner_id)!;
    c.accounts += 1;
    if (a.is_active && a.password_hash) c.activeAccounts += 1;
  }
  for (const k of (keys.data ?? []) as { partner_id: string; revoked_at: string | null }[]) {
    if (!k.revoked_at) out.get(k.partner_id)!.apiKeys += 1;
  }
  return out;
}

// 取引先を読み、開いている施設のものかを必ず確かめる（別施設の ID を渡されても触らせない）。
export async function requireStaffPartner(db: SupabaseClient, facilityId: string, partnerId: string): Promise<PartnerRow> {
  if (!/^[0-9a-f-]{36}$/i.test(partnerId)) throw new PartnerStoreError('取引先が見つかりません。', 404, 'not_found');
  const { data, error } = await db.from('rms_partners').select(PARTNER_COLUMNS).eq('id', partnerId).maybeSingle();
  if (error) raise(error, '取引先を読み込めませんでした。');
  if (!data || data.facility_id !== facilityId) throw new PartnerStoreError('取引先が見つかりません。', 404, 'not_found');
  return toPartner(data);
}

export type PartnerSettingsInput = {
  name: string;
  kind: PartnerKind;
  contact_name: string | null;
  contact_email: string | null;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  max_days_ahead: number;
  show_inventory: boolean;
  include_advance: boolean;
  pricing: PartnerPricing;
  note: string | null;
  booking_enabled: boolean;
  booking_settings: PartnerBookingSettings;
};

export async function createPartner(
  db: SupabaseClient,
  scope: { tenantId: string; facilityId: string; userId: string | null },
  input: PartnerSettingsInput
): Promise<PartnerRow> {
  const { data, error } = await db
    .from('rms_partners')
    .insert({
      ...input,
      tenant_id: scope.tenantId,
      facility_id: scope.facilityId,
      url_token: randomToken(18),
      created_by: scope.userId,
      updated_by: scope.userId
    })
    .select(PARTNER_COLUMNS)
    .single();
  if (error) raise(error, '取引先を登録できませんでした。');
  return toPartner(data);
}

export async function updatePartner(
  db: SupabaseClient,
  partner: PartnerRow,
  userId: string | null,
  input: Partial<PartnerSettingsInput>
): Promise<void> {
  const { error } = await db
    .from('rms_partners')
    .update({ ...input, updated_by: userId })
    .eq('id', partner.id)
    .eq('facility_id', partner.facility_id);
  if (error) raise(error, '取引先を保存できませんでした。');
}

// 限定URLを作り直す（旧URLは即無効。ログイン中のセッションも切る）。
export async function regeneratePartnerUrl(db: SupabaseClient, partner: PartnerRow, userId: string | null): Promise<string> {
  const token = randomToken(18);
  const { error } = await db
    .from('rms_partners')
    .update({ url_token: token, updated_by: userId })
    .eq('id', partner.id)
    .eq('facility_id', partner.facility_id);
  if (error) raise(error, '限定URLを再発行できませんでした。');
  await revokeSessionsOfPartner(db, partner.id);
  return token;
}

export async function deletePartner(db: SupabaseClient, partner: PartnerRow): Promise<void> {
  // 覚書ファイルの実体（Storage）を先に消す。台帳は FK cascade で消える
  await removeAllPartnerDocumentFiles(db, partner.id);
  const { error } = await db.from('rms_partners').delete().eq('id', partner.id).eq('facility_id', partner.facility_id);
  if (error) raise(error, '取引先を削除できませんでした。');
}

export async function listPartnerAccounts(db: SupabaseClient, partnerId: string): Promise<PartnerAccountRow[]> {
  const { data, error } = await db.from('rms_partner_accounts').select(ACCOUNT_COLUMNS).eq('partner_id', partnerId).order('created_at');
  if (error) raise(error, 'ログインアカウントを読み込めませんでした。');
  return (data ?? []) as PartnerAccountRow[];
}

export async function listPartnerApiKeys(db: SupabaseClient, partnerId: string): Promise<PartnerApiKeyRow[]> {
  const { data, error } = await db
    .from('rms_partner_api_keys')
    .select('id, partner_id, label, key_prefix, last_used_at, revoked_at, created_at')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false });
  if (error) raise(error, 'API キーを読み込めませんでした。');
  return (data ?? []) as PartnerApiKeyRow[];
}

export async function listPartnerAccessLogs(db: SupabaseClient, partnerId: string, limit = 50): Promise<PartnerAccessLogRow[]> {
  const { data, error } = await db
    .from('rms_partner_access_logs')
    .select('id, account_id, api_key_id, channel, action, detail, ip, created_at')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) raise(error, 'アクセスログを読み込めませんでした。');
  return (data ?? []) as PartnerAccessLogRow[];
}

export const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{3,63}$/i;

// ログインアカウントを発行し、パスワード設定用のトークン（平文・1度だけ）を返す。
export async function createPartnerAccount(
  db: SupabaseClient,
  partner: PartnerRow,
  input: { loginId: string; displayName: string | null; email: string | null; userId: string | null }
): Promise<{ account: PartnerAccountRow; setupToken: string }> {
  if (!LOGIN_ID_PATTERN.test(input.loginId)) {
    throw new PartnerStoreError('ログインIDは英数字と . _ - で4〜64文字にしてください（先頭は英数字）。');
  }
  const setupToken = randomToken(32);
  const { data, error } = await db
    .from('rms_partner_accounts')
    .insert({
      partner_id: partner.id,
      // 大文字小文字を区別しないため、保存は小文字に揃える（ログイン時も小文字で照合）。
      login_id: input.loginId.toLowerCase(),
      display_name: input.displayName,
      email: input.email,
      setup_token_hash: await sha256Hex(setupToken),
      setup_token_expires_at: new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 3600_000).toISOString(),
      created_by: input.userId
    })
    .select(ACCOUNT_COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505') throw new PartnerStoreError(`ログインID「${input.loginId}」は既に使われています。`, 409, 'duplicate');
    raise(error, 'ログインアカウントを発行できませんでした。');
  }
  return { account: data as PartnerAccountRow, setupToken };
}

async function requireAccountOf(db: SupabaseClient, partner: PartnerRow, accountId: string): Promise<PartnerAccountRow> {
  const { data, error } = await db
    .from('rms_partner_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .eq('partner_id', partner.id)
    .maybeSingle();
  if (error) raise(error, 'ログインアカウントを読み込めませんでした。');
  if (!data) throw new PartnerStoreError('ログインアカウントが見つかりません。', 404, 'not_found');
  return data as PartnerAccountRow;
}

// パスワード設定（再設定）リンクを発行し直す。既存のパスワードは設定し直すまで有効のまま。
export async function reissueSetupToken(
  db: SupabaseClient,
  partner: PartnerRow,
  accountId: string
): Promise<{ account: PartnerAccountRow; setupToken: string }> {
  const account = await requireAccountOf(db, partner, accountId);
  const setupToken = randomToken(32);
  const { error } = await db
    .from('rms_partner_accounts')
    .update({
      setup_token_hash: await sha256Hex(setupToken),
      setup_token_expires_at: new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 3600_000).toISOString()
    })
    .eq('id', account.id);
  if (error) raise(error, 'パスワード設定リンクを発行できませんでした。');
  return { account, setupToken };
}

export async function updatePartnerAccount(
  db: SupabaseClient,
  partner: PartnerRow,
  accountId: string,
  patch: { is_active?: boolean; unlock?: boolean }
): Promise<PartnerAccountRow> {
  const account = await requireAccountOf(db, partner, accountId);
  const update: Record<string, unknown> = {};
  if (patch.is_active != null) update.is_active = patch.is_active;
  if (patch.unlock) {
    update.failed_attempts = 0;
    update.locked_until = null;
  }
  const { error } = await db.from('rms_partner_accounts').update(update).eq('id', account.id);
  if (error) raise(error, 'ログインアカウントを更新できませんでした。');
  if (patch.is_active === false) await db.from('rms_partner_sessions').delete().eq('account_id', account.id);
  return account;
}

export async function deletePartnerAccount(db: SupabaseClient, partner: PartnerRow, accountId: string): Promise<PartnerAccountRow> {
  const account = await requireAccountOf(db, partner, accountId);
  const { error } = await db.from('rms_partner_accounts').delete().eq('id', account.id);
  if (error) raise(error, 'ログインアカウントを削除できませんでした。');
  return account;
}

// API キーを発行する。キー本体（平文）は戻り値でだけ返し、DB には SHA-256 しか残さない。
export async function issuePartnerApiKey(
  db: SupabaseClient,
  partner: PartnerRow,
  label: string | null,
  userId: string | null
): Promise<{ key: string; row: PartnerApiKeyRow }> {
  const key = `${API_KEY_PREFIX}${randomToken(32)}`;
  const { data, error } = await db
    .from('rms_partner_api_keys')
    .insert({
      partner_id: partner.id,
      label,
      key_prefix: key.slice(0, API_KEY_PREFIX.length + 6),
      key_hash: await sha256Hex(key),
      created_by: userId
    })
    .select('id, partner_id, label, key_prefix, last_used_at, revoked_at, created_at')
    .single();
  if (error) raise(error, 'API キーを発行できませんでした。');
  return { key, row: data as PartnerApiKeyRow };
}

export async function revokePartnerApiKey(db: SupabaseClient, partner: PartnerRow, keyId: string): Promise<void> {
  const { error } = await db
    .from('rms_partner_api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .eq('partner_id', partner.id)
    .is('revoked_at', null);
  if (error) raise(error, 'API キーを無効にできませんでした。');
}

async function revokeSessionsOfPartner(db: SupabaseClient, partnerId: string) {
  const { data } = await db.from('rms_partner_accounts').select('id').eq('partner_id', partnerId);
  const ids = ((data ?? []) as { id: string }[]).map((a) => a.id);
  if (ids.length) await db.from('rms_partner_sessions').delete().in('account_id', ids);
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

export type PartnerSessionAccount = Pick<PartnerAccountRow, 'id' | 'login_id' | 'display_name' | 'is_master'> & { sessionId: string };

// クッキーのセッションから、この取引先のアカウントを引く。別の取引先のセッションは通さない。
export async function getPartnerSession(
  db: SupabaseClient,
  partner: PartnerContext,
  sessionToken: string | undefined
): Promise<PartnerSessionAccount | null> {
  if (!sessionToken) return null;
  const { data } = await db
    .from('rms_partner_sessions')
    .select('id, expires_at, last_seen_at, account:rms_partner_accounts!inner(id, partner_id, login_id, display_name, is_active, is_master)')
    .eq('token_hash', await sha256Hex(sessionToken))
    .maybeSingle();
  const row = data as
    | {
        id: string;
        expires_at: string;
        last_seen_at: string;
        account: { id: string; partner_id: string; login_id: string; display_name: string | null; is_active: boolean; is_master: boolean };
      }
    | null;
  if (!row || new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (row.account.partner_id !== partner.id || !row.account.is_active) return null;
  // 最終アクセスの更新は5分に1回まで（毎リクエスト書き込まない）。
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    await db.from('rms_partner_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', row.id);
  }
  // is_master はリクエストごとに DB から読む（マスタの権限を外したら次のリクエストから効く）
  return {
    id: row.account.id,
    login_id: row.account.login_id,
    display_name: row.account.display_name,
    is_master: row.account.is_master === true,
    sessionId: row.id
  };
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


// ---- 予約担当者のプロフィール（マイページ。2026-10-01 追加・autumn-shared 20261001074722） ----

// ログイン中のアカウント（セッションで確かめた id）のプロフィール。partner_id でも絞り、別の取引先のアカウントは読まない。
// 未設定のときは、発行時に入れた表示名・メールを初期値にする。
export async function getBookerProfile(db: SupabaseClient, partnerId: string, accountId: string): Promise<PartnerBooker> {
  const { data, error } = await db
    .from('rms_partner_accounts')
    .select('display_name, email, booker_profile')
    .eq('id', accountId)
    .eq('partner_id', partnerId)
    .maybeSingle();
  if (error) raise(error, '担当者情報を読み込めませんでした。');
  const profile = normalizeBooker(data?.booker_profile);
  return {
    ...profile,
    name: profile.name || String(data?.display_name ?? '').trim(),
    email: profile.email || String(data?.email ?? '').trim()
  };
}

export async function saveBookerProfile(db: SupabaseClient, partnerId: string, accountId: string, input: PartnerBooker): Promise<PartnerBooker> {
  const profile = normalizeBooker(input);
  const problem = validateBooker(profile);
  if (problem) throw new PartnerStoreError(problem);
  const { error } = await db
    .from('rms_partner_accounts')
    .update({ booker_profile: profile })
    .eq('id', accountId)
    .eq('partner_id', partnerId);
  if (error) raise(error, '担当者情報を保存できませんでした。');
  return profile;
}

// ---- 取引先内のユーザー管理（マスタユーザー → 子ユーザー。2026-10-01 追加・autumn-shared 20261001083643） ----
//
// 取引先ページの「アカウント」→「ユーザー管理」から呼ぶ。service_role で触るので、毎回 DB 条件で次を確かめる（IDOR 防止）:
//   - 操作する人（actorId = セッションで確かめたアカウント）が、この取引先の有効なマスタユーザーであること
//   - 対象が同じ取引先の子ユーザー（is_master=false）であること（マスタ自身・他のマスタは触れない）
// 子ユーザーは常に is_master=false で作る（列の既定は true なので必ず明示する）。

// 操作する人がこの取引先の有効なマスタユーザーかを DB で確かめる。違えば 403。
export async function requireMasterAccount(db: SupabaseClient, partnerId: string, actorId: string): Promise<PartnerAccountRow> {
  const { data, error } = await db
    .from('rms_partner_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', actorId)
    .eq('partner_id', partnerId)
    .eq('is_master', true)
    .eq('is_active', true)
    .maybeSingle();
  if (error) raise(error, 'アカウントを確認できませんでした。');
  if (!data) throw new PartnerStoreError('ユーザー管理はマスタユーザーだけが使えます。', 403, 'forbidden');
  return data as PartnerAccountRow;
}

// 取引先のユーザー一覧（マスタ・子ユーザーとも）。マスタユーザーだけが読める。
export async function listPortalUsers(db: SupabaseClient, partnerId: string, actorId: string): Promise<PartnerAccountRow[]> {
  await requireMasterAccount(db, partnerId, actorId);
  return listPartnerAccounts(db, partnerId);
}

// 対象が「この取引先の子ユーザー」かを DB 条件で確かめて読み、操作してよいかを canManageAccount で判定する。
async function requireChildTarget(
  db: SupabaseClient,
  partnerId: string,
  actorId: string,
  accountId: string
): Promise<{ actor: PartnerAccountRow; target: PartnerAccountRow }> {
  const actor = await requireMasterAccount(db, partnerId, actorId);
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new PartnerStoreError('ユーザーが見つかりません。', 404, 'not_found');
  const { data, error } = await db
    .from('rms_partner_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .eq('partner_id', partnerId)
    .eq('is_master', false)
    .maybeSingle();
  if (error) raise(error, 'ユーザーを読み込めませんでした。');
  if (!data) throw new PartnerStoreError('ユーザーが見つかりません（マスタユーザーはここでは操作できません）。', 404, 'not_found');
  const target = data as PartnerAccountRow;
  if (!canManageAccount({ ...actor, is_active: true }, target)) throw new PartnerStoreError('このユーザーは操作できません。', 403, 'forbidden');
  return { actor, target };
}

// 1取引先あたりの子ユーザーの上限（停止中も数える。要らなくなったら削除してもらう）
export const MAX_CHILD_ACCOUNTS = 30;

// 子ユーザーを作り、パスワード設定用のトークン（平文・1度だけ）を返す。
export async function createChildAccount(
  db: SupabaseClient,
  partnerId: string,
  actorId: string,
  input: { loginId: string; displayName: string; email: string }
): Promise<{ account: PartnerAccountRow; setupToken: string }> {
  const actor = await requireMasterAccount(db, partnerId, actorId);
  if (!LOGIN_ID_PATTERN.test(input.loginId)) {
    throw new PartnerStoreError('ログインIDは英数字と . _ - で4〜64文字にしてください（先頭は英数字）。');
  }
  const { count, error: countError } = await db
    .from('rms_partner_accounts')
    .select('id', { count: 'exact', head: true })
    .eq('partner_id', actor.partner_id)
    .eq('is_master', false);
  if (countError) raise(countError, 'ユーザーを数えられませんでした。');
  if ((count ?? 0) >= MAX_CHILD_ACCOUNTS) {
    throw new PartnerStoreError(`子ユーザーは${MAX_CHILD_ACCOUNTS}人までです。使っていないユーザーを削除してから作成してください。`, 409, 'limit');
  }
  const setupToken = randomToken(32);
  const { data, error } = await db
    .from('rms_partner_accounts')
    .insert({
      partner_id: actor.partner_id,
      // 大文字小文字を区別しないため、保存は小文字に揃える（スタッフの発行と同じ）
      login_id: input.loginId.toLowerCase(),
      display_name: input.displayName,
      email: input.email,
      // 子ユーザー。列の既定（true）に任せるとマスタになるので必ず明示する
      is_master: false,
      created_by_account: actor.id,
      setup_token_hash: await sha256Hex(setupToken),
      setup_token_expires_at: new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 3600_000).toISOString()
    })
    .select(ACCOUNT_COLUMNS)
    .single();
  if (error) {
    if (error.code === '23505') throw new PartnerStoreError(`ログインID「${input.loginId}」は既に使われています。別のIDにしてください。`, 409, 'duplicate');
    raise(error, 'ユーザーを作成できませんでした。');
  }
  return { account: data as PartnerAccountRow, setupToken };
}

// 子ユーザーの停止・再開。停止したらログイン中のセッションも切る。再開ではロックも解く。
export async function setChildAccountActive(
  db: SupabaseClient,
  partnerId: string,
  actorId: string,
  accountId: string,
  active: boolean
): Promise<PartnerAccountRow> {
  const { target } = await requireChildTarget(db, partnerId, actorId, accountId);
  const update: Record<string, unknown> = { is_active: active };
  if (active) {
    update.failed_attempts = 0;
    update.locked_until = null;
  }
  const { error } = await db
    .from('rms_partner_accounts')
    .update(update)
    .eq('id', target.id)
    .eq('partner_id', partnerId)
    .eq('is_master', false);
  if (error) raise(error, 'ユーザーを更新できませんでした。');
  if (!active) await db.from('rms_partner_sessions').delete().eq('account_id', target.id);
  return target;
}

// 子ユーザーを削除する（ログイン中のセッションも消す）。
export async function deleteChildAccount(db: SupabaseClient, partnerId: string, actorId: string, accountId: string): Promise<PartnerAccountRow> {
  const { target } = await requireChildTarget(db, partnerId, actorId, accountId);
  await db.from('rms_partner_sessions').delete().eq('account_id', target.id);
  const { error } = await db
    .from('rms_partner_accounts')
    .delete()
    .eq('id', target.id)
    .eq('partner_id', partnerId)
    .eq('is_master', false);
  if (error) raise(error, 'ユーザーを削除できませんでした。');
  return target;
}

// 子ユーザーのパスワード設定（再設定）リンクを発行し直す。既存のパスワードは設定し直すまで有効のまま。
export async function reissueChildSetup(
  db: SupabaseClient,
  partnerId: string,
  actorId: string,
  accountId: string
): Promise<{ account: PartnerAccountRow; setupToken: string }> {
  const { target } = await requireChildTarget(db, partnerId, actorId, accountId);
  if (!target.is_active) throw new PartnerStoreError('停止中のユーザーには送れません。先に再開してください。');
  if (!target.email) throw new PartnerStoreError('このユーザーにはメールアドレスがありません。');
  const setupToken = randomToken(32);
  const { error } = await db
    .from('rms_partner_accounts')
    .update({
      setup_token_hash: await sha256Hex(setupToken),
      setup_token_expires_at: new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 3600_000).toISOString()
    })
    .eq('id', target.id)
    .eq('partner_id', partnerId)
    .eq('is_master', false);
  if (error) raise(error, 'パスワード設定リンクを発行できませんでした。');
  return { account: target, setupToken };
}
