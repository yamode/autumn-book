import { describe, expect, it } from 'vitest';
import { normalizePartnerBookingSettings } from '$lib/partner-booking';
import { partnerTokushoho, tokushohoCompanySection } from './legal';

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

// 特商法の宿泊施設の欄は選んでいる施設（複数施設化 §7.2・2026-10-09）
describe('tokushohoCompanySection', () => {
  it('選んでいる施設を「宿泊施設」に書き、連絡先の一覧でも先頭にする', () => {
    const oga = tokushohoCompanySection('oga');
    expect(oga).toContain('## 宿泊施設\n\n山人-oga-');
    expect(oga.indexOf('- 山人-oga-（')).toBeLessThan(oga.indexOf('- 山人-yamado-（'));
    expect(oga).toContain('株式会社山人');
  });
  it('知らない施設なら施設の欄は出さず一覧だけ（従来どおり）', () => {
    const doc = tokushohoCompanySection(null);
    expect(doc).not.toContain('## 宿泊施設');
    expect(doc.indexOf('- 山人-yamado-（')).toBeLessThan(doc.indexOf('- 山人-oga-（'));
  });
  it('partnerTokushoho は facility_slug の施設で書く', () => {
    const settings = normalizePartnerBookingSettings({ paymentOptions: ['invoice_monthly'] });
    const doc = partnerTokushoho({ name: '取引先', facility_name: '山人-yamado-', facility_slug: 'yamado', booking_settings: settings });
    expect(doc.body).toContain('## 宿泊施設\n\n山人-yamado-');
  });
});
