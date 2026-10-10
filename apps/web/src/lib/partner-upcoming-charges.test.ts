import { describe, expect, it } from 'vitest';
import {
  chargePlanMetadata,
  inChargeRange,
  jstDateTime,
  monthBounds,
  parseChargeRange,
  setupIntentEventMetadata,
  upcomingAmountOf,
  upcomingChargesCsv,
  upcomingKindOf,
  type UpcomingSource
} from './partner-upcoming-charges';

const base: UpcomingSource = {
  status: 'confirmed',
  payment_option: 'online_checkin',
  payment_status: 'scheduled',
  check_out_date: '2026-11-03',
  total_amount: 30000,
  bath_tax_amount: 300,
  prepay_discount_amount: 0
};

describe('upcomingKindOf', () => {
  it('チェックアウト日決済の確定予約は請求予定・請求失敗', () => {
    expect(upcomingKindOf(base)).toBe('scheduled');
    expect(upcomingKindOf({ ...base, payment_status: 'charge_failed' })).toBe('charge_failed');
    expect(upcomingKindOf({ ...base, payment_status: 'paid' })).toBeNull();
  });
  it('チェックアウト日決済でない予約・支払待ちは出さない', () => {
    expect(upcomingKindOf({ ...base, payment_option: 'online' })).toBeNull();
    expect(upcomingKindOf({ ...base, payment_option: 'invoice_monthly' })).toBeNull();
    expect(upcomingKindOf({ ...base, status: 'pending_payment' })).toBeNull();
    expect(upcomingKindOf({ ...base, status: 'expired' })).toBeNull();
  });
  it('取消は payment_status が scheduled のままでも取消（請求なし）', () => {
    expect(upcomingKindOf({ ...base, status: 'cancelled', cancel_fee_settlement: 'none' })).toBe('cancelled');
  });
  it('キャンセル料をカードへ請求する予定のまま残った取消は cancel_fee', () => {
    const c = { ...base, status: 'cancelled', cancel_fee: 9000, cancel_fee_settlement: 'card' };
    expect(upcomingKindOf({ ...c, cancel_fee_status: null })).toBe('cancel_fee');
    expect(upcomingKindOf({ ...c, cancel_fee_status: 'charged' })).toBe('cancelled');
    expect(upcomingKindOf({ ...c, cancel_fee: 0 })).toBe('cancelled');
  });
});

describe('upcomingAmountOf', () => {
  it('請求額は宿泊料金＋入湯税−割引・キャンセル料・取消は 0', () => {
    expect(upcomingAmountOf({ ...base, prepay_discount_amount: 1000 }, 'scheduled')).toBe(29300);
    expect(upcomingAmountOf(base, 'charge_failed')).toBe(30300);
    expect(upcomingAmountOf({ ...base, cancel_fee: 9000 }, 'cancel_fee')).toBe(9000);
    expect(upcomingAmountOf(base, 'cancelled')).toBe(0);
  });
});

describe('期間', () => {
  it('月の初日・末日（年またぎ・うるう年）', () => {
    expect(monthBounds('2026-10-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthBounds('2026-12-15', 1)).toEqual({ from: '2027-01-01', to: '2027-01-31' });
    expect(monthBounds('2028-01-31', 1)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
  });
  it('今月・来月・指定・すべて', () => {
    const today = '2026-10-10';
    expect(parseChargeRange({ range: 'this_month' }, today)).toEqual({ preset: 'this_month', from: '2026-10-01', to: '2026-10-31' });
    expect(parseChargeRange({ range: 'next_month' }, today)).toEqual({ preset: 'next_month', from: '2026-11-01', to: '2026-11-30' });
    expect(parseChargeRange({}, today)).toEqual({ preset: 'all', from: null, to: null });
    expect(parseChargeRange({ range: 'custom', from: '2026-12-01', to: '2026-11-01' }, today)).toEqual({ preset: 'custom', from: '2026-11-01', to: '2026-12-01' });
    expect(parseChargeRange({ range: 'custom', from: '2026-11-01', to: 'x' }, today)).toEqual({ preset: 'custom', from: '2026-11-01', to: null });
    expect(parseChargeRange({ range: 'custom', from: '2026-02-30' }, today).preset).toBe('all');
  });
  it('両端を含む', () => {
    const r = { preset: 'custom' as const, from: '2026-11-01', to: '2026-11-30' };
    expect(inChargeRange('2026-11-01', r)).toBe(true);
    expect(inChargeRange('2026-11-30', r)).toBe(true);
    expect(inChargeRange('2026-12-01', r)).toBe(false);
    expect(inChargeRange('1999-01-01', { preset: 'all', from: null, to: null })).toBe(true);
  });
});

describe('CSV', () => {
  it('BOM・見出し・式の無効化・取消日時は JST', () => {
    const csv = upcomingChargesCsv([
      {
        kind: 'cancelled',
        chargeOn: '2026-10-10',
        bookingCode: 'PB-2026-000001',
        partnerName: '=株式会社テスト',
        checkIn: '2026-11-01',
        checkOut: '2026-11-03',
        nights: 2,
        guestName: '山田, 太郎',
        amount: 0,
        cardLabel: null,
        cancelledAt: '2026-10-09T16:30:00Z',
        error: null
      }
    ]);
    expect(csv.startsWith('﻿区分,請求予定日')).toBe(true);
    expect(csv).toContain("'=株式会社テスト");
    expect(csv).toContain('"山田, 太郎"');
    expect(csv).toContain('2026-10-10 01:30');
    expect(jstDateTime(null)).toBe('');
  });
});

describe('SetupIntent の metadata', () => {
  it('請求予定日・請求額', () => {
    expect(chargePlanMetadata({ ...base, prepay_discount_amount: 500 })).toEqual({ charge_on: '2026-11-03', charge_amount: '29800' });
  });
  it('作成・カード登録', () => {
    expect(setupIntentEventMetadata({ type: 'created', status: 'pending_payment' })).toEqual({ booking_status: 'pending_payment' });
    expect(setupIntentEventMetadata({ type: 'card_saved', status: 'confirmed', cardLabel: 'VISA •••• 4242' })).toEqual({
      booking_status: 'confirmed',
      charge_error: '',
      card: 'VISA •••• 4242'
    });
  });
  it('取消（キャンセル料あり・なし）', () => {
    expect(setupIntentEventMetadata({ type: 'cancelled', cancelledAt: '2026-10-10T01:00:00Z' })).toEqual({ booking_status: 'cancelled', cancelled_at: '2026-10-10T01:00:00Z' });
    expect(
      setupIntentEventMetadata({ type: 'cancelled', cancelledAt: '2026-10-10T01:00:00Z', cancelFee: 9000, cancelFeeSettlement: 'card', cancelFeeStatus: 'charged' })
    ).toEqual({ booking_status: 'cancelled', cancelled_at: '2026-10-10T01:00:00Z', cancel_fee: '9000', cancel_fee_settlement: 'card', cancel_fee_status: 'charged' });
  });
  it('請求成功・失敗（値は 500 文字まで）', () => {
    expect(setupIntentEventMetadata({ type: 'charged', chargedAt: '2026-11-03T00:05:00Z', paymentIntent: 'pi_1' })).toEqual({
      booking_status: 'charged',
      charged_at: '2026-11-03T00:05:00Z',
      payment_intent: 'pi_1',
      charge_error: ''
    });
    const m = setupIntentEventMetadata({ type: 'charge_failed', failedAt: 't', error: 'x'.repeat(800), paymentIntent: null });
    expect(m.booking_status).toBe('charge_failed');
    expect(m.charge_error.length).toBe(500);
    expect('payment_intent' in m).toBe(false);
  });
  it('キーは 40 文字以内', () => {
    const all = [
      chargePlanMetadata(base),
      setupIntentEventMetadata({ type: 'card_saved', status: 'confirmed', cardLabel: 'x' }),
      setupIntentEventMetadata({ type: 'cancelled', cancelledAt: 't', cancelFee: 1, cancelFeeSettlement: 'card', cancelFeeStatus: 'charged' }),
      setupIntentEventMetadata({ type: 'charge_failed', failedAt: 't', error: 'e', paymentIntent: 'pi' }),
      setupIntentEventMetadata({ type: 'charged_after_cancel', chargedAt: 't', paymentIntent: 'pi' })
    ];
    for (const m of all) for (const k of Object.keys(m)) expect(k.length).toBeLessThanOrEqual(40);
  });
});
