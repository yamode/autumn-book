// 管理画面の取引先設定フォームの読み取り（parsePartnerSettings）。
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTNER_PRICING } from '$lib/partner-pricing';
import { DEFAULT_PARTNER_BOOKING_SETTINGS } from '$lib/partner-booking';
import { parsePartnerKind, parsePartnerSettings, PartnerFormError } from './staff-form';

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const base = {
  name: '○○トラベル',
  kind: 'corporate',
  pricing: JSON.stringify(DEFAULT_PARTNER_PRICING),
  booking: JSON.stringify(DEFAULT_PARTNER_BOOKING_SETTINGS)
};

describe('parsePartnerSettings', () => {
  it('チェックボックス・日付・日数を読み取る', () => {
    const r = parsePartnerSettings(
      form({ ...base, is_active: 'on', show_inventory: 'on', valid_from: '2026-10-01', valid_until: '2026-12-31', max_days_ahead: '90', note: ' メモ ' })
    );
    expect(r.name).toBe('○○トラベル');
    expect(r.kind).toBe('corporate');
    expect(r.is_active).toBe(true);
    expect(r.show_inventory).toBe(true);
    expect(r.include_advance).toBe(false);
    expect(r.booking_enabled).toBe(false);
    expect(r.valid_from).toBe('2026-10-01');
    expect(r.max_days_ahead).toBe(90);
    expect(r.note).toBe('メモ');
    expect(r.contact_email).toBeNull();
  });

  it('日数の既定は 365、日付の形式違いは null', () => {
    const r = parsePartnerSettings(form({ ...base, valid_from: '2026/10/01' }));
    expect(r.max_days_ahead).toBe(365);
    expect(r.valid_from).toBeNull();
  });

  it('入力ミスは PartnerFormError（400）', () => {
    expect(() => parsePartnerSettings(form({ ...base, name: ' ' }))).toThrow(PartnerFormError);
    expect(() => parsePartnerSettings(form({ ...base, contact_email: 'abc' }))).toThrow('連絡先メール');
    expect(() => parsePartnerSettings(form({ ...base, valid_from: '2026-12-01', valid_until: '2026-11-01' }))).toThrow('開始日');
    expect(() => parsePartnerSettings(form({ ...base, max_days_ahead: '999' }))).toThrow('1〜730');
    expect(() => parsePartnerSettings(form({ ...base, pricing: '{' }))).toThrow('特別レート');
    expect(() => parsePartnerSettings(form({ ...base, booking: '{' }))).toThrow('予約受付');
  });

  it('予約受付オンで支払方法なしは保存できない', () => {
    const booking = JSON.stringify({ ...DEFAULT_PARTNER_BOOKING_SETTINGS, paymentOptions: [] });
    expect(() => parsePartnerSettings(form({ ...base, booking, booking_enabled: 'on' }))).toThrow(PartnerFormError);
  });
});

describe('parsePartnerKind', () => {
  it('不明な値は agent', () => {
    expect(parsePartnerKind('other')).toBe('other');
    expect(parsePartnerKind('x')).toBe('agent');
    expect(parsePartnerKind(null)).toBe('agent');
  });
});

describe('parsePartnerSettings（2026-10-01: 自由入力の支払方法・取引先特典・最高料金）', () => {
  it('booking JSON の customPaymentOptions / perks がそのまま通る', () => {
    const booking = JSON.stringify({
      ...DEFAULT_PARTNER_BOOKING_SETTINGS,
      paymentOptions: ['custom_ab12cd34'],
      customPaymentOptions: [{ id: 'custom_ab12cd34', label: '現地精算（法人カード）', note: 'フロントでお支払い' }],
      perks: [{ id: 'perk-1', title: 'ウェルカムドリンク', description: 'ラウンジで1杯', planCodes: ['a001'] }]
    });
    const r = parsePartnerSettings(form({ ...base, booking, booking_enabled: 'on' }));
    expect(r.booking_settings.paymentOptions).toEqual(['custom_ab12cd34']);
    expect(r.booking_settings.customPaymentOptions).toEqual([{ id: 'custom_ab12cd34', label: '現地精算（法人カード）', note: 'フロントでお支払い' }]);
    expect(r.booking_settings.perks).toEqual([{ id: 'perk-1', title: 'ウェルカムドリンク', description: 'ラウンジで1杯', planCodes: ['a001'] }]);
  });

  it('最高料金を読み取り、最低料金 > 最高料金 は保存できない', () => {
    const ok = parsePartnerSettings(form({ ...base, pricing: JSON.stringify({ ...DEFAULT_PARTNER_PRICING, minPricePerPerson: 10000, maxPricePerPerson: 30000 }) }));
    expect(ok.pricing.maxPricePerPerson).toBe(30000);
    const bad = JSON.stringify({ ...DEFAULT_PARTNER_PRICING, minPricePerPerson: 30000, maxPricePerPerson: 10000 });
    expect(() => parsePartnerSettings(form({ ...base, pricing: bad }))).toThrow('最低料金が最高料金');
  });
});
