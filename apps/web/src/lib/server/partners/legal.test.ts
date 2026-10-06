import { describe, expect, it } from 'vitest';
import { normalizePartnerBookingSettings } from '$lib/partner-booking';
import { partnerTokushoho } from './legal';

describe('partnerTokushoho', () => {
  const settings = normalizePartnerBookingSettings({
    paymentOptions: ['invoice_monthly', 'custom_1'],
    customPaymentOptions: [{ id: 'custom_1', label: '請求書で精算する', note: '月次の請求書でご請求', billable: true }],
    invoiceDue: { type: 'next_month_day', day: 25 },
    cancelDays: 1,
    cutoffHour: 18
  });
  const doc = partnerTokushoho({ name: '再春館製薬所', facility_name: '山人-oga-', booking_settings: settings });
  it('許可した支払方法・期限・取消期限を書き出す', () => {
    expect(doc.body).toContain('翌月25日までに指定の口座へお振り込み');
    expect(doc.body).toContain('請求書で精算する：月次の請求書でご請求');
    expect(doc.body).toContain('宿泊日の1日前の18時まで、この専用ページの「予約一覧」から');
    expect(doc.body).toContain('振込手数料');
  });
  it('使っていないオンライン決済の返金の説明は出さない', () => {
    expect(doc.body).not.toContain('クレジットカードへ返金');
  });
});
