// 前受金のご請求書（銀行振込の事前支払）の純関数のテスト。
import { describe, expect, it } from 'vitest';
import {
  ADVANCE_INVOICE_TEXT,
  advanceAmountRows,
  advanceBookingMailLine,
  advanceInvoiceFileName,
  advanceInvoiceMailBody,
  advanceInvoiceMailSubject,
  advanceInvoiceProblem,
  advanceInvoiceStateOf,
  buildAdvanceInvoiceDocument,
  renderAdvanceInvoiceHtml,
  type AdvanceInvoiceBookingSource
} from './partner-advance-invoice';
import type { InvoiceIssuer } from './partner-invoice';

const issuer: InvoiceIssuer = {
  name: '株式会社山人',
  facilityName: '山人-yamado-',
  address: '〒029-5514 岩手県和賀郡西和賀町湯川52-71-10',
  tel: '0197-82-2222',
  registrationNumber: 'T3400001006564',
  bankAccount: '岩手銀行 本店 普通 1234567\nカ）ヤマド',
  note: '振込手数料は貴社にてご負担ください。'
};

const booking = (over: Partial<AdvanceInvoiceBookingSource> = {}): AdvanceInvoiceBookingSource => ({
  id: 'b-1',
  booking_code: 'PB-2611-0001',
  status: 'confirmed',
  payment_option: 'advance_bank',
  payment_status: 'unpaid',
  check_in_date: '2026-11-20',
  check_out_date: '2026-11-22',
  nights: 2,
  room_name: '萌木',
  room_count: 1,
  adult_total: 2,
  plan_name: '基本■2食',
  guest_name: '山田 太郎',
  booked_by: 'jtb-01',
  total_amount: 100_000,
  bath_tax_amount: 600,
  prepay_discount_amount: 0,
  advance_amount: 100_600,
  advance_due_date: '2026-11-13',
  remainder_option: null,
  detail: { booker: { name: '鈴木 花子' }, plan_display_name: '取引先 2食付' },
  ...over
});

const build = (b = booking()) =>
  buildAdvanceInvoiceDocument({ booking: b, issuer, recipientName: '株式会社JTB', facilityName: '山人-yamado-', invoiceNo: 'PA-202610-00001', issueDate: '2026-10-28' });

describe('advanceInvoiceProblem', () => {
  it('銀行振込の事前支払で確定・入金前なら発行できる', () => {
    expect(advanceInvoiceProblem(booking())).toBeNull();
    expect(advanceInvoiceProblem(booking({ payment_option: 'deposit_bank' }))).toBeNull();
  });
  it('対象外の予約は理由を返す', () => {
    expect(advanceInvoiceProblem(booking({ payment_option: 'invoice_monthly' }))).toMatch(/銀行振込/);
    expect(advanceInvoiceProblem(booking({ payment_option: 'deposit_online' }))).toMatch(/銀行振込/);
    expect(advanceInvoiceProblem(booking({ advance_amount: null }))).toMatch(/台帳/);
    expect(advanceInvoiceProblem(booking({ advance_due_date: null }))).toMatch(/台帳/);
    expect(advanceInvoiceProblem(booking({ status: 'cancelled' }))).toMatch(/確定/);
    expect(advanceInvoiceProblem(booking({ payment_status: 'paid' }))).toMatch(/入金済み/);
    expect(advanceInvoiceProblem(booking({ payment_status: 'refunded' }))).toMatch(/返金/);
  });
});

describe('buildAdvanceInvoiceDocument', () => {
  it('全額（advance_bank）: 前受金＝ご利用総額・残額 0・精算先の文言なし', () => {
    const d = build();
    expect(d.amounts).toEqual({ lodging: 100_000, bathTax: 600, discount: 0, usage: 100_600, advance: 100_600, remainder: 0, partial: false, remainderNote: '' });
    expect(d.dueDate).toBe('2026-11-13');
    expect(d.booking.planName).toBe('取引先 2食付');
    expect(d.booking.bookerName).toBe('鈴木 花子');
    // 施設名は予約の内容の欄に出すので、発行者欄の施設名は空にする
    expect(d.issuer.facilityName).toBe('');
    expect(d.issuer.bankAccount).toBe(issuer.bankAccount);
  });
  it('一部（deposit_bank）: 残額と精算先（請求書／現地）', () => {
    const billed = build(booking({ payment_option: 'deposit_bank', advance_amount: 30_180, remainder_option: 'invoice_monthly' }));
    expect(billed.amounts).toMatchObject({ partial: true, advance: 30_180, remainder: 70_420, remainderNote: '月末の請求書で貴社へご請求' });
    const onsite = build(booking({ payment_option: 'deposit_bank', advance_amount: 30_180, remainder_option: 'onsite' }));
    expect(onsite.amounts.remainderNote).toBe('現地でご精算');
  });
  it('前受金がご利用総額を超えていたら総額で止める', () => {
    expect(build(booking({ advance_amount: 999_999 })).amounts.advance).toBe(100_600);
  });
  it('予約者・プランの表示名が無ければ台帳の値で補う', () => {
    const d = build(booking({ detail: null }));
    expect(d.booking.bookerName).toBe('jtb-01');
    expect(d.booking.planName).toBe('基本■2食');
  });
});

describe('advanceAmountRows', () => {
  it('一部は ご利用総額・前受金・残額（精算先つき）', () => {
    const rows = advanceAmountRows(build(booking({ payment_option: 'deposit_bank', advance_amount: 30_000, remainder_option: 'onsite' })).amounts);
    expect(rows.map((r) => r.label)).toEqual(['宿泊料金', '入湯税', 'ご利用総額', '前受金（今回のご請求）', '残額']);
    expect(rows.at(-1)).toMatchObject({ value: 70_600, note: '現地でご精算' });
  });
  it('全額は ご利用総額・前受金（全額）。入湯税 0 の行は出さない', () => {
    const rows = advanceAmountRows(build(booking({ bath_tax_amount: 0, advance_amount: 100_000 })).amounts);
    expect(rows.map((r) => r.label)).toEqual(['宿泊料金', 'ご利用総額', '前受金（全額・今回のご請求）']);
  });
});

describe('renderAdvanceInvoiceHtml', () => {
  it('題名・金額・期限・振込先・注記が載り、消費税の区分・登録番号は載せない', () => {
    const html = renderAdvanceInvoiceHtml(build());
    expect(html).toContain('<h1>前受金のご請求書</h1>');
    expect(html).toContain('100,600円');
    expect(html).toContain('お振込期限　2026年11月13日');
    expect(html).toContain('岩手銀行 本店 普通 1234567<br>カ）ヤマド');
    expect(html).toContain(ADVANCE_INVOICE_TEXT.lead);
    expect(html).toContain(ADVANCE_INVOICE_TEXT.taxNote);
    expect(html).toContain('PA-202610-00001');
    expect(html).not.toMatch(/消費税額|10%対象|適格請求書/);
    expect(html).not.toContain('T3400001006564');
  });
  it('一部は残額と精算先を示す', () => {
    const html = renderAdvanceInvoiceHtml(build(booking({ payment_option: 'deposit_bank', advance_amount: 30_000, remainder_option: 'invoice_monthly' })));
    expect(html).toContain('前受金（今回のご請求）');
    expect(html).toContain('残額 70,600円 は月末の請求書で貴社へご請求となります');
  });
  it('宛名・宿泊者名・振込先などをエスケープする', () => {
    const d = build(booking({ guest_name: '<script>alert(1)</script>', room_name: 'A&B' }));
    const html = renderAdvanceInvoiceHtml({ ...d, recipient: { name: '"><img src=x>' }, issuer: { ...d.issuer, bankAccount: '<b>口座</b>' } });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A&amp;B');
    expect(html).toContain('&quot;&gt;&lt;img src=x&gt; 御中');
    expect(html).toContain('&lt;b&gt;口座&lt;/b&gt;');
  });
  it('下書きは書類名に（予定）・番号は未発行', () => {
    const html = renderAdvanceInvoiceHtml(build(), { draft: true });
    expect(html).toContain('前受金のご請求書（予定）');
    expect(html).toContain('（未発行）');
    expect(html).not.toContain('PA-202610-00001</td>');
  });
});

describe('メール・ファイル名', () => {
  it('件名は【施設名】前受金のご請求書（番号）お振込期限', () => {
    expect(advanceInvoiceMailSubject(build())).toBe('【山人-yamado-】前受金のご請求書（PA-202610-00001）お振込期限 2026年11月13日');
  });
  it('本文に金額・期限・振込先・取引先ページのリンク', () => {
    const { text, html } = advanceInvoiceMailBody(build(), 'https://book.example/p/tok/account/invoices', true);
    expect(text).toContain('前受金（全額）: 100,600円');
    expect(text).toContain('お振込期限: 2026年11月13日');
    expect(text).toContain('　岩手銀行 本店 普通 1234567');
    expect(text).toContain('PDF を添付しています。');
    expect(html).toContain('<a href="https://book.example/p/tok/account/invoices">');
  });
  it('一部の本文は残額と精算先', () => {
    const { text } = advanceInvoiceMailBody(build(booking({ payment_option: 'deposit_bank', advance_amount: 30_000, remainder_option: 'onsite' })), 'u', false);
    expect(text).toContain('残額: 70,600円（現地でご精算）');
    expect(text).toContain('書類は下記のページからダウンロードできます。');
  });
  it('ファイル名', () => {
    expect(advanceInvoiceFileName(build(), 'pdf')).toBe('前受金のご請求書_PA-202610-00001_PB-2611-0001.pdf');
  });
  it('予約確認メールの1行は銀行振込の事前支払のときだけ', () => {
    expect(advanceBookingMailLine(booking())).toBe(
      '前受金 100,600円 を 2026年11月13日までにお振込みください（前受金のご請求書は別メールでお送りします／取引先ページ「アカウント → ご請求書」からもダウンロードできます）。'
    );
    expect(advanceBookingMailLine(booking({ payment_option: 'invoice_monthly' }))).toBeNull();
    expect(advanceBookingMailLine(booking({ advance_amount: null }))).toBeNull();
  });
});

describe('advanceInvoiceStateOf', () => {
  const inv = { status: 'issued', due_date: '2026-11-13' };
  it('取消 → ご予約取消 → 入金済み → 期限超過 → 入金待ち', () => {
    expect(advanceInvoiceStateOf({ ...inv, status: 'void' }, { status: 'confirmed', payment_status: 'paid' }, '2026-10-28')).toBe('void');
    expect(advanceInvoiceStateOf(inv, { status: 'cancelled', payment_status: 'unpaid' }, '2026-10-28')).toBe('booking_cancelled');
    expect(advanceInvoiceStateOf(inv, { status: 'confirmed', payment_status: 'paid' }, '2026-12-01')).toBe('paid');
    expect(advanceInvoiceStateOf(inv, { status: 'confirmed', payment_status: 'unpaid' }, '2026-11-14')).toBe('overdue');
    expect(advanceInvoiceStateOf(inv, { status: 'confirmed', payment_status: 'unpaid' }, '2026-11-13')).toBe('waiting');
  });
});
