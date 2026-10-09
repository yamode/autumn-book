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
import { PREVIEW_ACCOUNT_ID } from './preview';
import {
  isNewEnvironment,
  isPartnerSessionAlive,
  NEW_ENVIRONMENT_LOOKBACK_DAYS,
  PARTNER_SESSION_IDLE_HOURS,
  PARTNER_SESSION_TTL_HOURS,
  SECURITY_LOG_ACTIONS,
  type LoginHistoryEntry
} from '$lib/partner-login-security';
import { loginStepUpReason, MFA_PENDING_MARK, normalizeMfaPolicy, PARTNER_MFA_POLICIES, type LoginStepUpReason, type PartnerMfaPolicy } from '$lib/partner-mfa';
import { MFA_SETUP_MARK } from '$lib/partner-passkey';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { normalizePartnerPricing, type PartnerPricing } from '$lib/partner-pricing';
import {
  buildPartnerCommonSettings,
  normalizeBooker,
  normalizePartnerBookingSettings,
  PARTNER_FACILITY_SETTING_KEYS,
  partnerFacilityOverrides,
  splitPartnerBookingSettings,
  validateBooker,
  type CreditDeposit,
  type CreditDepositRemainder,
  type PartnerBooker,
  type PartnerBookingSettings
} from '$lib/partner-booking';
import { partnerServiceClient } from './admin-client';
// 循環 import（memorandum → store）だが、どちらも呼び出し時にしか参照しないので問題ない
import { removeAllPartnerDocumentFiles } from './memorandum';
import { removeAllBookingAttachmentFiles } from './booking-attachments';
import { randomToken, sha256Hex, verifyPassword, hashPassword } from './crypto';
import { canManageAccount, canManageSavedCards, canResetMfa } from '$lib/partner-account-roles';
import {
  ilikeContainsPattern,
  isPmsPartnerGuestType,
  normalizeBookingNameMode,
  type BookingNameMode,
  PMS_PARTNER_GUEST_TYPES,
  pmsGuestFormalName,
  type PmsGuestNameFields,
  type PmsPartnerGuest
} from '$lib/pms-partner-guest';
import {
  isSelectableCreditOverAction,
  normalizeCreditCheck,
  normalizeCreditOverAction,
  readAgencyCreditMeta,
  type CreditCheck,
  type CreditOverAction,
  type CreditSettingsPatch
} from '$lib/partner-credit';

export type PartnerKind = 'agent' | 'corporate' | 'other';
export const PARTNER_KIND_LABELS: Record<PartnerKind, string> = {
  agent: '旅行会社・エージェント',
  corporate: '法人',
  other: 'その他'
};

// ---- 取引先共通と施設ごと（複数施設化 Phase B・docs/partner-multi-facility.md §4・§7.9・2026-10-09） ----
//
// 取引先は rms_partners（取引先共通・取引先で1行）と rms_partner_facilities（取引先 × 施設の販売設定）に分かれた
// （autumn-shared 20261009054024）。画面・予約・メールの処理は、施設を1つ選んで合成した PartnerContext を読む。
// rms_partners の旧列（facility_id / pricing / booking_enabled / max_days_ahead / show_inventory / include_advance /
// payment_method_id）は Phase D で落とすまで残るが、Book は読まない・書かない（§5.2。新規作成時の facility_id だけ互換で入れる）。

/** rms_partners（取引先共通）の行 */
export type PartnerCommonRow = {
  id: string;
  tenant_id: string;
  /** 既定の施設（取引先ページの初期表示・設定メールの差出人）。null なら最初のオンの施設 */
  primary_facility_id: string | null;
  /** 旧 rms_partners.facility_id（Phase D まで互換で残る・NULL 許容）。読むのは primary が無いときの代わりだけ */
  legacy_facility_id: string | null;
  name: string;
  kind: PartnerKind;
  contact_name: string | null;
  contact_email: string | null;
  url_token: string;
  is_active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  note: string | null;
  /** rms_partners.booking_settings（jsonb）の生の値。共通の部分（§4.2）と、Phase D まで残る旧い施設ごとのキー */
  common_settings: Record<string, unknown>;
  // PMS の顧客マスタ（旅行会社・法人）への紐づけ（migration 20261006224655）。null = 未紐づけ
  pms_guest_id: string | null;
  // 予約名義（Phase 2）・与信超過時の挙動（Phase 3a・warn / ignore を選べる。deposit は 3b まで warn と同じ扱い）。
  // どちらも管理画面の「PMS の顧客マスタとの紐づけ」で編集
  booking_name_mode: PartnerBookingNameMode;
  credit_over_action: PartnerCreditOverAction;
  /** 第2要素の方針（docs/auth-hardening.md §6.3・既定 step_up）。古いテストの行には無いので省略可 */
  mfa_policy?: PartnerMfaPolicy;
  created_at: string;
  updated_at: string;
};

/** rms_partner_facilities（取引先 × 施設）の行 */
export type PartnerFacilityRow = {
  partner_id: string;
  facility_id: string;
  tenant_id: string;
  /** この施設に販売するか（切替・料金・予約・API の入口） */
  enabled: boolean;
  // 予約受付（migration 20260926054852 から移した列）
  booking_enabled: boolean;
  max_days_ahead: number;
  show_inventory: boolean;
  include_advance: boolean;
  pricing: PartnerPricing;
  payment_method_id: string | null;
  /** booking_settings の施設ごとの部分＋共通の上書き（N6）の生の値 */
  facility_settings: Record<string, unknown>;
  sort_order: number;
  updated_at: string | null;
};

/** 施設の行に施設名・slug を付けたもの（切替・一覧用）。synthetic = 施設設定の行が無く、既定値で補ったもの */
export type PartnerFacilityInfo = PartnerFacilityRow & { slug: string; name: string; synthetic?: boolean };

/** 施設切替の一覧（PartnerContext.facilities）の1件 */
export type PartnerFacilitySummary = {
  id: string;
  slug: string;
  name: string;
  enabled: boolean;
  bookingEnabled: boolean;
  sortOrder: number;
};

/**
 * 選んだ施設で合成した取引先（従来の「施設ごとの rms_partners の行」と同じ形）。
 * booking_settings = normalizePartnerBookingSettings(共通, 施設)（N6 の上書き規則）。
 */
export type PartnerRow = Omit<PartnerCommonRow, 'legacy_facility_id'> &
  Pick<
    PartnerFacilityRow,
    'facility_id' | 'booking_enabled' | 'max_days_ahead' | 'show_inventory' | 'include_advance' | 'pricing' | 'payment_method_id' | 'facility_settings'
  > & {
    booking_settings: PartnerBookingSettings;
  };

export type PartnerBookingNameMode = BookingNameMode;
export type PartnerCreditOverAction = CreditOverAction;

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
  // 第2要素（docs/auth-hardening.md §6.6・S6 で画面に出す）: メールの確認済み・宿／マスタがリセットした時刻と人
  email_verified_at?: string | null;
  mfa_reset_at?: string | null;
  mfa_reset_by?: string | null;
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
  channel: 'web' | 'api' | 'admin';
  action: string;
  detail: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
};

// 取引先ページ・予約・メールが読む取引先（選んだ施設で合成したもの・§7.9）。
//   facilities: 取引先の施設（オン／オフとも・並び順）。切替（S4）の材料
//   facility_available: 選んだ施設がオンか。false = オンの施設が1つも無い（N9: ログインはできるが料金・予約は案内文）
export type PartnerContext = PartnerRow & {
  facility_slug: string;
  facility_name: string;
  facilities: PartnerFacilitySummary[];
  facility_available: boolean;
};

/** オンの施設が1つも無い取引先に、料金・予約の代わりに出す案内（N9） */
export const NO_PARTNER_FACILITY_MESSAGE = '現在ご案内できる施設がありません。宿へお問い合わせください。';

export const SETUP_TOKEN_TTL_HOURS = 24 * 7;
// 発行から 7 日。加えて最終アクセスから 24 時間で切れる（M3・getPartnerSession の isPartnerSessionAlive）
export const SESSION_TTL_HOURS = PARTNER_SESSION_TTL_HOURS;
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

const COMMON_COLUMNS =
  'id, tenant_id, primary_facility_id, legacy_facility_id:facility_id, name, kind, contact_name, contact_email, url_token, is_active, valid_from, valid_until, note, booking_settings, pms_guest_id, booking_name_mode, credit_over_action, mfa_policy, created_at, updated_at';
const FACILITY_COLUMNS =
  'partner_id, facility_id, tenant_id, enabled, booking_enabled, max_days_ahead, show_inventory, include_advance, pricing, payment_method_id, facility_settings, sort_order, updated_at';
const ACCOUNT_COLUMNS =
  'id, partner_id, login_id, display_name, email, password_hash, password_set_at, setup_token_expires_at, failed_attempts, locked_until, last_login_at, is_active, is_master, created_by_account, created_at, email_verified_at, mfa_reset_at, mfa_reset_by';

const asJsonObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function toCommon(row: Record<string, unknown>): PartnerCommonRow {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    primary_facility_id: (row.primary_facility_id as string | null) ?? null,
    legacy_facility_id: (row.legacy_facility_id as string | null) ?? null,
    name: String(row.name ?? ''),
    kind: (row.kind as PartnerKind) ?? 'other',
    contact_name: (row.contact_name as string | null) ?? null,
    contact_email: (row.contact_email as string | null) ?? null,
    url_token: String(row.url_token ?? ''),
    is_active: row.is_active === true,
    valid_from: (row.valid_from as string | null) ?? null,
    valid_until: (row.valid_until as string | null) ?? null,
    note: (row.note as string | null) ?? null,
    common_settings: asJsonObject(row.booking_settings),
    pms_guest_id: (row.pms_guest_id as string | null) ?? null,
    booking_name_mode: normalizeBookingNameMode(row.booking_name_mode),
    credit_over_action: normalizeCreditOverAction(row.credit_over_action),
    mfa_policy: normalizeMfaPolicy(row.mfa_policy),
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? '')
  };
}

function toFacilityRow(row: Record<string, unknown>): PartnerFacilityRow {
  const days = Math.round(Number(row.max_days_ahead));
  return {
    partner_id: String(row.partner_id),
    facility_id: String(row.facility_id),
    tenant_id: String(row.tenant_id),
    enabled: row.enabled !== false,
    booking_enabled: row.booking_enabled === true,
    max_days_ahead: Number.isFinite(days) && days >= 1 ? days : 365,
    show_inventory: row.show_inventory !== false,
    include_advance: row.include_advance !== false,
    pricing: normalizePartnerPricing(row.pricing),
    payment_method_id: (row.payment_method_id as string | null) ?? null,
    facility_settings: asJsonObject(row.facility_settings),
    sort_order: Number(row.sort_order) || 0,
    updated_at: (row.updated_at as string | null) ?? null
  };
}

// 施設設定の行が無い施設（バックフィル漏れ・行の削除）を、販売しない既定値で補う（N9 の画面を出すため）。
function syntheticFacilityRow(partner: PartnerCommonRow, facilityId: string): PartnerFacilityRow {
  return {
    partner_id: partner.id,
    facility_id: facilityId,
    tenant_id: partner.tenant_id,
    enabled: false,
    booking_enabled: false,
    max_days_ahead: 365,
    show_inventory: true,
    include_advance: true,
    pricing: normalizePartnerPricing(null),
    payment_method_id: null,
    facility_settings: {},
    sort_order: 0,
    updated_at: null
  };
}

// 施設の並び: sort_order → Book の施設の並び（西和賀 → 男鹿）
const BOOK_FACILITY_ORDER = Object.values(FACILITY_UUID);
const facilityOrder = (a: PartnerFacilityInfo, b: PartnerFacilityInfo) =>
  a.sort_order - b.sort_order || BOOK_FACILITY_ORDER.indexOf(a.facility_id) - BOOK_FACILITY_ORDER.indexOf(b.facility_id);

// core.facilities の slug・名前（施設 UUID → { slug, name }）。Book が扱う施設だけ
async function facilityMeta(db: SupabaseClient, ids: readonly string[]): Promise<Map<string, { slug: string; name: string }>> {
  const uniq = [...new Set(ids.filter(isBookFacility))];
  const out = new Map<string, { slug: string; name: string }>();
  if (!uniq.length) return out;
  const { data } = await db.schema('core').from('facilities').select('id, slug, name').in('id', uniq);
  for (const r of (data ?? []) as { id: string; slug: string | null; name: string | null }[]) {
    if (r.slug) out.set(r.id, { slug: String(r.slug), name: String(r.name ?? r.slug) });
  }
  return out;
}

/** 取引先（共通）と、その施設設定（Book の施設だけ・並び順）。合成の材料 */
export type PartnerBundle = { common: PartnerCommonRow; facilities: PartnerFacilityInfo[] };

// 取引先の施設設定を読む（partnerId → 行）。Book が扱っていない施設の行は落とす。
async function loadFacilityRows(db: SupabaseClient, partnerIds: readonly string[]): Promise<Map<string, PartnerFacilityRow[]>> {
  const out = new Map<string, PartnerFacilityRow[]>();
  if (!partnerIds.length) return out;
  const { data, error } = await db.from('rms_partner_facilities').select(FACILITY_COLUMNS).in('partner_id', [...partnerIds]);
  if (error) raise(error, '取引先の施設設定を読み込めませんでした。');
  for (const raw of (data ?? []) as Record<string, unknown>[]) {
    const row = toFacilityRow(raw);
    if (!isBookFacility(row.facility_id)) continue;
    const list = out.get(row.partner_id) ?? [];
    list.push(row);
    out.set(row.partner_id, list);
  }
  return out;
}

// 共通の行と施設設定の行から、施設名つきの束を作る。施設設定が1つも無ければ、既定の施設（primary → 旧 facility_id）を
// 販売しない既定値で補う（N9: ログインはできるが料金・予約は案内文）。それも無ければ null。
async function bundlesOf(db: SupabaseClient, commons: PartnerCommonRow[]): Promise<PartnerBundle[]> {
  const rowsBy = await loadFacilityRows(db, commons.map((c) => c.id));
  const filled = commons.map((common) => {
    let rows = rowsBy.get(common.id) ?? [];
    if (!rows.length) {
      const fallback = [common.primary_facility_id, common.legacy_facility_id].find((id): id is string => !!id && isBookFacility(id));
      if (fallback) rows = [syntheticFacilityRow(common, fallback)];
    }
    return { common, rows };
  });
  const meta = await facilityMeta(db, filled.flatMap((f) => f.rows.map((r) => r.facility_id)));
  return filled.map(({ common, rows }) => ({
    common,
    facilities: rows
      .filter((r) => meta.has(r.facility_id))
      .map((r) => ({
        ...r,
        ...meta.get(r.facility_id)!,
        ...(rowsBy.get(common.id)?.length ? {} : { synthetic: true })
      }))
      .sort(facilityOrder)
  }));
}

async function loadBundle(db: SupabaseClient, by: { id: string } | { urlToken: string }): Promise<PartnerBundle | null> {
  const q = db.from('rms_partners').select(COMMON_COLUMNS);
  const { data, error } = await ('id' in by ? q.eq('id', by.id) : q.eq('url_token', by.urlToken)).maybeSingle();
  if (error) raise(error, '取引先を読み込めませんでした。');
  if (!data) return null;
  const [bundle] = await bundlesOf(db, [toCommon(data as Record<string, unknown>)]);
  return bundle ?? null;
}

/** 既定の施設: primary_facility_id（オンなら）→ オンの施設の先頭（並び順）。オンが無ければ null（§7.8 の 3・4） */
export function defaultPartnerFacilityId(bundle: PartnerBundle): string | null {
  const enabled = bundle.facilities.filter((f) => f.enabled);
  return enabled.find((f) => f.facility_id === bundle.common.primary_facility_id)?.facility_id ?? enabled[0]?.facility_id ?? null;
}

/**
 * 施設を1つ選んで合成する（§7.9）。facilityId がオンの施設ならそれ、違えば既定の施設。
 * opts.allowDisabled（管理画面）: オフの施設でも行があればその施設で合成する（facility_available=false）。
 * オンの施設が1つも無いとき（N9）: 既定の施設（primary → 先頭）の行で合成し、facility_available=false・予約受付 off。
 * 施設の行が1つも無ければ null（取引先として扱えない）。
 */
export function composePartnerContext(
  bundle: PartnerBundle,
  facilityId: string | null | undefined,
  opts: { allowDisabled?: boolean } = {}
): PartnerContext | null {
  const { common, facilities } = bundle;
  const pick =
    facilities.find((f) => f.facility_id === facilityId && (f.enabled || opts.allowDisabled)) ??
    facilities.find((f) => f.facility_id === defaultPartnerFacilityId(bundle)) ??
    facilities.find((f) => f.facility_id === common.primary_facility_id) ??
    facilities[0];
  if (!pick) return null;
  const available = pick.enabled;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { legacy_facility_id: _legacy, ...rest } = common;
  return {
    ...rest,
    facility_id: pick.facility_id,
    // オフの施設（N9・管理画面のオフの施設）では予約を受けない
    booking_enabled: available && pick.booking_enabled,
    max_days_ahead: pick.max_days_ahead,
    show_inventory: pick.show_inventory,
    include_advance: pick.include_advance,
    pricing: pick.pricing,
    payment_method_id: pick.payment_method_id,
    facility_settings: pick.facility_settings,
    booking_settings: normalizePartnerBookingSettings(common.common_settings, pick.facility_settings),
    facility_slug: pick.slug,
    facility_name: pick.name,
    facility_available: available,
    facilities: facilities.map((f) => ({
      id: f.facility_id,
      slug: f.slug,
      name: f.name,
      enabled: f.enabled,
      bookingEnabled: f.enabled && f.booking_enabled,
      sortOrder: f.sort_order
    }))
  };
}

/** 取引先を id で読み、施設を選んで合成する（facilityId 省略 = 既定の施設） */
export async function loadPartnerContext(
  db: SupabaseClient,
  partnerId: string,
  facilityId?: string | null,
  opts: { allowDisabled?: boolean } = {}
): Promise<PartnerContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(partnerId)) return null;
  const bundle = await loadBundle(db, { id: partnerId });
  return bundle ? composePartnerContext(bundle, facilityId, opts) : null;
}

/**
 * 予約・請求のように「台帳の施設」で決まる処理用: 取引先をその施設で合成する（オフの施設でも合成する）。
 * 施設設定の行が無い施設（行の削除など）は、施設名だけ引いて販売しない既定値で補う（メールの差出人・規定の施設を外さない）。
 * 取引先が無い・Book の施設でなければ null。
 */
export async function loadPartnerContextAt(db: SupabaseClient, partnerId: string, facilityId: string): Promise<PartnerContext | null> {
  if (!/^[0-9a-f-]{36}$/i.test(partnerId) || !isBookFacility(facilityId)) return null;
  const bundle = await loadBundle(db, { id: partnerId });
  if (!bundle) return null;
  if (!bundle.facilities.some((f) => f.facility_id === facilityId)) {
    const meta = (await facilityMeta(db, [facilityId])).get(facilityId);
    if (!meta) return null;
    bundle.facilities = [...bundle.facilities, { ...syntheticFacilityRow(bundle.common, facilityId), ...meta, synthetic: true }].sort(facilityOrder);
  }
  const ctx = composePartnerContext(bundle, facilityId, { allowDisabled: true });
  return ctx && ctx.facility_id === facilityId ? ctx : null;
}

/** 取引先の施設設定の一覧（施設名つき・オン／オフとも・並び順） */
export async function listPartnerFacilities(db: SupabaseClient, partnerId: string): Promise<PartnerFacilityInfo[]> {
  if (!/^[0-9a-f-]{36}$/i.test(partnerId)) return [];
  const bundle = await loadBundle(db, { id: partnerId });
  return bundle?.facilities.filter((f) => !f.synthetic) ?? [];
}

/** 施設設定の保存で受ける列（rms_partner_facilities） */
export type PartnerFacilityPatch = Partial<
  Pick<
    PartnerFacilityRow,
    'enabled' | 'booking_enabled' | 'max_days_ahead' | 'show_inventory' | 'include_advance' | 'pricing' | 'payment_method_id' | 'facility_settings' | 'sort_order'
  >
>;

/**
 * 取引先 × 施設の設定を1行保存する（無ければ作る・あれば渡した列だけ更新）。
 * 施設は Book が扱う施設に限る（§9 の isBookFacility）。
 */
export async function savePartnerFacility(
  db: SupabaseClient,
  partner: Pick<PartnerCommonRow, 'id' | 'tenant_id'>,
  facilityId: string,
  patch: PartnerFacilityPatch,
  userId: string | null
): Promise<void> {
  if (!isBookFacility(facilityId)) throw new PartnerStoreError('この施設には取引先の設定を作れません。', 400, 'bad_facility');
  const { error } = await db
    .from('rms_partner_facilities')
    .upsert(
      { ...patch, partner_id: partner.id, facility_id: facilityId, tenant_id: partner.tenant_id, updated_by: userId },
      { onConflict: 'partner_id,facility_id' }
    );
  if (error) raise(error, '取引先の施設設定を保存できませんでした。');
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

// 開いている施設（ab_fac）に施設設定の行がある取引先（オン／オフとも）を、その施設で合成して返す（2026-10-09 複数施設化）。
export async function listPartners(db: SupabaseClient, facilityId: string): Promise<PartnerContext[]> {
  const { data: links, error: linkError } = await db.from('rms_partner_facilities').select('partner_id').eq('facility_id', facilityId);
  if (linkError) raise(linkError, '取引先を読み込めませんでした。');
  const ids = [...new Set(((links ?? []) as { partner_id: string }[]).map((r) => r.partner_id))];
  if (!ids.length) return [];
  const { data, error } = await db
    .from('rms_partners')
    .select(COMMON_COLUMNS)
    .in('id', ids)
    .order('is_active', { ascending: false })
    .order('name');
  if (error) raise(error, '取引先を読み込めませんでした。');
  const bundles = await bundlesOf(db, ((data ?? []) as Record<string, unknown>[]).map(toCommon));
  return bundles
    .map((b) => composePartnerContext(b, facilityId, { allowDisabled: true }))
    .filter((p): p is PartnerContext => !!p && p.facility_id === facilityId);
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

// 取引先を読み、開いている施設（ab_fac）に施設設定の行があるかを必ず確かめる（無い施設の取引先は触らせない）。
// 返すのはその施設で合成した取引先（オフの施設でも合成する・facility_available=false）。
export async function requireStaffPartner(db: SupabaseClient, facilityId: string, partnerId: string): Promise<PartnerContext> {
  if (!/^[0-9a-f-]{36}$/i.test(partnerId)) throw new PartnerStoreError('取引先が見つかりません。', 404, 'not_found');
  const bundle = await loadBundle(db, { id: partnerId });
  if (!bundle || !bundle.facilities.some((f) => f.facility_id === facilityId && !f.synthetic)) {
    throw new PartnerStoreError('取引先が見つかりません。', 404, 'not_found');
  }
  const partner = composePartnerContext(bundle, facilityId, { allowDisabled: true });
  if (!partner || partner.facility_id !== facilityId) throw new PartnerStoreError('取引先が見つかりません。', 404, 'not_found');
  return partner;
}

// ---- 管理画面の詳細（共通セクション × 施設タブ・複数施設化 S3・§7.12・2026-10-09） ----

/** Book が扱う施設の slug・名前（施設タブ・一覧の施設バッジ用）。並びは Book の施設の並び */
export async function bookFacilityMeta(db: SupabaseClient): Promise<{ id: string; slug: string; name: string }[]> {
  const meta = await facilityMeta(db, BOOK_FACILITY_ORDER);
  return BOOK_FACILITY_ORDER.filter((id) => meta.has(id)).map((id) => ({ id, ...meta.get(id)! }));
}

/** 管理画面の取引先の詳細: 取引先（共通＋施設設定）・選んだ施設で合成したもの・その施設の設定の行（無ければ null） */
export type StaffPartnerView = { bundle: PartnerBundle; partner: PartnerContext; row: PartnerFacilityInfo | null };

/**
 * 管理画面で取引先を開く（§7.12: ab_fac を切り替えても一覧へ戻さない）。見せてよいのは、
 *   - スタッフのテナントの取引先で、
 *   - 施設設定の行がある施設のどれか（ab_fac の施設を含む）にスタッフがアクセスできるもの（canAccess で確かめる）。
 *     行が1つも無い取引先（行の削除・バックフィル漏れ）は、施設をオンにし直せるよう見せる。
 * 合成は facilityId（施設タブ）の施設で行う。その施設に行が無ければ、販売しない既定値で補って合成する
 * （タブには「この施設では販売していません」を出す・row は null）。どれにも当たらなければ 404。
 */
export async function loadStaffPartnerView(
  db: SupabaseClient,
  partnerId: string,
  opts: { tenantId: string; facilityId: string; canAccess: (facilityId: string) => Promise<boolean> }
): Promise<StaffPartnerView> {
  const notFound = () => new PartnerStoreError('取引先が見つかりません。', 404, 'not_found');
  if (!/^[0-9a-f-]{36}$/i.test(partnerId) || !isBookFacility(opts.facilityId)) throw notFound();
  const bundle = await loadBundle(db, { id: partnerId });
  if (!bundle || bundle.common.tenant_id !== opts.tenantId) throw notFound();
  const real = bundle.facilities.filter((f) => !f.synthetic);
  if (real.length) {
    let allowed = false;
    for (const f of real) {
      if (await opts.canAccess(f.facility_id)) {
        allowed = true;
        break;
      }
    }
    if (!allowed) throw notFound();
  }
  // 補った行（synthetic）は取り除き、タブの施設に行が無ければその施設だけ補う
  const view: PartnerBundle = { common: bundle.common, facilities: real };
  const row = real.find((f) => f.facility_id === opts.facilityId) ?? null;
  if (!row) {
    const meta = (await facilityMeta(db, [opts.facilityId])).get(opts.facilityId);
    if (!meta) throw notFound();
    view.facilities = [...real, { ...syntheticFacilityRow(bundle.common, opts.facilityId), ...meta, synthetic: true }].sort(facilityOrder);
  }
  const partner = composePartnerContext(view, opts.facilityId, { allowDisabled: true });
  if (!partner || partner.facility_id !== opts.facilityId) throw notFound();
  return { bundle: view, partner, row };
}

/**
 * 「すべて」の一覧（N8）: テナントの取引先すべてを返す。ab_fac の施設に行があればその施設で、無ければ既定の施設で合成する
 * （施設のバッジは facilities を見る）。onCurrent = ab_fac の施設に施設設定の行がある。
 */
export async function listTenantPartners(
  db: SupabaseClient,
  tenantId: string,
  facilityId: string
): Promise<{ partner: PartnerContext; onCurrent: boolean }[]> {
  const { data, error } = await db
    .from('rms_partners')
    .select(COMMON_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('is_active', { ascending: false })
    .order('name');
  if (error) raise(error, '取引先を読み込めませんでした。');
  const bundles = await bundlesOf(db, ((data ?? []) as Record<string, unknown>[]).map(toCommon));
  const out: { partner: PartnerContext; onCurrent: boolean }[] = [];
  for (const b of bundles) {
    const onCurrent = b.facilities.some((f) => f.facility_id === facilityId && !f.synthetic);
    const partner = composePartnerContext(b, onCurrent ? facilityId : null, { allowDisabled: true });
    if (partner) out.push({ partner, onCurrent });
  }
  return out;
}

/**
 * 共通セクションの保存（?/saveCommon）: rms_partners の共通の列と booking_settings（共通の部分・N6 の既定）だけを書く。
 * 施設の行（rms_partner_facilities）には触らない（施設タブの未保存の編集・施設の上書きを消さない）。
 */
export async function updatePartnerCommon(
  db: SupabaseClient,
  partner: Pick<PartnerCommonRow, 'id' | 'common_settings'>,
  userId: string | null,
  input: Pick<PartnerSettingsInput, (typeof COMMON_INPUT_KEYS)[number]> & { booking_settings: PartnerBookingSettings }
): Promise<Record<string, unknown>> {
  const common: Record<string, unknown> = {};
  for (const k of COMMON_INPUT_KEYS) common[k] = input[k];
  const bookingSettings = buildPartnerCommonSettings(partner.common_settings, input.booking_settings);
  const { error } = await db
    .from('rms_partners')
    .update({ ...common, booking_settings: bookingSettings, updated_by: userId })
    .eq('id', partner.id);
  if (error) raise(error, '取引先を保存できませんでした。');
  return bookingSettings;
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

// 取引先共通（rms_partners）の列と、施設ごと（rms_partner_facilities）の列
const COMMON_INPUT_KEYS = ['name', 'kind', 'contact_name', 'contact_email', 'is_active', 'valid_from', 'valid_until', 'note'] as const;
const FACILITY_INPUT_KEYS = ['max_days_ahead', 'show_inventory', 'include_advance', 'pricing', 'booking_enabled'] as const;

/**
 * 画面の設定（共通と施設が混ざった形）を、rms_partners と rms_partner_facilities の更新に振り分ける（§4・§5.2）。
 * booking_settings は splitPartnerBookingSettings で分ける。共通の jsonb には、Phase D まで残る旧い施設ごとのキー
 * （planNames など）を今の値のまま残す（書き換えない・巻き戻し時の互換）。施設の jsonb は今の値に重ねる
 * （上書き中の N6 キーは施設へ戻す）。
 */
function splitSettingsInput(
  current: Pick<PartnerCommonRow, 'common_settings'> & { facility_settings: Record<string, unknown> },
  input: Partial<PartnerSettingsInput>
): { common: Record<string, unknown>; facility: PartnerFacilityPatch } {
  const common: Record<string, unknown> = {};
  const facility: Record<string, unknown> = {};
  for (const k of COMMON_INPUT_KEYS) if (input[k] !== undefined) common[k] = input[k];
  for (const k of FACILITY_INPUT_KEYS) if (input[k] !== undefined) facility[k] = input[k];
  if (input.booking_settings) {
    const split = splitPartnerBookingSettings(input.booking_settings, partnerFacilityOverrides(current.facility_settings));
    const legacy = Object.fromEntries(
      PARTNER_FACILITY_SETTING_KEYS.filter((k) => k in current.common_settings).map((k) => [k, current.common_settings[k]])
    );
    common.booking_settings = { ...legacy, ...split.common };
    facility.facility_settings = { ...current.facility_settings, ...split.facility };
  }
  return { common, facility: facility as PartnerFacilityPatch };
}

/**
 * 取引先を作る。共通の行（rms_partners）と、作った施設（管理画面の施設）の施設設定を1行作る。
 * 旧 facility_id は Phase D まで互換で入れる（他アプリ・旧い DB 関数の経路のため）。primary_facility_id も同じ施設。
 */
export async function createPartner(
  db: SupabaseClient,
  scope: { tenantId: string; facilityId: string; userId: string | null },
  input: PartnerSettingsInput
): Promise<PartnerContext> {
  if (!isBookFacility(scope.facilityId)) throw new PartnerStoreError('この施設には取引先を作れません。', 400, 'bad_facility');
  const split = splitSettingsInput({ common_settings: {}, facility_settings: {} }, input);
  const { data, error } = await db
    .from('rms_partners')
    .insert({
      ...split.common,
      tenant_id: scope.tenantId,
      facility_id: scope.facilityId,
      primary_facility_id: scope.facilityId,
      url_token: randomToken(18),
      created_by: scope.userId,
      updated_by: scope.userId
    })
    .select('id')
    .single();
  if (error) raise(error, '取引先を登録できませんでした。');
  const id = String(data.id);
  try {
    await savePartnerFacility(db, { id, tenant_id: scope.tenantId }, scope.facilityId, { ...split.facility, enabled: true }, scope.userId);
  } catch (e) {
    // 施設設定を作れなければ取引先も残さない（施設の無い取引先を作らない）
    await db.from('rms_partners').delete().eq('id', id);
    throw e;
  }
  const created = await loadPartnerContext(db, id, scope.facilityId, { allowDisabled: true });
  if (!created) throw new PartnerStoreError('取引先を登録できませんでした。', 500, 'db_error');
  return created;
}

/**
 * 取引先の設定を保存する。共通の項目は rms_partners、施設の項目は「いま合成している施設」（partner.facility_id・
 * 管理画面では ab_fac の施設）の rms_partner_facilities へ。rms_partners の旧い施設の列は書かない（§5.2）。
 */
export async function updatePartner(
  db: SupabaseClient,
  partner: PartnerRow,
  userId: string | null,
  input: Partial<PartnerSettingsInput>
): Promise<void> {
  const split = splitSettingsInput(partner, input);
  if (Object.keys(split.common).length) {
    const { error } = await db
      .from('rms_partners')
      .update({ ...split.common, updated_by: userId })
      .eq('id', partner.id);
    if (error) raise(error, '取引先を保存できませんでした。');
  }
  if (Object.keys(split.facility).length) await savePartnerFacility(db, partner, partner.facility_id, split.facility, userId);
}

// ============================================================================
// PMS の顧客マスタ（core.guests の旅行会社・法人）との紐づけ（Phase 1・docs/partner-pms-customer-link.md §5.7・§6.1）。
// core.guests はテナント単位の共有表。service_role で読むので、tenant_id と種別（group / corporate）の絞り込みが命綱。
// 返す列は §5.7 の範囲に限る（住所・電話・メール等の個人情報は読まない）。
// ============================================================================

const PMS_PARTNER_GUEST_COLUMNS =
  'id, tenant_id, guest_type, name, name_kana, corporate_name, corporate_name_kana, branch, legal_form, legal_form_position, guest_code, updated_at';
const PMS_PARTNER_GUEST_SEARCH_LIMIT = 20;
// 部分一致で探す列（名前・法人名・かな・顧客コード）
const PMS_PARTNER_GUEST_SEARCH_FIELDS = ['corporate_name', 'name', 'corporate_name_kana', 'name_kana', 'guest_code'] as const;

function toPmsPartnerGuest(row: Record<string, unknown>): PmsPartnerGuest | null {
  if (!isPmsPartnerGuestType(row.guest_type)) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    id: row.id as string,
    guestType: row.guest_type,
    formalName: pmsGuestFormalName(row as PmsGuestNameFields) || '（名称未設定）',
    recipientName: pmsGuestFormalName(row as PmsGuestNameFields),
    kana: str(row.corporate_name_kana) ?? str(row.name_kana),
    branch: str(row.branch),
    guestCode: str(row.guest_code),
    updatedAt: (row.updated_at as string | null) ?? null
  };
}

/** PMS の顧客（旅行会社・法人）を名前・法人名・かな・顧客コードの部分一致で探す（最大20件）。 */
export async function searchPmsPartnerGuests(db: SupabaseClient, tenantId: string, query: string): Promise<PmsPartnerGuest[]> {
  const pattern = ilikeContainsPattern(query);
  if (!pattern) return [];
  // PostgREST の or() は値の引用・エスケープが二重になり壊れやすいので、列ごとに ilike を並べて投げて結果をまとめる
  const results = await Promise.all(
    PMS_PARTNER_GUEST_SEARCH_FIELDS.map((field) =>
      db
        .schema('core')
        .from('guests')
        .select(PMS_PARTNER_GUEST_COLUMNS)
        .eq('tenant_id', tenantId)
        .in('guest_type', [...PMS_PARTNER_GUEST_TYPES])
        .ilike(field, pattern)
        .order('updated_at', { ascending: false })
        .limit(PMS_PARTNER_GUEST_SEARCH_LIMIT)
    )
  );
  const byId = new Map<string, PmsPartnerGuest>();
  for (const { data, error } of results) {
    if (error) raise(error, 'PMS の顧客を検索できませんでした。');
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      // 念のためテナントを再確認（service_role は RLS を通らない）
      if (row.tenant_id !== tenantId || byId.has(row.id as string)) continue;
      const g = toPmsPartnerGuest(row);
      if (g) byId.set(g.id, g);
    }
  }
  return [...byId.values()]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, PMS_PARTNER_GUEST_SEARCH_LIMIT);
}

/** 紐づけ先の顧客を1件読む。同じテナントの旅行会社・法人でなければ null（統合・種別変更で外れた場合も null）。 */
export async function getPmsPartnerGuest(db: SupabaseClient, tenantId: string, id: string | null): Promise<PmsPartnerGuest | null> {
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await db
    .schema('core')
    .from('guests')
    .select(PMS_PARTNER_GUEST_COLUMNS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) raise(error, 'PMS の顧客を読み込めませんでした。');
  return data ? toPmsPartnerGuest(data as Record<string, unknown>) : null;
}

/**
 * 取引先を PMS の顧客に紐づける（guestId = null で外す）。
 * 取引先がその施設のもの、顧客が同じテナントの旅行会社・法人であることを確かめてから更新する。
 * 名義（booking_name_mode）は外したときに DB のトリガーが 'guest' へ戻す。
 */
export async function setPartnerPmsGuest(
  db: SupabaseClient,
  facilityId: string,
  partnerId: string,
  guestId: string | null,
  userId: string | null = null
): Promise<{ partner: PartnerContext; guest: PmsPartnerGuest | null }> {
  const partner = await requireStaffPartner(db, facilityId, partnerId);
  let guest: PmsPartnerGuest | null = null;
  if (guestId) {
    guest = await getPmsPartnerGuest(db, partner.tenant_id, guestId);
    if (!guest) throw new PartnerStoreError('紐づけ先の顧客が見つかりません（旅行会社・法人の顧客だけを選べます）。', 404, 'not_found');
  }
  const { error } = await db
    .from('rms_partners')
    .update({ pms_guest_id: guest?.id ?? null, updated_by: userId })
    .eq('id', partner.id);
  if (error) raise(error, 'PMS の顧客との紐づけを保存できませんでした。');
  return { partner: { ...partner, pms_guest_id: guest?.id ?? null }, guest };
}

/**
 * 予約名義を変える（Phase 2）。'partner'（旅行会社名で取る）は、紐づけ先が同じテナントの旅行会社・法人として
 * 読めるときだけ受け付ける（紐づけ無し・紐づけ先が見つからないときは拒否）。'guest' はいつでも戻せる。
 * DB 側もトリガーで「pms_guest_id が null なら guest」に倒すが、画面の結果と食い違わないようここでも確かめる。
 */
export async function setPartnerBookingNameMode(
  db: SupabaseClient,
  facilityId: string,
  partnerId: string,
  mode: BookingNameMode,
  userId: string | null = null
): Promise<PartnerContext> {
  const partner = await requireStaffPartner(db, facilityId, partnerId);
  if (mode === 'partner') {
    const guest = await getPmsPartnerGuest(db, partner.tenant_id, partner.pms_guest_id);
    if (!guest) {
      throw new PartnerStoreError('「旅行会社名で取る」は、PMS の旅行会社・法人の顧客に紐づけてから選べます。', 409, 'not_linked');
    }
  }
  const { data, error } = await db
    .from('rms_partners')
    .update({ booking_name_mode: mode, updated_by: userId })
    .eq('id', partner.id)
    .select('booking_name_mode')
    .single();
  if (error) raise(error, '予約名義を保存できませんでした。');
  const saved = { ...partner, booking_name_mode: normalizeBookingNameMode(data.booking_name_mode) };
  // トリガーで guest に戻された（同時に紐づけが外れた等）なら、そのことを伝える
  if (saved.booking_name_mode !== mode) {
    throw new PartnerStoreError('予約名義を「旅行会社名で取る」にできませんでした（紐づけが外れています）。画面を読み直してください。', 409, 'not_linked');
  }
  return saved;
}

// ============================================================================
// 与信（受付枠）Phase 3a（docs/partner-pms-customer-link.md §5.4〜5.7・§6.1）。
// 判定は public.rms_partner_credit_check、設定の更新は public.rms_partner_set_agency_credit（どちらも service_role のみ・
// autumn-shared 20261007000239）。呼び出し側が権限（閲覧＝admin/staff、設定の編集＝admin）を確かめてから呼ぶ。
// ============================================================================

/**
 * 受付枠の判定（月別）。紐づけ先が無ければ null。旅行会社以外・与信 OFF は enabled=false の結果が返る。
 * add はこの予約で足す延べ室数（月別・stayRoomNightsByMonth）。施設は取引先の施設（枠は施設ごと）。
 */
export async function partnerCreditCheck(
  db: SupabaseClient,
  partner: Pick<PartnerRow, 'pms_guest_id' | 'facility_id'>,
  months: readonly string[],
  add: Record<string, number> = {}
): Promise<CreditCheck | null> {
  if (!partner.pms_guest_id || !months.length) return null;
  const { data, error } = await db.rpc('rms_partner_credit_check', {
    p_guest: partner.pms_guest_id,
    p_facility: partner.facility_id,
    p_months: [...new Set(months)].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort(),
    p_add: add
  });
  if (error) raise(error, '受付枠を読み込めませんでした。');
  return normalizeCreditCheck(data);
}

/** 管理画面の与信設定の編集フォーム用: 紐づけ先（旅行会社）の与信の4キー・最終更新と、楽観ロック用の updated_at。 */
export type AgencyCreditState = ReturnType<typeof readAgencyCreditMeta> & { guestId: string; guestUpdatedAt: string };

export async function getAgencyCreditState(db: SupabaseClient, tenantId: string, guestId: string | null): Promise<AgencyCreditState | null> {
  if (!guestId || !/^[0-9a-f-]{36}$/i.test(guestId)) return null;
  const { data, error } = await db
    .schema('core')
    .from('guests')
    .select('id, tenant_id, guest_type, updated_at, metadata')
    .eq('id', guestId)
    .eq('tenant_id', tenantId)
    .maybeSingle();
  if (error) raise(error, '与信の設定を読み込めませんでした。');
  // 与信は旅行会社（group）だけ（法人には出さない・決定 #6）
  if (!data || data.guest_type !== 'group') return null;
  // metadata は与信の4キーと最終更新だけを取り出して返す（他のキーは画面に渡さない）
  return { ...readAgencyCreditMeta(data.metadata), guestId: data.id as string, guestUpdatedAt: String(data.updated_at) };
}

/**
 * 与信設定を保存する（管理者のみ・呼び出し側で確認）。紐づけ先がこの取引先の旅行会社であることを確かめ、
 * metadata.pms の与信の4キーだけを DB 関数で部分更新する（PMS が書いた他のキーを消さない）。
 * expectedUpdatedAt（画面に出した時点の core.guests.updated_at）が違えば conflict を返す。
 */
export async function setAgencyCredit(
  db: SupabaseClient,
  facilityId: string,
  partnerId: string,
  patch: CreditSettingsPatch,
  actorUserId: string | null,
  expectedUpdatedAt: string | null
): Promise<{ result: 'updated' | 'conflict'; updatedAt: string | null }> {
  const partner = await requireStaffPartner(db, facilityId, partnerId);
  const state = await getAgencyCreditState(db, partner.tenant_id, partner.pms_guest_id);
  if (!state) throw new PartnerStoreError('与信は、PMS の旅行会社に紐づけた取引先だけで設定できます。', 409, 'not_agency');
  if (!expectedUpdatedAt) throw new PartnerStoreError('画面を読み直してから保存してください。', 409, 'conflict');
  const { data, error } = await db.rpc('rms_partner_set_agency_credit', {
    p_guest: state.guestId,
    p_patch: patch,
    p_actor: `book:${actorUserId ?? 'unknown'}`,
    p_expected_updated_at: expectedUpdatedAt
  });
  if (error) {
    const m = error.message ?? '';
    if (m.includes('not_agency')) throw new PartnerStoreError('紐づけ先が旅行会社ではないため、与信を設定できません。', 409, 'not_agency');
    if (m.includes('invalid_growth_rate')) throw new PartnerStoreError('増加率は 0〜1000 の数で入力してください（％）。');
    if (m.includes('invalid_min_rooms')) throw new PartnerStoreError('最低枠は 0〜9999 の整数で入力してください（室/月）。');
    if (m.includes('guest_not_found')) throw new PartnerStoreError('紐づけ先の顧客が見つかりません。', 404, 'not_found');
    raise(error, '与信の設定を保存できませんでした。');
  }
  const r = (data ?? {}) as { result?: string; updated_at?: string | null };
  return { result: r.result === 'updated' ? 'updated' : 'conflict', updatedAt: r.updated_at ?? null };
}

/**
 * デポジットの設定（Phase 3b・取引先ごと・管理者のみ）: 額の決め方と残額の精算先。
 * booking_settings の2キーだけを差し替える（他の受付ルールは今の DB の値のまま）。
 * remainder = null は既定（請求書払いの支払方法があれば請求書、無ければ現地）。
 */
export async function setPartnerCreditDeposit(
  db: SupabaseClient,
  facilityId: string,
  partnerId: string,
  input: { deposit: CreditDeposit; remainder: CreditDepositRemainder | null },
  userId: string | null = null
): Promise<PartnerContext> {
  const partner = await requireStaffPartner(db, facilityId, partnerId);
  // デポジットは取引先共通のキー（§4.2）。共通の jsonb の2キーだけを差し替える（他のキーは今の DB の値のまま）
  const normalized = normalizePartnerBookingSettings({ creditDeposit: input.deposit, creditDepositRemainder: input.remainder });
  const commonSettings = {
    ...partner.common_settings,
    creditDeposit: normalized.creditDeposit,
    creditDepositRemainder: normalized.creditDepositRemainder
  };
  const { error } = await db
    .from('rms_partners')
    .update({ booking_settings: commonSettings, updated_by: userId })
    .eq('id', partner.id);
  if (error) raise(error, 'デポジットの設定を保存できませんでした。');
  return {
    ...partner,
    common_settings: commonSettings,
    booking_settings: normalizePartnerBookingSettings(commonSettings, partner.facility_settings)
  };
}

/** 超過時の挙動を保存する（deposit / warn / ignore）。 */
export async function setPartnerCreditOverAction(
  db: SupabaseClient,
  facilityId: string,
  partnerId: string,
  action: CreditOverAction,
  userId: string | null = null
): Promise<PartnerContext> {
  if (!isSelectableCreditOverAction(action)) throw new PartnerStoreError('超過時の挙動の指定が正しくありません。');
  const partner = await requireStaffPartner(db, facilityId, partnerId);
  const { data, error } = await db
    .from('rms_partners')
    .update({ credit_over_action: action, updated_by: userId })
    .eq('id', partner.id)
    .select('credit_over_action')
    .single();
  if (error) raise(error, '超過時の挙動を保存できませんでした。');
  return { ...partner, credit_over_action: normalizeCreditOverAction(data.credit_over_action) };
}

/**
 * 予約の名義表示用: 顧客 ID → 正式名称（法人格つき）。旅行会社・法人でない・読めない ID は入らない。
 * 予約時のスナップショット（rms_partner_bookings.pms_guest_id）から引く。返すのは名称だけ（個人情報は読まない）。
 */
export async function pmsGuestFormalNames(
  db: SupabaseClient,
  ids: readonly (string | null | undefined)[],
  tenantId?: string
): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((id): id is string => !!id && /^[0-9a-f-]{36}$/i.test(id)))];
  const out = new Map<string, string>();
  if (!uniq.length) return out;
  let query = db.schema('core').from('guests').select(PMS_PARTNER_GUEST_COLUMNS).in('id', uniq);
  if (tenantId) query = query.eq('tenant_id', tenantId);
  const { data, error } = await query;
  if (error) return out; // 名義の表示は補助情報。読めなければ呼び出し側が取引先名で代える
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const g = toPmsPartnerGuest(row);
    if (g?.recipientName) out.set(g.id, g.recipientName);
  }
  return out;
}

// 限定URLを作り直す（旧URLは即無効。ログイン中のセッションも切る）。
export async function regeneratePartnerUrl(db: SupabaseClient, partner: Pick<PartnerRow, 'id'>, userId: string | null): Promise<string> {
  const token = randomToken(18);
  const { error } = await db
    .from('rms_partners')
    .update({ url_token: token, updated_by: userId })
    .eq('id', partner.id);
  if (error) raise(error, '限定URLを再発行できませんでした。');
  await revokeSessionsOfPartner(db, partner.id);
  return token;
}

export async function deletePartner(db: SupabaseClient, partner: Pick<PartnerRow, 'id'>): Promise<void> {
  // 覚書ファイルの実体（Storage）を先に消す。台帳は FK cascade で消える
  await removeAllPartnerDocumentFiles(db, partner.id);
  // 取引先予約の添付ファイルの実体も（2026-10-07。台帳は FK cascade。PMS の写しの行は PMS の運用に任せる）
  await removeAllBookingAttachmentFiles(db, partner.id);
  // 施設設定（rms_partner_facilities）は FK cascade で消える
  const { error } = await db.from('rms_partners').delete().eq('id', partner.id);
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

/**
 * 限定URLのトークンから取引先を引く（共通の行と施設設定の束）。無ければ null（存在の有無は取引先に区別させない）。
 * 施設の選択（クッキー・?f=）は portal.ts の resolvePortal が行い、composePartnerContext で合成する。
 */
export async function findPartnerBundleByUrlToken(db: SupabaseClient, urlToken: string): Promise<PartnerBundle | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(urlToken)) return null;
  const bundle = await loadBundle(db, { urlToken });
  // Book が扱う施設の設定が1つも無い取引先は「見つからない」扱い（別施設の料金・予約を出さない）
  return bundle && bundle.facilities.length ? bundle : null;
}

// 限定URLのトークンから取引先を引き、施設を選んで合成する（facilityId 省略 = 既定の施設）。
export async function findPartnerByUrlToken(db: SupabaseClient, urlToken: string, facilityId?: string | null): Promise<PartnerContext | null> {
  const bundle = await findPartnerBundleByUrlToken(db, urlToken);
  return bundle ? composePartnerContext(bundle, facilityId) : null;
}

// deviceId: 端末クッキー rms_partner_device のハッシュ（portal.ts partnerDeviceId・docs/auth-hardening.md §4.3）。
// ログインとパスワード設定でだけ渡す（セッション行の device_id と、ログの detail.device に残す）
export type RequestMeta = { ip: string | null; userAgent: string | null; deviceId?: string | null };

export async function logPartnerAccess(
  db: SupabaseClient,
  entry: {
    partnerId: string;
    accountId?: string | null;
    apiKeyId?: string | null;
    // admin = 宿（管理画面）の操作（本人確認の方針の変更・第2要素のリセット・S6）
    channel: 'web' | 'api' | 'admin';
    action: string;
    detail?: Record<string, unknown>;
    ip?: string | null;
  }
) {
  // 管理画面からの確認モードは記録しない（取引先の利用状況に運営の確認を混ぜない）
  if (entry.accountId === PREVIEW_ACCOUNT_ID) return;
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

// opts.mfaPending: ログイン直後に本人確認を求める（mfa_method に印 'required' を付ける・aal は 1 のまま・§6.2）。
// 印が付いたセッションは、本人確認が済むまで /mfa 以外を使えない（portal.ts の関所）
// opts.passkey: パスキーでログインした（はじめから aal=2・mfa_method='passkey'・§6.5）
// opts.setup: パスワード設定リンクから入った（mfa_method に印 'setup'・aal は 1。passkey_only の初回のパスキー登録だけに使う・§6.8）
async function startSession(
  db: SupabaseClient,
  accountId: string,
  meta: RequestMeta,
  opts: { mfaPending?: boolean; passkey?: boolean; setup?: boolean } = {}
): Promise<string> {
  const token = randomToken(32);
  const mfa = opts.passkey
    ? { aal: 2, mfa_at: new Date().toISOString(), mfa_method: 'passkey' }
    : opts.mfaPending
      ? { mfa_method: MFA_PENDING_MARK }
      : opts.setup
        ? { mfa_method: MFA_SETUP_MARK }
        : {};
  const { error } = await db.from('rms_partner_sessions').insert({
    account_id: accountId,
    token_hash: await sha256Hex(token),
    expires_at: new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString(),
    user_agent: meta.userAgent?.slice(0, 300) ?? null,
    ip: meta.ip,
    device_id: meta.deviceId ?? null,
    ...mfa
  });
  if (error) raise(error, 'ログインできませんでした。');
  // 期限切れセッションの掃除（ついでに・失敗は無視）。
  await db.from('rms_partner_sessions').delete().lt('expires_at', new Date().toISOString()).then(
    () => undefined,
    () => undefined
  );
  return token;
}

export type LoginResult =
  | {
      ok: true;
      sessionToken: string;
      account: Pick<PartnerAccountRow, 'id' | 'login_id' | 'display_name' | 'email' | 'is_master'>;
      /** 新しい環境（端末も IP も直近 90 日に無い）からのログインか（§4.3） */
      newEnvironment: boolean;
      /** ログインの直後に本人確認（/mfa）を求める理由（§6.2）。求めない → null */
      stepUp: LoginStepUpReason | null;
    }
  | { ok: false; message: string };

// 失敗・ロック中・レート制限中を外から区別できない統一文言（§4.5）。
// 内部ログ（access_logs）には login_failed / login_locked / login_rate_limited を区別して残す。
export const GENERIC_LOGIN_ERROR = 'ログインIDまたはパスワードが違うか、しばらくの間ログインを制限しています。数分おいてからお試しください。';

/**
 * アカウントの直近 90 日のログイン環境（端末・IP）。新しい環境の判定（isNewEnvironment）の材料。
 * セッション行は期限切れで消えるので、アクセスログ（login / password_set の ip と detail.device）も合わせて見る。
 * 読めなかったときは null（通知を送らない側に倒す＝ログインを止めない・通知を乱発しない）。
 */
async function loginHistory(db: SupabaseClient, partnerId: string, accountId: string): Promise<LoginHistoryEntry[] | null> {
  const since = new Date(Date.now() - NEW_ENVIRONMENT_LOOKBACK_DAYS * 86400_000).toISOString();
  const [sessions, logs] = await Promise.all([
    db.from('rms_partner_sessions').select('device_id, ip').eq('account_id', accountId).gte('created_at', since).limit(200),
    db
      .from('rms_partner_access_logs')
      .select('ip, detail')
      .eq('partner_id', partnerId)
      .eq('account_id', accountId)
      .in('action', ['login', 'password_set', 'passkey_login'])
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(200)
  ]);
  if (sessions.error || logs.error) return null;
  return [
    ...((sessions.data ?? []) as { device_id: string | null; ip: string | null }[]).map((r) => ({ deviceId: r.device_id, ip: r.ip })),
    ...((logs.data ?? []) as { ip: string | null; detail: { device?: unknown } | null }[]).map((r) => ({
      deviceId: typeof r.detail?.device === 'string' ? r.detail.device : null,
      ip: r.ip
    }))
  ];
}

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
  // ロック中も失敗と同じ文言（ID の有無・ロック中かを外から区別させない・§4.5）
  if (account.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
    await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'login_locked', ip: meta.ip });
    return { ok: false, message: GENERIC_LOGIN_ERROR };
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
  // 新しい環境かは、このログインのセッションを作る前の履歴で判定する（§4.3）
  const history = await loginHistory(db, partner.id, account.id).catch(() => null);
  const newEnvironment = history ? isNewEnvironment(history, meta.deviceId ?? null, meta.ip) : false;
  // ログイン直後の本人確認（§6.2）: always は毎回、step_up はメールがあって新しい環境か 30 日ぶりのとき
  const policy = normalizeMfaPolicy(partner.mfa_policy);
  const hasEmail = Boolean(String(account.email ?? '').trim());
  const lastMfaAt = policy === 'step_up' && hasEmail && !newEnvironment ? await lastMfaOkAt(db, partner.id, account.id).catch(() => null) : null;
  const stepUp = loginStepUpReason({ policy, newEnvironment, hasEmail, lastMfaAt });
  const sessionToken = await startSession(db, account.id, meta, { mfaPending: stepUp !== null });
  await logPartnerAccess(db, {
    partnerId: partner.id,
    accountId: account.id,
    channel: 'web',
    action: 'login',
    detail: meta.deviceId ? { device: meta.deviceId } : undefined,
    ip: meta.ip
  });
  return {
    ok: true,
    sessionToken,
    account: { id: account.id, login_id: account.login_id, display_name: account.display_name, email: account.email, is_master: account.is_master },
    newEnvironment,
    stepUp
  };
}

/**
 * パスキーでのログイン（docs/auth-hardening.md §6.5・S6）。パスキーの署名・counter の検証は呼ぶ側（passkeys.ts）で済ませてから呼ぶ。
 * accountId はパスキーから引いたアカウント。ここでも「この取引先の・有効な・パスワード設定済みの」アカウントかを DB で確かめる
 * （別の取引先のパスキーで入れない）。セッションははじめから aal=2（mfa_method='passkey'）。
 * アカウント単位のロック（パスワードの失敗）はパスワードのためのものなので、パスキーのログインは止めない（数えも戻さない）。
 */
export async function loginPartnerWithPasskey(
  db: SupabaseClient,
  partner: Pick<PartnerContext, 'id'>,
  accountId: string,
  meta: RequestMeta & { passkeyId?: string }
): Promise<Extract<LoginResult, { ok: true }> | null> {
  const { data, error } = await db
    .from('rms_partner_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .eq('partner_id', partner.id)
    .maybeSingle();
  if (error) raise(error, 'ログインできませんでした。');
  const account = data as PartnerAccountRow | null;
  if (!account || !account.is_active || !account.password_hash) return null;
  await db.from('rms_partner_accounts').update({ last_login_at: new Date().toISOString() }).eq('id', account.id);
  const history = await loginHistory(db, partner.id, account.id).catch(() => null);
  const newEnvironment = history ? isNewEnvironment(history, meta.deviceId ?? null, meta.ip) : false;
  const sessionToken = await startSession(db, account.id, meta, { passkey: true });
  await logPartnerAccess(db, {
    partnerId: partner.id,
    accountId: account.id,
    channel: 'web',
    action: 'passkey_login',
    detail: { ...(meta.deviceId ? { device: meta.deviceId } : {}), ...(meta.passkeyId ? { passkeyId: meta.passkeyId } : {}) },
    ip: meta.ip
  });
  return {
    ok: true,
    sessionToken,
    account: { id: account.id, login_id: account.login_id, display_name: account.display_name, email: account.email, is_master: account.is_master },
    newEnvironment,
    stepUp: null
  };
}

/** そのアカウントが最後に本人確認を通した時刻（access_logs の mfa_ok・パスキーでのログイン passkey_login・§6.2 の 3）。無ければ null */
async function lastMfaOkAt(db: SupabaseClient, partnerId: string, accountId: string): Promise<string | null> {
  const { data, error } = await db
    .from('rms_partner_access_logs')
    .select('created_at')
    .eq('partner_id', partnerId)
    .eq('account_id', accountId)
    .in('action', ['mfa_ok', 'passkey_login'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return String((data as { created_at: string }).created_at);
}

export type PartnerSessionAccount = Pick<PartnerAccountRow, 'id' | 'login_id' | 'display_name' | 'is_master'> & {
  sessionId: string;
  /** セッションの保証レベル（1 = パスワードのみ・2 = 第2要素済み）と、第2要素を通した時刻・方法（§5.2・§6.6）。
   *  aal2 の有効期間（12 時間）は isAal2Valid で判定する。mfaMethod='required' はログイン直後の本人確認待ちの印 */
  aal?: 1 | 2;
  mfaAt?: string | null;
  mfaMethod?: string | null;
  /** セッションを作った時刻（パスワード設定直後のパスキー初回登録の判定・S6） */
  createdAt?: string | null;
  /** 管理画面からの確認モード（preview.ts）。見るだけで、書き込みは入口で断る */
  preview?: boolean;
};

// クッキーのセッションから、この取引先のアカウントを引く。別の取引先のセッションは通さない。
// partner は取引先の読み込みと並べて走らせられるよう Promise でも受ける（セッションの問い合わせを先に投げる・2026-10-10）。
// opts.defer: 最終アクセスの更新（書き込み）を応答の後へ逃がす先（portal.ts の deferTask → waitUntil）。無ければその場で待つ。
export async function getPartnerSession(
  db: SupabaseClient,
  partner: Pick<PartnerContext, 'id'> | PromiseLike<Pick<PartnerContext, 'id'> | null>,
  sessionToken: string | undefined,
  opts: { defer?: (p: Promise<unknown>) => void } = {}
): Promise<PartnerSessionAccount | null> {
  if (!sessionToken) return null;
  const [{ data }, p] = await Promise.all([
    db
      .from('rms_partner_sessions')
      .select(
        'id, expires_at, created_at, last_seen_at, aal, mfa_at, mfa_method, account:rms_partner_accounts!inner(id, partner_id, login_id, display_name, is_active, is_master)'
      )
      .eq('token_hash', await sha256Hex(sessionToken))
      .maybeSingle(),
    partner
  ]);
  if (!p) return null;
  const row = data as
    | {
        id: string;
        expires_at: string;
        created_at: string | null;
        last_seen_at: string;
        aal: number | null;
        mfa_at: string | null;
        mfa_method: string | null;
        account: { id: string; partner_id: string; login_id: string; display_name: string | null; is_active: boolean; is_master: boolean };
      }
    | null;
  // 発行から 7 日、または最終アクセスから 24 時間で切れ（M3）
  if (!row || !isPartnerSessionAlive(row)) return null;
  if (row.account.partner_id !== p.id || !row.account.is_active) return null;
  // 最終アクセスの更新は5分に1回まで（毎リクエスト書き込まない）。
  // 表示用の記録で、セッションの期限・停止の判定には使わないので、応答を待たせない（defer があれば応答の後で書く）
  if (Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    const touch = Promise.resolve(db.from('rms_partner_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', row.id));
    if (opts.defer) opts.defer(touch);
    else await touch;
  }
  // is_master はリクエストごとに DB から読む（マスタの権限を外したら次のリクエストから効く）
  return {
    id: row.account.id,
    login_id: row.account.login_id,
    display_name: row.account.display_name,
    is_master: row.account.is_master === true,
    sessionId: row.id,
    aal: row.aal === 2 ? 2 : 1,
    mfaAt: row.mfa_at ?? null,
    mfaMethod: row.mfa_method ?? null,
    createdAt: row.created_at ?? null
  };
}

/** 自分のパスワードの再入力を確かめる（メールアドレスを初めて登録するとき・docs/auth-hardening.md M4）。該当なしでも同じ計算をする */
export async function verifyOwnPassword(db: SupabaseClient, partnerId: string, accountId: string, password: string): Promise<boolean> {
  const { data } = await db
    .from('rms_partner_accounts')
    .select('password_hash, is_active')
    .eq('id', accountId)
    .eq('partner_id', partnerId)
    .maybeSingle();
  const row = data as { password_hash: string | null; is_active: boolean } | null;
  const ok = await verifyPassword(password, row?.password_hash);
  return ok && row?.is_active === true;
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
  // 設定リンクから入った印（passkey_only でパスキーが 0 のアカウントが、最初のパスキーを登録できるように・§6.8）
  const sessionToken = await startSession(db, account.id, meta, { setup: true });
  await logPartnerAccess(db, {
    partnerId: partner.id,
    accountId: account.id,
    channel: 'web',
    action: 'password_set',
    detail: meta.deviceId ? { device: meta.deviceId } : undefined,
    ip: meta.ip
  });
  return sessionToken;
}

// API キー（Authorization: Bearer）から取引先を引く。無効・取り消し済みは null。
export async function findPartnerByApiKey(
  db: SupabaseClient,
  apiKey: string
): Promise<{ partner: PartnerContext; apiKeyId: string; bundle: PartnerBundle } | null> {
  if (!apiKey.startsWith(API_KEY_PREFIX) || apiKey.length > 128) return null;
  const { data, error } = await db
    .from('rms_partner_api_keys')
    .select('id, partner_id, revoked_at, last_used_at')
    .eq('key_hash', await sha256Hex(apiKey))
    .maybeSingle();
  if (error) raise(error, 'API キーを確認できませんでした。');
  const key = data as { id: string; partner_id: string; revoked_at: string | null; last_used_at: string | null } | null;
  if (!key || key.revoked_at) return null;
  // 施設は既定の施設（primary → オンの先頭）で合成して返す。API の facility 指定（§7.10）は呼び出し側が bundle で合成し直す
  const bundle = await loadBundle(db, { id: key.partner_id });
  const partner = bundle?.facilities.length ? composePartnerContext(bundle, null) : null;
  if (!bundle || !partner) return null;
  if (!key.last_used_at || Date.now() - new Date(key.last_used_at).getTime() > 5 * 60_000) {
    await db.from('rms_partner_api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', key.id);
  }
  return { partner, apiKeyId: key.id, bundle };
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

export const SAVED_CARD_MASTER_ONLY = 'カードの登録・削除・既定の変更は、貴社のマスタユーザーが行えます。';

// 保存カードの登録・削除・既定の変更をする人が、この取引先の有効なマスタユーザーかを DB で確かめる（docs/auth-hardening.md §5.1・M2）。違えば 403。
export async function requireSavedCardManager(db: SupabaseClient, partnerId: string, actorId: string): Promise<PartnerAccountRow> {
  try {
    const actor = await requireMasterAccount(db, partnerId, actorId);
    if (!canManageSavedCards(actor)) throw new PartnerStoreError(SAVED_CARD_MASTER_ONLY, 403, 'forbidden');
    return actor;
  } catch (e) {
    if (e instanceof PartnerStoreError && e.status === 403) throw new PartnerStoreError(SAVED_CARD_MASTER_ONLY, 403, 'forbidden');
    throw e;
  }
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

// 子ユーザーをすべての端末からログアウトさせる（マスタのユーザー管理・§4.4）。停止はしない。消したセッション数を返す。
export async function revokeAccountSessions(
  db: SupabaseClient,
  partnerId: string,
  actorId: string,
  accountId: string
): Promise<{ account: PartnerAccountRow; count: number }> {
  const { target } = await requireChildTarget(db, partnerId, actorId, accountId);
  const { data, error } = await db.from('rms_partner_sessions').delete().eq('account_id', target.id).select('id');
  if (error) raise(error, 'ログアウトできませんでした。');
  return { account: target, count: (data ?? []).length };
}

// ---- アカウント → セキュリティ（自分のログイン中の端末・ログイン履歴・他端末ログアウト。§4.4） ----
// どれもセッションで確かめた自分のアカウント（accountId = session.id）の行だけを読む・消す。

export type OwnSessionRow = { id: string; created_at: string; last_seen_at: string | null; ip: string | null; user_agent: string | null };

/** 自分のログイン中のセッション（期限内・最終アクセスが新しい順） */
export async function listOwnSessions(db: SupabaseClient, accountId: string): Promise<OwnSessionRow[]> {
  const { data, error } = await db
    .from('rms_partner_sessions')
    .select('id, created_at, expires_at, last_seen_at, ip, user_agent')
    .eq('account_id', accountId)
    .gt('expires_at', new Date().toISOString())
    .gt('last_seen_at', new Date(Date.now() - PARTNER_SESSION_IDLE_HOURS * 3600_000).toISOString())
    .order('last_seen_at', { ascending: false })
    .limit(50);
  if (error) raise(error, 'ログイン中の端末を読み込めませんでした。');
  return ((data ?? []) as (OwnSessionRow & { expires_at: string })[])
    .filter((r) => isPartnerSessionAlive(r))
    .map(({ id, created_at, last_seen_at, ip, user_agent }) => ({ id, created_at, last_seen_at, ip, user_agent }));
}

/** 自分のログイン関係の記録（直近 limit 件） */
export async function listOwnSecurityLogs(db: SupabaseClient, partnerId: string, accountId: string, limit = 30): Promise<PartnerAccessLogRow[]> {
  const { data, error } = await db
    .from('rms_partner_access_logs')
    .select('id, account_id, api_key_id, channel, action, detail, ip, created_at')
    .eq('partner_id', partnerId)
    .eq('account_id', accountId)
    .in('action', [...SECURITY_LOG_ACTIONS])
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) raise(error, 'ログイン履歴を読み込めませんでした。');
  return (data ?? []) as PartnerAccessLogRow[];
}

/** 自分の「いまのセッション以外」をすべて消す。消した数を返す */
export async function revokeOtherSessions(db: SupabaseClient, accountId: string, currentSessionId: string): Promise<number> {
  const { data, error } = await db.from('rms_partner_sessions').delete().eq('account_id', accountId).neq('id', currentSessionId).select('id');
  if (error) raise(error, 'ログアウトできませんでした。');
  return (data ?? []).length;
}

/** 自分のセッションを 1 つ消す（自分のアカウントの行だけ）。消せたら true */
export async function revokeOwnSession(db: SupabaseClient, accountId: string, sessionId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return false;
  const { data, error } = await db.from('rms_partner_sessions').delete().eq('account_id', accountId).eq('id', sessionId).select('id');
  if (error) raise(error, 'ログアウトできませんでした。');
  return (data ?? []).length > 0;
}

/**
 * ログイン通知の宛先（M9: 本人のみ。本人に email が無ければマスタ）。
 * マスタは有効なマスタのうち、メールのある最初の人（作成順）。どちらも無ければ null。
 */
export async function findLoginNoticeRecipient(
  db: SupabaseClient,
  partnerId: string,
  account: Pick<PartnerAccountRow, 'id' | 'email'>
): Promise<{ email: string; to: 'self' | 'master' } | null> {
  const own = String(account.email ?? '').trim();
  if (own) return { email: own, to: 'self' };
  const { data } = await db
    .from('rms_partner_accounts')
    .select('id, email')
    .eq('partner_id', partnerId)
    .eq('is_master', true)
    .eq('is_active', true)
    .neq('id', account.id)
    .not('email', 'is', null)
    .order('created_at')
    .limit(5);
  const master = ((data ?? []) as { email: string | null }[]).map((r) => String(r.email ?? '').trim()).find(Boolean);
  return master ? { email: master, to: 'master' } : null;
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

// ---- 本人確認の方針（rms_partners.mfa_policy）と第2要素のリセット（docs/auth-hardening.md §6.3・§6.8・S6） ----

/**
 * 本人確認の方針を変える。by: 'admin:<スタッフの uuid>'（管理画面）／'master:<アカウント id>'（取引先ページ・厳しくする方向だけ）。
 * 変えたら access_logs に mfa_policy_change（channel は admin / web）。変わらなければ何もしない（changed=false）。
 * 権限（admin か・マスタの厳しくする方向か）は呼ぶ側で確かめる。
 */
export async function setPartnerMfaPolicy(
  db: SupabaseClient,
  args: {
    partnerId: string;
    policy: PartnerMfaPolicy;
    by: string;
    channel: 'admin' | 'web';
    accountId?: string | null;
    ip?: string | null;
    /** 変えてよいかを、いまの方針で確かめる（マスタの「厳しくする方向だけ」）。false なら 403 */
    allow?: (from: PartnerMfaPolicy) => boolean;
  }
): Promise<{ changed: boolean; from: PartnerMfaPolicy }> {
  if (!PARTNER_MFA_POLICIES.includes(args.policy)) throw new PartnerStoreError('本人確認の方針が正しくありません。');
  const { data, error } = await db.from('rms_partners').select('mfa_policy').eq('id', args.partnerId).maybeSingle();
  if (error) raise(error, '取引先を読み込めませんでした。');
  if (!data) throw new PartnerStoreError('取引先が見つかりません。', 404, 'not_found');
  const from = normalizeMfaPolicy((data as { mfa_policy: unknown }).mfa_policy);
  if (from === args.policy) return { changed: false, from };
  if (args.allow && !args.allow(from)) throw new PartnerStoreError('この変更は宿へご依頼ください。', 403, 'forbidden');
  // 読んだ値のままのときだけ変える（同時の変更で記録と食い違わないように）
  const { data: updated, error: e } = await db
    .from('rms_partners')
    .update({ mfa_policy: args.policy })
    .eq('id', args.partnerId)
    .eq('mfa_policy', from)
    .select('id');
  if (e) raise(e, '本人確認の方針を保存できませんでした。');
  if (!(updated ?? []).length) throw new PartnerStoreError('他の操作と重なりました。画面を読み直してからもう一度お試しください。', 409, 'conflict');
  await logPartnerAccess(db, {
    partnerId: args.partnerId,
    accountId: args.accountId ?? null,
    channel: args.channel,
    action: 'mfa_policy_change',
    detail: { from, to: args.policy, by: args.by },
    ip: args.ip ?? null
  });
  return { changed: true, from };
}

/**
 * アカウントの第2要素をリセットする（§6.8）: パスキーを全部消し、メールの確認済み印・TOTP の列（初版は未提供・念のため）を外し、
 * mfa_reset_at / mfa_reset_by を記録し、全セッションと未使用のチャレンジを消す。access_logs に mfa_reset（by: 'admin' / 'master'）。
 * 権限（宿の admin か・マスタが子ユーザーにか）は呼ぶ側で確かめる。パスワード設定リンクの再発行も呼ぶ側（宛先・送り方が違うため）。
 */
export async function resetAccountMfa(
  db: SupabaseClient,
  args: {
    partnerId: string;
    accountId: string;
    by: { kind: 'admin'; staffId: string | null } | { kind: 'master'; accountId: string };
    ip?: string | null;
  }
): Promise<{ account: PartnerAccountRow; passkeys: number; sessions: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(args.accountId)) throw new PartnerStoreError('ログインアカウントが見つかりません。', 404, 'not_found');
  const { data, error } = await db
    .from('rms_partner_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', args.accountId)
    .eq('partner_id', args.partnerId)
    .maybeSingle();
  if (error) raise(error, 'ログインアカウントを読み込めませんでした。');
  const account = data as PartnerAccountRow | null;
  if (!account) throw new PartnerStoreError('ログインアカウントが見つかりません。', 404, 'not_found');
  const byText = args.by.kind === 'admin' ? `admin:${args.by.staffId ?? 'unknown'}` : `master:${args.by.accountId}`;
  const { data: removed, error: pe } = await db.from('rms_partner_passkeys').delete().eq('account_id', account.id).select('id');
  if (pe) raise(pe, 'パスキーを削除できませんでした。');
  const { error: ae } = await db
    .from('rms_partner_accounts')
    .update({
      email_verified_at: null,
      totp_secret_enc: null,
      totp_confirmed_at: null,
      totp_backup_codes_hash: null,
      mfa_reset_at: new Date().toISOString(),
      mfa_reset_by: byText
    })
    .eq('id', account.id)
    .eq('partner_id', args.partnerId);
  if (ae) raise(ae, '第2要素をリセットできませんでした。');
  const { data: sessions } = await db.from('rms_partner_sessions').delete().eq('account_id', account.id).select('id');
  await db
    .from('rms_partner_mfa_challenges')
    .delete()
    .eq('account_id', account.id)
    .then(
      () => undefined,
      () => undefined
    );
  const result = { passkeys: (removed ?? []).length, sessions: (sessions ?? []).length };
  // 本人のログとして残す（セキュリティタブの履歴にも出る）。操作した人は detail.actor
  await logPartnerAccess(db, {
    partnerId: args.partnerId,
    accountId: account.id,
    channel: args.by.kind === 'admin' ? 'admin' : 'web',
    action: 'mfa_reset',
    detail: { by: args.by.kind, actor: byText, ...result },
    ip: args.ip ?? null
  });
  return { account, ...result };
}

/** マスタが子ユーザーの第2要素をリセットする（ユーザー管理・§6.8。本人確認はマスタの責任）。対象は同じ取引先の子ユーザーだけ */
export async function resetChildMfa(
  db: SupabaseClient,
  partnerId: string,
  actorId: string,
  accountId: string,
  ip: string | null
): Promise<{ account: PartnerAccountRow; passkeys: number; sessions: number }> {
  const { actor, target } = await requireChildTarget(db, partnerId, actorId, accountId);
  if (!canResetMfa({ ...actor, is_active: true }, target)) throw new PartnerStoreError('このユーザーは操作できません。', 403, 'forbidden');
  return resetAccountMfa(db, { partnerId, accountId: target.id, by: { kind: 'master', accountId: actor.id }, ip });
}

/** 宿（管理画面）がアカウントをすべての端末からログアウトさせる（停止はしない・§6.7）。access_logs に logout_all（channel='admin'） */
export async function revokeAllSessionsByStaff(
  db: SupabaseClient,
  partnerId: string,
  accountId: string,
  staffId: string | null
): Promise<{ count: number }> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) throw new PartnerStoreError('ログインアカウントが見つかりません。', 404, 'not_found');
  const { data: acc, error: ae } = await db.from('rms_partner_accounts').select('id').eq('id', accountId).eq('partner_id', partnerId).maybeSingle();
  if (ae) raise(ae, 'ログインアカウントを読み込めませんでした。');
  if (!acc) throw new PartnerStoreError('ログインアカウントが見つかりません。', 404, 'not_found');
  const { data, error } = await db.from('rms_partner_sessions').delete().eq('account_id', accountId).select('id');
  if (error) raise(error, 'ログアウトできませんでした。');
  const count = (data ?? []).length;
  await logPartnerAccess(db, { partnerId, accountId, channel: 'admin', action: 'logout_all', detail: { count, by: `admin:${staffId ?? 'unknown'}` } });
  return { count };
}

/** アカウントごとのパスキーの数（管理画面・ユーザー管理の表示）。読めなければ空 */
export async function countPasskeysByAccount(db: SupabaseClient, accountIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!accountIds.length) return out;
  const { data, error } = await db.from('rms_partner_passkeys').select('account_id').in('account_id', [...accountIds]);
  if (error) return out;
  for (const r of (data ?? []) as { account_id: string }[]) out.set(r.account_id, (out.get(r.account_id) ?? 0) + 1);
  return out;
}
