// 管理画面（/admin/partners/[id]）の「公開設定・特別レート・予約受付」フォームの読み取り（純関数）。
// autumn-rms の staff.ts（parsePartnerSettings）から移設（2026-09-26）。DB・環境変数に触らないのでテストから直接呼べる。
import { normalizePartnerPricing, validatePartnerPricing, type PartnerPricing } from '$lib/partner-pricing';
import { normalizePartnerBookingSettings, validatePartnerBookingSettings } from '$lib/partner-booking';
import type { PartnerKind, PartnerSettingsInput } from './store';

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

export function parsePartnerSettings(fd: FormData): PartnerSettingsInput {
  const name = str(fd, 'name').slice(0, 120);
  if (!name) throw new PartnerFormError('取引先名を入力してください。');
  const contactEmail = optStr(fd, 'contact_email');
  if (contactEmail && !isEmail(contactEmail)) throw new PartnerFormError('連絡先メールの形式が正しくありません。');
  const validFrom = optDate(fd, 'valid_from');
  const validUntil = optDate(fd, 'valid_until');
  if (validFrom && validUntil && validFrom > validUntil) throw new PartnerFormError('公開期間の開始日が終了日より後です。');
  const maxDays = Math.round(Number(str(fd, 'max_days_ahead') || 365));
  if (!Number.isFinite(maxDays) || maxDays < 1 || maxDays > 730) throw new PartnerFormError('公開する日数は 1〜730 日で指定してください。');

  let pricingRaw: unknown = {};
  const pricingText = str(fd, 'pricing');
  if (pricingText) {
    try {
      pricingRaw = JSON.parse(pricingText);
    } catch {
      throw new PartnerFormError('特別レートの設定を読み取れませんでした。画面を再読み込みしてください。');
    }
  }
  const pricing: PartnerPricing = normalizePartnerPricing(pricingRaw);
  const problem = validatePartnerPricing(pricing);
  if (problem) throw new PartnerFormError(problem);

  // 予約受付の設定（受付ルール・追加オプション・通知先）と支払方法
  let bookingRaw: unknown = {};
  const bookingText = str(fd, 'booking');
  if (bookingText) {
    try {
      bookingRaw = JSON.parse(bookingText);
    } catch {
      throw new PartnerFormError('予約受付の設定を読み取れませんでした。画面を再読み込みしてください。');
    }
  }
  const bookingSettings = normalizePartnerBookingSettings(bookingRaw);
  const bookingEnabled = bool(fd, 'booking_enabled');
  const bookingProblem = validatePartnerBookingSettings(bookingSettings, bookingEnabled);
  if (bookingProblem) throw new PartnerFormError(bookingProblem);

  return {
    name,
    kind: parsePartnerKind(str(fd, 'kind')),
    contact_name: optStr(fd, 'contact_name', 120),
    contact_email: contactEmail,
    is_active: bool(fd, 'is_active'),
    valid_from: validFrom,
    valid_until: validUntil,
    max_days_ahead: maxDays,
    show_inventory: bool(fd, 'show_inventory'),
    include_advance: bool(fd, 'include_advance'),
    pricing,
    note: optStr(fd, 'note', 2000),
    booking_enabled: bookingEnabled,
    booking_settings: bookingSettings
  };
}
