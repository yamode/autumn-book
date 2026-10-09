// 管理画面の取引先設定フォームの読み取り（parsePartnerCommonForm・parsePartnerFacilityForm）。
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTNER_PRICING } from '$lib/partner-pricing';
import { DEFAULT_PARTNER_BOOKING_SETTINGS } from '$lib/partner-booking';
import { parsePartnerCommonForm, parsePartnerFacilityForm, parsePartnerKind, PartnerFormError } from './staff-form';

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const base = {
  name: '○○トラベル',
  kind: 'corporate',
  booking: JSON.stringify(DEFAULT_PARTNER_BOOKING_SETTINGS)
};

// 共通の項目の読み取り（旧 parsePartnerSettings のテストを parsePartnerCommonForm に移したもの。特別レートは RMS へ移したので読まない）
describe('parsePartnerCommonForm（共通の項目）', () => {
  it('チェックボックス・日付を読み取る', () => {
    const r = parsePartnerCommonForm(form({ ...base, is_active: 'on', valid_from: '2026-10-01', valid_until: '2026-12-31', note: ' メモ ' }));
    expect(r.name).toBe('○○トラベル');
    expect(r.kind).toBe('corporate');
    expect(r.is_active).toBe(true);
    expect(r.valid_from).toBe('2026-10-01');
    expect(r.note).toBe('メモ');
    expect(r.contact_email).toBeNull();
    expect(parsePartnerCommonForm(form({ ...base, valid_from: '2026/10/01' })).valid_from).toBeNull();
  });

  it('入力ミスは PartnerFormError（400）', () => {
    expect(() => parsePartnerCommonForm(form({ ...base, contact_email: 'abc' }))).toThrow('連絡先メール');
    expect(() => parsePartnerCommonForm(form({ ...base, valid_from: '2026-12-01', valid_until: '2026-11-01' }))).toThrow('開始日');
  });
});

describe('parsePartnerKind', () => {
  it('不明な値は agent', () => {
    expect(parsePartnerKind('other')).toBe('other');
    expect(parsePartnerKind('x')).toBe('agent');
    expect(parsePartnerKind(null)).toBe('agent');
  });
});

describe('parsePartnerCommonForm（2026-10-01〜02: 自由入力の支払方法・取引先特典・ご請求書）', () => {
  it('booking JSON の customPaymentOptions / perks がそのまま通る', () => {
    const booking = JSON.stringify({
      ...DEFAULT_PARTNER_BOOKING_SETTINGS,
      paymentOptions: ['custom_ab12cd34'],
      customPaymentOptions: [{ id: 'custom_ab12cd34', label: '現地精算（法人カード）', note: 'フロントでお支払い' }],
      perks: [{ id: 'perk-1', title: 'ウェルカムドリンク', description: 'ラウンジで1杯', planCodes: ['a001'] }]
    });
    const r = parsePartnerCommonForm(form({ ...base, booking }));
    expect(r.booking_settings.paymentOptions).toEqual(['custom_ab12cd34']);
    expect(r.booking_settings.customPaymentOptions).toEqual([{ id: 'custom_ab12cd34', label: '現地精算（法人カード）', note: 'フロントでお支払い', billable: false }]);
    expect(r.booking_settings.perks).toEqual([{ id: 'perk-1', title: 'ウェルカムドリンク', description: 'ラウンジで1杯', imageUrl: '', planCodes: ['a001'] }]);
  });

  it('booking JSON の invoiceRecipientName / invoiceDue がそのまま通る・範囲外の期限は翌月末', () => {
    const booking = JSON.stringify({
      ...DEFAULT_PARTNER_BOOKING_SETTINGS,
      invoiceRecipientName: '  株式会社再春館製薬所 ',
      invoiceDue: { type: 'next_month_day', day: 25 }
    });
    const r = parsePartnerCommonForm(form({ ...base, booking }));
    expect(r.booking_settings.invoiceRecipientName).toBe('株式会社再春館製薬所');
    expect(r.booking_settings.invoiceDue).toEqual({ type: 'next_month_day', day: 25 });
    const r2 = parsePartnerCommonForm(form({ ...base, booking: JSON.stringify({ ...DEFAULT_PARTNER_BOOKING_SETTINGS, invoiceDue: { type: 'next_month_day', day: 31 } }) }));
    expect(r2.booking_settings.invoiceDue).toEqual({ type: 'next_month_end' });
    expect(r2.booking_settings.invoiceRecipientName).toBe('');
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

  it('特別レート（pricing）は読まない（編集は RMS・2026-10-09 §7）', () => {
    const r = parsePartnerFacilityForm(form({ ...facilityBase, pricing: '{' }));
    expect('pricing' in r.patch).toBe(false);
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
