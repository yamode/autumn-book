// 管理画面（/admin/partners/[id]）の「公開設定・特別レート・予約受付」フォームの読み取り（純関数）。
// autumn-rms の staff.ts（parsePartnerSettings）から移設（2026-09-26）。DB・環境変数に触らないのでテストから直接呼べる。
import { normalizePartnerPricing, validatePartnerPricing, type PartnerPricing } from '$lib/partner-pricing';
import {
  normalizePartnerBookingSettings,
  PARTNER_FACILITY_SETTING_KEYS,
  readPartnerFacilityOverrides,
  validatePartnerBookingSettings,
  type PartnerBookingSettings,
  type PartnerFacilityOverrides,
  type PartnerFacilityOwnSettings
} from '$lib/partner-booking';
import type { PartnerFacilityPatch, PartnerKind, PartnerSettingsInput } from './store';

/** 入力の誤り（画面に 400 で返す）。 */
export class PartnerFormError extends Error {
  status = 400;
}

const str = (fd: FormData, key: string) => String(fd.get(key) ?? '').trim();
const optStr = (fd: FormData, key: string, max = 200) => str(fd, key).slice(0, max) || null;
const optDate = (fd: FormData, key: string) => {
  const v = str(fd, key);
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
};
const bool = (fd: FormData, key: string) => ['on', 'true', '1'].includes(str(fd, key));

export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

export function parsePartnerKind(v: unknown): PartnerKind {
  const s = String(v ?? '');
  return s === 'corporate' || s === 'other' ? s : 'agent';
}

// 共通・施設のフォームで共通の読み取り
function parseCommonFields(fd: FormData) {
  const name = str(fd, 'name').slice(0, 120);
  if (!name) throw new PartnerFormError('取引先名を入力してください。');
  const contactEmail = optStr(fd, 'contact_email');
  if (contactEmail && !isEmail(contactEmail)) throw new PartnerFormError('連絡先メールの形式が正しくありません。');
  const validFrom = optDate(fd, 'valid_from');
  const validUntil = optDate(fd, 'valid_until');
  if (validFrom && validUntil && validFrom > validUntil) throw new PartnerFormError('公開期間の開始日が終了日より後です。');
  return {
    name,
    kind: parsePartnerKind(str(fd, 'kind')),
    contact_name: optStr(fd, 'contact_name', 120),
    contact_email: contactEmail,
    is_active: bool(fd, 'is_active'),
    valid_from: validFrom,
    valid_until: validUntil,
    note: optStr(fd, 'note', 2000)
  };
}

function parseMaxDays(fd: FormData): number {
  const maxDays = Math.round(Number(str(fd, 'max_days_ahead') || 365));
  if (!Number.isFinite(maxDays) || maxDays < 1 || maxDays > 730) throw new PartnerFormError('公開する日数は 1〜730 日で指定してください。');
  return maxDays;
}

function parseJsonField(fd: FormData, key: string, what: string): unknown {
  const text = str(fd, key);
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new PartnerFormError(`${what}を読み取れませんでした。画面を再読み込みしてください。`);
  }
}

function parsePricing(fd: FormData): PartnerPricing {
  const pricing: PartnerPricing = normalizePartnerPricing(parseJsonField(fd, 'pricing', '特別レートの設定'));
  const problem = validatePartnerPricing(pricing);
  if (problem) throw new PartnerFormError(problem);
  return pricing;
}

export function parsePartnerSettings(fd: FormData): PartnerSettingsInput {
  const common = parseCommonFields(fd);
  const maxDays = parseMaxDays(fd);
  const pricing = parsePricing(fd);

  // 予約受付の設定（受付ルール・追加オプション・通知先）と支払方法
  const bookingSettings = normalizePartnerBookingSettings(parseJsonField(fd, 'booking', '予約受付の設定'));
  const bookingEnabled = bool(fd, 'booking_enabled');
  const bookingProblem = validatePartnerBookingSettings(bookingSettings, bookingEnabled);
  if (bookingProblem) throw new PartnerFormError(bookingProblem);

  return {
    ...common,
    max_days_ahead: maxDays,
    show_inventory: bool(fd, 'show_inventory'),
    include_advance: bool(fd, 'include_advance'),
    pricing,
    booking_enabled: bookingEnabled,
    booking_settings: bookingSettings
  };
}

// ---- 共通セクションと施設タブ（複数施設化 S3・docs/partner-multi-facility.md §7.12・2026-10-09） ----

export type PartnerCommonFormInput = ReturnType<typeof parseCommonFields> & {
  /** 共通の予約設定（支払方法・請求条件・毎回聞く項目・通知・N6 の既定）。施設ごとのキーは保存時に使わない */
  booking_settings: PartnerBookingSettings;
};

/** 共通セクション（?/saveCommon）。支払方法が要るかどうか（予約受付がオンの施設があるか）は呼び出し側で確かめる */
export function parsePartnerCommonForm(fd: FormData): PartnerCommonFormInput {
  const common = parseCommonFields(fd);
  const bookingSettings = normalizePartnerBookingSettings(parseJsonField(fd, 'booking', '予約受付の設定'));
  const problem = validatePartnerBookingSettings(bookingSettings, false);
  if (problem) throw new PartnerFormError(problem);
  return { ...common, booking_settings: bookingSettings };
}

export type PartnerFacilityFormInput = {
  /** hidden の facility_id（Book の施設 ID か core.facilities の UUID。検査は呼び出し側の requireStaffFacility） */
  facilityRef: string;
  patch: Required<Pick<PartnerFacilityPatch, 'enabled' | 'booking_enabled' | 'max_days_ahead' | 'show_inventory' | 'include_advance' | 'pricing' | 'sort_order'>>;
  /** 施設ごとにだけ持つ値（プラン名・特典・案内文・通知先・公式特典） */
  own: PartnerFacilityOwnSettings;
  /** 施設で上書きする N6 の値（キーがあるものだけ。無いキーは「共通の既定を使う」） */
  overrides: PartnerFacilityOverrides;
};

/** 施設タブ（?/saveFacility）。facility_booking = 施設ごとの値、overrides = 上書きする N6 の値（キーの有無） */
export function parsePartnerFacilityForm(fd: FormData): PartnerFacilityFormInput {
  const facilityRef = str(fd, 'facility_id');
  if (!facilityRef) throw new PartnerFormError('施設を選び直してください（画面を再読み込みしてください）。');
  const sortOrder = Math.round(Number(str(fd, 'sort_order') || 0));
  if (!Number.isFinite(sortOrder) || sortOrder < -999 || sortOrder > 999) throw new PartnerFormError('並び順は -999〜999 の整数で指定してください。');
  const normalized = normalizePartnerBookingSettings(parseJsonField(fd, 'facility_booking', '施設の予約設定'));
  const own = Object.fromEntries(PARTNER_FACILITY_SETTING_KEYS.map((k) => [k, normalized[k]])) as PartnerFacilityOwnSettings;
  return {
    facilityRef,
    patch: {
      enabled: bool(fd, 'enabled'),
      booking_enabled: bool(fd, 'booking_enabled'),
      max_days_ahead: parseMaxDays(fd),
      show_inventory: bool(fd, 'show_inventory'),
      include_advance: bool(fd, 'include_advance'),
      pricing: parsePricing(fd),
      sort_order: sortOrder
    },
    own,
    overrides: readPartnerFacilityOverrides(parseJsonField(fd, 'overrides', '早期決済割・受付ルールの設定'))
  };
}
