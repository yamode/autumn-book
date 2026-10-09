// 管理画面の取引先設定フォームの読み取り（parsePartnerSettings）。
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTNER_PRICING } from '$lib/partner-pricing';
import { DEFAULT_PARTNER_BOOKING_SETTINGS } from '$lib/partner-booking';
import { parsePartnerCommonForm, parsePartnerFacilityForm, parsePartnerKind, parsePartnerSettings, PartnerFormError } from './staff-form';

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
    expect(r.booking_settings.customPaymentOptions).toEqual([{ id: 'custom_ab12cd34', label: '現地精算（法人カード）', note: 'フロントでお支払い', billable: false }]);
    expect(r.booking_settings.perks).toEqual([{ id: 'perk-1', title: 'ウェルカムドリンク', description: 'ラウンジで1杯', imageUrl: '', planCodes: ['a001'] }]);
  });

  it('最高料金を読み取り、最低料金 > 最高料金 は保存できない', () => {
    const ok = parsePartnerSettings(form({ ...base, pricing: JSON.stringify({ ...DEFAULT_PARTNER_PRICING, minPricePerPerson: 10000, maxPricePerPerson: 30000 }) }));
    expect(ok.pricing.maxPricePerPerson).toBe(30000);
    const bad = JSON.stringify({ ...DEFAULT_PARTNER_PRICING, minPricePerPerson: 30000, maxPricePerPerson: 10000 });
    expect(() => parsePartnerSettings(form({ ...base, pricing: bad }))).toThrow('最低料金が最高料金');
  });
});

describe('parsePartnerSettings（2026-10-02: ご請求書の宛名・お支払期限）', () => {
  it('booking JSON の invoiceRecipientName / invoiceDue がそのまま通る', () => {
    const booking = JSON.stringify({
      ...DEFAULT_PARTNER_BOOKING_SETTINGS,
      invoiceRecipientName: '  株式会社再春館製薬所 ',
      invoiceDue: { type: 'next_month_day', day: 25 }
    });
    const r = parsePartnerSettings(form({ ...base, booking }));
    expect(r.booking_settings.invoiceRecipientName).toBe('株式会社再春館製薬所');
    expect(r.booking_settings.invoiceDue).toEqual({ type: 'next_month_day', day: 25 });
  });

  it('未指定・範囲外の期限は翌月末、宛名は空', () => {
    const r = parsePartnerSettings(form({ ...base, booking: JSON.stringify({ ...DEFAULT_PARTNER_BOOKING_SETTINGS, invoiceDue: { type: 'next_month_day', day: 31 } }) }));
    expect(r.booking_settings.invoiceDue).toEqual({ type: 'next_month_end' });
    expect(r.booking_settings.invoiceRecipientName).toBe('');
  });
});

describe('parsePartnerCommonForm（2026-10-09: 共通セクション・複数施設化 S3）', () => {
  it('共通の列と予約設定を読む（施設の列は読まない）', () => {
    const booking = JSON.stringify({ ...DEFAULT_PARTNER_BOOKING_SETTINGS, leadDays: 0, cancelDays: null });
    const r = parsePartnerCommonForm(form({ name: ' ○○トラベル ', kind: 'corporate', is_active: 'on', booking, max_days_ahead: '999' }));
    expect(r.name).toBe('○○トラベル');
    expect(r.is_active).toBe(true);
    expect(r.booking_settings.leadDays).toBe(0);
    expect(r.booking_settings.cancelDays).toBeNull();
    expect('max_days_ahead' in r).toBe(false);
  });

  it('支払方法が空でも共通の保存はできる（予約受付の施設があるかは呼び出し側で確かめる）。入力ミスは 400', () => {
    const booking = JSON.stringify({ ...DEFAULT_PARTNER_BOOKING_SETTINGS, paymentOptions: [] });
    expect(parsePartnerCommonForm(form({ name: 'x', booking })).booking_settings.paymentOptions).toEqual([]);
    expect(() => parsePartnerCommonForm(form({ name: ' ' }))).toThrow(PartnerFormError);
    expect(() => parsePartnerCommonForm(form({ name: 'x', booking: '{' }))).toThrow('予約受付');
  });
});

describe('parsePartnerFacilityForm（2026-10-09: 施設タブ・複数施設化 S3）', () => {
  const facilityBase = {
    facility_id: 'f-oga',
    pricing: JSON.stringify(DEFAULT_PARTNER_PRICING),
    facility_booking: JSON.stringify({ notice: '男鹿の案内', notifyEmails: ['oga@example.com', 'bad'], planNames: { A1: '専用' }, leadDays: 9 })
  };

  it('施設の列・施設ごとのキーを読む（共通のキーは混ぜない）', () => {
    const r = parsePartnerFacilityForm(form({ ...facilityBase, enabled: 'on', booking_enabled: 'on', show_inventory: 'on', max_days_ahead: '90', sort_order: '2' }));
    expect(r.facilityRef).toBe('f-oga');
    expect(r.patch).toMatchObject({ enabled: true, booking_enabled: true, show_inventory: true, include_advance: false, max_days_ahead: 90, sort_order: 2 });
    expect(r.own).toEqual({ planNames: { A1: '専用' }, perks: [], notice: '男鹿の案内', notifyEmails: ['oga@example.com'], showOfficialPerks: false });
    expect('leadDays' in r.own).toBe(false);
    expect(r.overrides).toEqual({});
  });

  it('上書きはキーの有無で読む（0・null も上書き）', () => {
    const r = parsePartnerFacilityForm(form({ ...facilityBase, overrides: JSON.stringify({ leadDays: 0, cancelDays: null, prepayDiscount: { type: 'percent', value: 5 } }) }));
    expect(r.overrides).toEqual({ leadDays: 0, cancelDays: null, prepayDiscount: { type: 'percent', value: 5 } });
  });

  it('施設の指定なし・並び順の範囲外・壊れた JSON は 400', () => {
    expect(() => parsePartnerFacilityForm(form({ ...facilityBase, facility_id: '' }))).toThrow('施設');
    expect(() => parsePartnerFacilityForm(form({ ...facilityBase, sort_order: '5000' }))).toThrow('並び順');
    expect(() => parsePartnerFacilityForm(form({ ...facilityBase, overrides: '{' }))).toThrow('早期決済割');
    expect(() => parsePartnerFacilityForm(form({ ...facilityBase, max_days_ahead: '0' }))).toThrow('1〜730');
  });
});
