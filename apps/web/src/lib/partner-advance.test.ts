// 銀行振込の前受金（状態・入金確認・返金）の純関数のテスト。
import { describe, expect, it } from 'vitest';
import {
  advanceBadgeOf,
  advancePaidLabel,
  advancePaidRpcMessage,
  advanceRefundNotice,
  isAdvanceBooking,
  isAdvanceOverdue,
  isAdvancePaid,
  isAdvanceUnpaidAtCheckout,
  isAdvanceWaiting,
  jstDateOf,
  parseAdvancePaidInput,
  parseAdvanceRefundInput,
  type AdvanceSource
} from './partner-advance';

const b = (over: Partial<AdvanceSource & { check_out_date: string }> = {}): AdvanceSource & { check_out_date: string } => ({
  status: 'confirmed',
  payment_option: 'advance_bank',
  payment_status: 'unpaid',
  advance_amount: 101_500,
  advance_due_date: '2026-11-13',
  paid_amount: null,
  paid_at: null,
  refund_amount: null,
  check_out_date: '2026-11-21',
  ...over
});

describe('前受金の状態', () => {
  it('前受金の予約か（支払方法と額）', () => {
    expect(isAdvanceBooking(b())).toBe(true);
    expect(isAdvanceBooking(b({ payment_option: 'deposit_bank' }))).toBe(true);
    expect(isAdvanceBooking(b({ payment_option: 'deposit_online' }))).toBe(false);
    expect(isAdvanceBooking(b({ advance_amount: null }))).toBe(false);
  });
  it('入金待ち・期限超過（期限の翌日から。当日は超過でない）', () => {
    expect(isAdvanceWaiting(b())).toBe(true);
    expect(isAdvanceOverdue(b(), '2026-11-13')).toBe(false);
    expect(isAdvanceOverdue(b(), '2026-11-14')).toBe(true);
    // 入金済み・取消済みは超過にしない
    expect(isAdvanceOverdue(b({ payment_status: 'paid' }), '2026-11-14')).toBe(false);
    expect(isAdvanceOverdue(b({ status: 'cancelled' }), '2026-11-14')).toBe(false);
    // オンライン決済の支払待ち（unpaid）は前受金ではない
    expect(isAdvanceOverdue(b({ payment_option: 'online', status: 'pending_payment' }), '2026-11-14')).toBe(false);
  });
  it('入金済み（取消後に返金した予約も入金はあった）', () => {
    expect(isAdvancePaid(b({ payment_status: 'paid' }))).toBe(true);
    expect(isAdvancePaid(b({ payment_status: 'refunded' }))).toBe(true);
    expect(isAdvancePaid(b())).toBe(false);
  });
  it('一覧の印', () => {
    expect(advanceBadgeOf(b(), '2026-11-01')).toEqual({ tone: 'waiting', label: '前受金 入金待ち（期限 11/13）' });
    expect(advanceBadgeOf(b(), '2026-11-14')).toEqual({ tone: 'overdue', label: '前受金 期限超過（期限 11/13）' });
    expect(advanceBadgeOf(b({ payment_status: 'paid', paid_amount: 101_500, paid_at: '2026-11-09T03:00:00Z' }), '2026-11-14')).toEqual({
      tone: 'paid',
      label: '前受金 入金済み（11/9・101,500円）'
    });
    expect(advanceBadgeOf(b({ status: 'cancelled', payment_status: 'paid', paid_amount: 101_500 }), '2026-11-14', 71_500)).toEqual({
      tone: 'refund_due',
      label: '前受金 返金待ち（71,500円）'
    });
    expect(advanceBadgeOf(b({ status: 'cancelled' }), '2026-11-14')).toBeNull();
    expect(advanceBadgeOf(b({ payment_option: 'invoice_monthly' }), '2026-11-14')).toBeNull();
  });
  it('入金日は JST の日付（UTC の前日夜でも JST の当日）', () => {
    expect(jstDateOf('2026-11-08T15:30:00Z')).toBe('2026-11-09');
    expect(advancePaidLabel({ paid_at: '2026-11-08T15:30:00Z', paid_amount: 30_000, advance_amount: 30_450 })).toBe('前受金 入金済み（11/9・30,000円）');
  });
  it('入金待ちのままチェックアウトした取引先払いの前受金（前受金のご請求書を取り消す案内）', () => {
    expect(isAdvanceUnpaidAtCheckout(b(), '2026-11-21', true)).toBe(true);
    expect(isAdvanceUnpaidAtCheckout(b(), '2026-11-20', true)).toBe(false);
    expect(isAdvanceUnpaidAtCheckout(b(), '2026-11-21', false)).toBe(false);
    expect(isAdvanceUnpaidAtCheckout(b({ payment_status: 'paid' }), '2026-11-22', true)).toBe(false);
  });
});

describe('入金確認の入力', () => {
  const ctx = { advanceAmount: 30_450, maxAmount: 101_500, today: '2026-11-10' };
  it('空なら前受金の額・今日', () => {
    expect(parseAdvancePaidInput({ amount: '', paidOn: '' }, ctx)).toEqual({ ok: true, amount: 30_450, paidOn: '2026-11-10' });
    expect(parseAdvancePaidInput({ amount: '30,000', paidOn: '2026-11-09' }, ctx)).toEqual({ ok: true, amount: 30_000, paidOn: '2026-11-09' });
  });
  it('金額は 1円〜ご利用額の整数', () => {
    expect(parseAdvancePaidInput({ amount: '0', paidOn: '' }, ctx).ok).toBe(false);
    expect(parseAdvancePaidInput({ amount: '101501', paidOn: '' }, ctx).ok).toBe(false);
    expect(parseAdvancePaidInput({ amount: '100.5', paidOn: '' }, ctx).ok).toBe(false);
    expect(parseAdvancePaidInput({ amount: '101500', paidOn: '' }, ctx).ok).toBe(true);
  });
  it('入金日は実在する日付で今日まで（未来日は不可）', () => {
    expect(parseAdvancePaidInput({ amount: '', paidOn: '2026-11-11' }, ctx)).toEqual({ ok: false, message: '入金日に未来の日付は指定できません。' });
    expect(parseAdvancePaidInput({ amount: '', paidOn: '2026-02-30' }, ctx).ok).toBe(false);
    expect(parseAdvancePaidInput({ amount: '', paidOn: '11/09' }, ctx).ok).toBe(false);
  });
  it('RPC の結果・例外の案内', () => {
    expect(advancePaidRpcMessage('paid')).toEqual({ ok: true, message: '' });
    expect(advancePaidRpcMessage('already').message).toContain('すでに入金済み');
    expect(advancePaidRpcMessage('not_confirmed').message).toContain('確定済みの予約ではない');
    expect(advancePaidRpcMessage(null, 'not_advance_booking').message).toContain('前受金の予約ではない');
    expect(advancePaidRpcMessage(null, 'invalid_amount').message).toContain('入金額が正しくありません');
    expect(advancePaidRpcMessage(null, 'invalid_paid_on').message).toContain('未来の日付');
    expect(advancePaidRpcMessage(null, 'partner_booking_not_found').message).toContain('見つかりません');
    expect(advancePaidRpcMessage(null, 'boom').ok).toBe(false);
  });
});

describe('返金の記録と案内', () => {
  const ctx = { refundDue: 71_500, paid: 101_500, today: '2026-11-10' };
  it('空なら返金すべき額・今日。0円〜入金額', () => {
    expect(parseAdvanceRefundInput({ amount: '', refundedOn: '' }, ctx)).toEqual({ ok: true, amount: 71_500, refundedOn: '2026-11-10' });
    expect(parseAdvanceRefundInput({ amount: '0', refundedOn: '2026-11-09' }, ctx)).toEqual({ ok: true, amount: 0, refundedOn: '2026-11-09' });
    expect(parseAdvanceRefundInput({ amount: '101501', refundedOn: '' }, ctx).ok).toBe(false);
    expect(parseAdvanceRefundInput({ amount: '', refundedOn: '2026-11-11' }, ctx).ok).toBe(false);
  });
  it('予約詳細の案内', () => {
    expect(advanceRefundNotice(101_500, 30_000, 71_500)).toBe('前受金 101,500円 入金済み。キャンセル料 30,000円 を差し引き、71,500円 を銀行振込でお返しください。');
    expect(advanceRefundNotice(101_500, 0, 101_500)).toBe('前受金 101,500円 入金済み。全額 101,500円 を銀行振込でお返しください。');
    expect(advanceRefundNotice(30_450, 30_450, 0)).toContain('返金はありません');
  });
});
