import { describe, it, expect } from 'vitest';
import {
  canBookFor,
  chargeAmountOf,
  quoteChargeOf,
  applyPrepayDiscount,
  canPartnerCancel,
  DEFAULT_PARTNER_BOOKING_SETTINGS,
  describePrepayDiscount,
  normalizePrepayDiscount,
  normalizePartnerBookingSettings,
  resolveOptionAnswers,
  validatePartnerBookingSettings
} from './partner-booking';

describe('normalizePartnerBookingSettings', () => {
  it('欠けは既定値で補い、範囲外は丸める', () => {
    const s = normalizePartnerBookingSettings({ leadDays: -3, cutoffHour: 30, maxRooms: 99, notifyEmails: ['a@example.com', 'bad', 'a@example.com'] });
    expect(s).toMatchObject({ leadDays: 0, cutoffHour: 23, maxRooms: 20, maxNights: 7, cancelDays: 1, notifyEmails: ['a@example.com'], notifyPartner: true });
    expect(normalizePartnerBookingSettings(null)).toEqual(DEFAULT_PARTNER_BOOKING_SETTINGS);
  });

  it('支払方法は既知のものだけを定義順で残し、受付オンなら1つ以上必須', () => {
    expect(normalizePartnerBookingSettings({ paymentOptions: ['online', 'bogus', 'invoice_monthly'] }).paymentOptions).toEqual(['invoice_monthly', 'online']);
    expect(normalizePartnerBookingSettings({}).paymentOptions).toEqual(['invoice_monthly']);
    const none = normalizePartnerBookingSettings({ paymentOptions: [] });
    expect(validatePartnerBookingSettings(none, true)).toMatch(/支払方法/);
    expect(validatePartnerBookingSettings(none, false)).toBeNull();
  });

  it('取消期限の null（画面から取り消せない）を保つ', () => {
    expect(normalizePartnerBookingSettings({ cancelDays: null }).cancelDays).toBeNull();
  });

  it('オプションは名前の無いものを捨て、選択肢は select のときだけ持つ', () => {
    const s = normalizePartnerBookingSettings({
      options: [
        { id: 'a', label: '送迎', type: 'check', choices: ['x'] },
        { id: 'b', label: '', type: 'text' },
        { id: 'c', label: '夕食時間', type: 'select', choices: ['18:00', '18:00', '19:00'], required: true }
      ]
    });
    expect(s.options).toEqual([
      { id: 'a', label: '送迎', type: 'check', choices: [], required: false },
      { id: 'c', label: '夕食時間', type: 'select', choices: ['18:00', '19:00'], required: true }
    ]);
    expect(validatePartnerBookingSettings(normalizePartnerBookingSettings({ options: [{ label: 'X', type: 'select', choices: ['1'] }] }))).toMatch(/選択肢/);
  });
});

describe('期限', () => {
  const s = { leadDays: 1, cutoffHour: 18, cancelDays: 2 };
  it('前日18時（JST）までは予約できる', () => {
    expect(canBookFor('2026-10-10', s, new Date('2026-10-09T08:59:00Z'))).toBe(true); // 9日 17:59 JST
    expect(canBookFor('2026-10-10', s, new Date('2026-10-09T09:00:00Z'))).toBe(false); // 9日 18:00 JST
  });
  it('取消は2日前18時まで。null なら不可', () => {
    expect(canPartnerCancel('2026-10-10', s, new Date('2026-10-08T08:00:00Z'))).toBe(true);
    expect(canPartnerCancel('2026-10-10', s, new Date('2026-10-08T09:30:00Z'))).toBe(false);
    expect(canPartnerCancel('2026-10-10', { ...s, cancelDays: null }, new Date('2026-09-01T00:00:00Z'))).toBe(false);
  });
});

describe('resolveOptionAnswers', () => {
  const options = [
    { id: 'pick', label: '送迎希望', type: 'check' as const, choices: [], required: false },
    { id: 'time', label: '夕食時間', type: 'select' as const, choices: ['18:00', '19:00'], required: true },
    { id: 'memo', label: '記念日', type: 'text' as const, choices: [], required: false }
  ];
  it('回答を label/value にし、必須・選択肢を検証する', () => {
    expect(resolveOptionAnswers(options, { pick: 'on', time: '19:00', memo: '' })).toEqual({
      ok: true,
      values: [
        { label: '送迎希望', value: 'あり' },
        { label: '夕食時間', value: '19:00' }
      ]
    });
    expect(resolveOptionAnswers(options, {})).toMatchObject({ ok: false });
    expect(resolveOptionAnswers(options, { time: '20:00' })).toMatchObject({ ok: false });
  });
});

describe('予約時決済の割引', () => {
  it('設定は none / percent（1〜50%）/ yen（1〜100,000円）に丸める', () => {
    expect(normalizePrepayDiscount(undefined)).toEqual({ type: 'none', value: 0 });
    expect(normalizePrepayDiscount({ type: 'percent', value: 80 })).toEqual({ type: 'percent', value: 50 });
    expect(normalizePrepayDiscount({ type: 'yen', value: '1000' })).toEqual({ type: 'yen', value: 1000 });
    expect(normalizePrepayDiscount({ type: 'percent', value: 0 })).toEqual({ type: 'none', value: 0 });
    expect(normalizePartnerBookingSettings({}).prepayDiscount).toEqual({ type: 'none', value: 0 });
  });

  it('1名1泊の単価に当てる（％は1円未満四捨五入・1円未満にはしない）', () => {
    expect(applyPrepayDiscount(29350, { type: 'percent', value: 5 })).toBe(27883);
    expect(applyPrepayDiscount(29350, { type: 'yen', value: 1000 })).toBe(28350);
    expect(applyPrepayDiscount(500, { type: 'yen', value: 1000 })).toBe(1);
    expect(applyPrepayDiscount(29350, { type: 'none', value: 0 })).toBe(29350);
    expect(describePrepayDiscount({ type: 'yen', value: 1000 })).toBe('1名1泊 1,000円引き');
    expect(describePrepayDiscount({ type: 'percent', value: 5 })).toBe('5%引き');
  });

  it('チェックイン日決済も支払方法として残す', () => {
    expect(normalizePartnerBookingSettings({ paymentOptions: ['online_checkin', 'online'] }).paymentOptions).toEqual(['online', 'online_checkin']);
  });
});

describe('オンライン決済の金額', () => {
  const q = { total: 30000, bathTax: 600, prepay: { total: 28500 } };
  it('予約時決済は割引後の宿泊料金＋入湯税', () => {
    expect(quoteChargeOf(q, 'online')).toEqual({ lodging: 28500, bathTax: 600, charge: 29100, discounted: true });
  });
  it('チェックイン日決済・後払いは割引しない', () => {
    expect(quoteChargeOf(q, 'online_checkin')).toEqual({ lodging: 30000, bathTax: 600, charge: 30600, discounted: false });
    expect(quoteChargeOf({ ...q, prepay: null }, 'online').charge).toBe(30600);
  });
  it('台帳の請求額（Intent の金額）は宿泊料金＋入湯税', () => {
    expect(chargeAmountOf({ total_amount: 28500, bath_tax_amount: 600 })).toBe(29100);
    expect(chargeAmountOf({ total_amount: 28500, bath_tax_amount: null })).toBe(28500);
  });
});
