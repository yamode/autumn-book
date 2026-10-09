// 取引先の月次請求書（利用明細書＋適格請求書）の純関数のテスト。
import { describe, expect, it } from 'vitest';
import {
  buildInvoiceLines,
  cancelChargeOf,
  depositCancelPartsOf,
  isPartnerBilledBooking,
  draftInvoiceDocName,
  draftInvoiceFileName,
  groupStatementLines,
  invoiceFileName,
  invoiceCutoffDate,
  invoiceTotals,
  isBillablePaymentOption,
  isChargeFailed,
  isInvoiceTarget,
  isLastDayOfMonth,
  MAX_INVOICE_SEND_ATTEMPTS,
  sendFailureCount,
  sendFailureMessage,
  lastDayOfMonth,
  nextMonthEnd,
  periodLabel,
  periodOf,
  renderInvoiceHtml,
  facilitiesOfLines,
  groupStatementByFacility,
  invoiceFacilityCsv,
  invoiceFacilityNames,
  isMultiFacilityInvoice,
  type InvoiceBookingSource,
  type InvoiceDocument,
  type InvoiceDocumentV1,
  type InvoiceDocumentV2
} from './partner-invoice';

const settings = {
  customPaymentOptions: [
    { id: 'custom_bill', label: '請求書払い（20日締め）', note: '', billable: true },
    { id: 'custom_card', label: '現地精算（法人カード）', note: '', billable: false }
  ]
};

const booking = (over: Partial<InvoiceBookingSource> = {}): InvoiceBookingSource => ({
  id: 'b1',
  booking_code: 'P-0001',
  status: 'confirmed',
  check_in_date: '2026-10-10',
  check_out_date: '2026-10-11',
  nights: 1,
  room_name: '和室',
  room_count: 1,
  adult_total: 2,
  plan_name: '2食付き',
  guest_name: '山田 太郎',
  booked_by: 'agent01',
  total_amount: 33000,
  bath_tax_amount: 300,
  prepay_discount_amount: 0,
  payment_option: 'invoice_monthly',
  payment_method_name: '月末締め翌月末銀行振込',
  payment_status: 'none',
  detail: null,
  ...over
});

describe('期間', () => {
  it('対象月・月末・翌月末', () => {
    expect(periodOf('2026-10-15')).toBe('2026-10-01');
    expect(lastDayOfMonth('2026-02-01')).toBe('2026-02-28');
    expect(lastDayOfMonth('2028-02-01')).toBe('2028-02-29');
    expect(lastDayOfMonth('2026-12-01')).toBe('2026-12-31');
    expect(isLastDayOfMonth('2026-10-31')).toBe(true);
    expect(isLastDayOfMonth('2026-10-30')).toBe(false);
    expect(isLastDayOfMonth('2026-02-28')).toBe(true);
    expect(nextMonthEnd('2026-10-01')).toBe('2026-11-30');
    expect(nextMonthEnd('2026-12-01')).toBe('2027-01-31');
    expect(nextMonthEnd('2027-01-01')).toBe('2027-02-28');
    expect(periodLabel('2026-03-01')).toBe('2026年3月');
  });

  it('対象: 確定済みでチェックアウトがその月', () => {
    expect(isInvoiceTarget({ status: 'confirmed', check_out_date: '2026-10-01' }, '2026-10-01')).toBe(true);
    expect(isInvoiceTarget({ status: 'confirmed', check_out_date: '2026-10-31' }, '2026-10-01')).toBe(true);
    expect(isInvoiceTarget({ status: 'confirmed', check_out_date: '2026-11-01' }, '2026-10-01')).toBe(false);
    expect(isInvoiceTarget({ status: 'confirmed', check_out_date: '2026-09-30' }, '2026-10-01')).toBe(false);
    expect(isInvoiceTarget({ status: 'cancelled', check_out_date: '2026-10-15' }, '2026-10-01')).toBe(false);
    expect(isInvoiceTarget({ status: 'pending_payment', check_out_date: '2026-10-15' }, '2026-10-01')).toBe(false);
  });

  it('対象: 月の途中で発行すると、今日より後にチェックアウトする予約は載らない', () => {
    const b = (d: string) => ({ status: 'confirmed', check_out_date: d });
    expect(invoiceCutoffDate('2026-10-01', '2026-10-15')).toBe('2026-10-15');
    expect(invoiceCutoffDate('2026-10-01', '2026-11-03')).toBe('2026-10-31');
    expect(invoiceCutoffDate('2026-10-01')).toBe('2026-10-31');
    expect(isInvoiceTarget(b('2026-10-15'), '2026-10-01', '2026-10-15')).toBe(true);
    expect(isInvoiceTarget(b('2026-10-16'), '2026-10-01', '2026-10-15')).toBe(false);
    expect(isInvoiceTarget(b('2026-10-31'), '2026-10-01', '2026-10-31')).toBe(true);
    // 過去の月は今日に関係なく月末まで
    expect(isInvoiceTarget(b('2026-09-30'), '2026-09-01', '2026-10-15')).toBe(true);
  });
});

describe('ご請求の対象', () => {
  it('後払いは常に・自由入力は billable だけ・オンライン決済は対象外', () => {
    expect(isBillablePaymentOption('invoice_monthly', settings)).toBe(true);
    expect(isBillablePaymentOption('custom_bill', settings)).toBe(true);
    expect(isBillablePaymentOption('custom_card', settings)).toBe(false);
    expect(isBillablePaymentOption('online', settings)).toBe(false);
    expect(isBillablePaymentOption('online_checkin', settings)).toBe(false);
    expect(isBillablePaymentOption(null, settings)).toBe(false);
    expect(isBillablePaymentOption('custom_unknown', settings)).toBe(false);
  });
});

describe('明細と合計', () => {
  const lines = buildInvoiceLines(
    [
      booking({ id: 'b3', booking_code: 'P-0003', check_out_date: '2026-10-20', payment_option: 'custom_bill', payment_method_name: '請求書払い（20日締め）', total_amount: 22000, bath_tax_amount: 150 }),
      // オンライン決済（予約時）済み・割引あり → 0 円のご請求
      booking({ id: 'b2', booking_code: 'P-0002', check_out_date: '2026-10-05', payment_option: 'online', payment_method_name: 'オンライン決済', payment_status: 'paid', total_amount: 20000, bath_tax_amount: 150, prepay_discount_amount: 1000 }),
      booking({ id: 'b1', booking_code: 'P-0001', check_out_date: '2026-10-20', total_amount: 33333, bath_tax_amount: 300 }),
      booking({ id: 'b4', booking_code: 'P-0004', check_out_date: '2026-10-25', payment_option: 'custom_card', payment_method_name: '現地精算（法人カード）', total_amount: 10000, bath_tax_amount: 150, detail: { booker: { name: ' 佐藤 ' } } })
    ],
    settings
  );

  it('チェックアウト日 → 予約番号の順に並ぶ', () => {
    expect(lines.map((l) => l.bookingCode)).toEqual(['P-0002', 'P-0001', 'P-0003', 'P-0004']);
  });

  it('ご請求の対象と金額', () => {
    const byCode = Object.fromEntries(lines.map((l) => [l.bookingCode, l]));
    expect(byCode['P-0002']).toMatchObject({ billable: false, usage: 19150, billed: 0, discount: 1000 });
    expect(byCode['P-0002'].paymentLabel).toContain('オンライン決済済み');
    expect(byCode['P-0001']).toMatchObject({ billable: true, usage: 33633, billed: 33633 });
    expect(byCode['P-0003']).toMatchObject({ billable: true, usage: 22150, billed: 22150 });
    expect(byCode['P-0004']).toMatchObject({ billable: false, billed: 0, bookerName: '佐藤' });
    expect(byCode['P-0001'].bookerName).toBe('agent01');
  });

  it('合計: 10%対象は税込から割り戻して1回だけ切り捨て・入湯税は不課税', () => {
    const t = invoiceTotals(lines);
    expect(t.usageTotal).toBe(19150 + 33633 + 22150 + 10150);
    expect(t.billedTotal).toBe(33633 + 22150);
    expect(t.paidTotal).toBe(t.usageTotal - t.billedTotal);
    expect(t.taxable10).toBe(33333 + 22000);
    expect(t.nonTaxable).toBe(300 + 150);
    // 55333 × 10 / 110 = 5030.27… → 5030
    expect(t.tax10).toBe(Math.floor((55333 * 10) / 110));
    expect(t.taxable10 + t.nonTaxable).toBe(t.billedTotal);
  });

  it('行ごとに丸めると変わる例でも、請求書1枚で1回だけ切り捨てる', () => {
    const ls = buildInvoiceLines(
      [booking({ id: 'x1', booking_code: 'X1', total_amount: 1009, bath_tax_amount: 0 }), booking({ id: 'x2', booking_code: 'X2', total_amount: 1009, bath_tax_amount: 0 })],
      settings
    );
    // 行ごと: floor(91.72)+floor(91.72)=182 ／ 1回: floor(183.45)=183
    expect(invoiceTotals(ls).tax10).toBe(183);
  });

  it('オンライン決済だけなら 0 円請求', () => {
    const t = invoiceTotals(buildInvoiceLines([booking({ payment_option: 'online', payment_status: 'paid' })], settings));
    expect(t.billedTotal).toBe(0);
    expect(t.tax10).toBe(0);
    expect(t.paidTotal).toBe(t.usageTotal);
  });
});

const docOf = (bookings: InvoiceBookingSource[], over: Partial<InvoiceDocumentV1> = {}): InvoiceDocumentV1 => {
  const lines = buildInvoiceLines(bookings, settings);
  return {
    version: 1,
    invoiceNo: 'PI-202610-00001',
    period: '2026-10-01',
    issueDate: '2026-10-31',
    dueDate: '2026-11-30',
    recipient: { name: '○○トラベル' },
    issuer: {
      name: '株式会社山人',
      facilityName: '山人-yamado-',
      address: '〒029-5514 岩手県和賀郡西和賀町湯川52-71-10',
      tel: '0197-82-2222',
      registrationNumber: 'T3400001006564',
      bankAccount: '○○銀行 △△支店\n普通 1234567',
      note: '振込手数料は貴社にてご負担ください。'
    },
    lines,
    totals: invoiceTotals(lines),
    ...over
  };
};

describe('紙面（HTML）', () => {
  it('ご請求ありなら請求書＋利用明細書', () => {
    const html = renderInvoiceHtml(docOf([booking()]));
    expect(html).toContain('<h1>ご請求書</h1>');
    expect(html).toContain('<h1>ご利用明細書</h1>');
    expect(html).toContain('T3400001006564');
    expect(html).toContain('2026年11月30日');
    expect(html).toContain('○○銀行 △△支店<br>普通 1234567');
  });

  it('0 円なら利用明細書だけ', () => {
    const doc = docOf([booking({ payment_option: 'online', payment_status: 'paid' })]);
    const html = renderInvoiceHtml(doc);
    expect(html).not.toContain('<h1>ご請求書</h1>');
    expect(html).toContain('<h1>ご利用明細書</h1>');
    expect(html).toContain('<title>ご利用明細書 PI-202610-00001</title>');
    expect(invoiceFileName(doc, 'pdf')).toBe('ご利用明細書_PI-202610-00001_2026年10月.pdf');
    expect(invoiceFileName(docOf([booking()]), 'html')).toBe('ご請求書・ご利用明細書_PI-202610-00001_2026年10月.html');
  });

  it('文字列はエスケープする', () => {
    const doc = docOf([booking({ guest_name: '<script>alert(1)</script>', room_name: 'A&B "x"' })], {
      recipient: { name: "O'Reilly <b>" }
    });
    const html = renderInvoiceHtml(doc);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A&amp;B &quot;x&quot;');
    expect(html).toContain('O&#39;Reilly &lt;b&gt; 御中');
  });
});

describe('予定請求書（draft）', () => {
  it('書類名・帯・透かし・未発行・試算日', () => {
    const doc = docOf([booking()], { invoiceNo: '（未発行）', issueDate: '2026-10-02' });
    const html = renderInvoiceHtml(doc, { draft: true });
    expect(html).toContain('<h1>ご請求書（予定）</h1>');
    expect(html).toContain('<h1>ご利用明細書（予定）</h1>');
    expect(html).toContain('予定請求書 — 10月2日時点の実績（チェックアウト済み）による試算です。正式なご請求書ではありません');
    expect(html).toContain('class="draft-wm"');
    expect(html).toContain('<td>試算日</td><td>2026年10月2日</td>');
    expect(html).toContain('<td>請求書番号</td><td>（未発行）</td>');
    expect(html).not.toContain('<td>発行日</td>');
    expect(html).toContain('<title>ご請求書（予定） ○○トラベル 2026年10月</title>');
  });

  it('draft でなければ正式版と同じ（オプション省略と一致・予定の表示なし）', () => {
    const doc = docOf([booking()]);
    const html = renderInvoiceHtml(doc);
    expect(renderInvoiceHtml(doc, { draft: false })).toBe(html);
    expect(html).not.toContain('（予定）');
    expect(html).not.toContain('draft-band');
    expect(html).not.toContain('draft-wm');
    expect(html).toContain('<td>請求書番号</td><td>PI-202610-00001</td>');
    expect(html).toContain('<td>発行日</td><td>2026年10月31日</td>');
  });

  it('ファイル名（ご請求 0 円なら利用明細書・使えない文字は全角に）', () => {
    expect(draftInvoiceFileName(docOf([booking()]), '○○トラベル', 'pdf')).toBe('ご請求書（予定）_○○トラベル_2026年10月.pdf');
    const paid = docOf([booking({ payment_option: 'online', payment_status: 'paid' })]);
    expect(draftInvoiceDocName(paid)).toBe('ご利用明細書（予定）');
    expect(draftInvoiceFileName(paid, 'A/B:C', 'html')).toBe('ご利用明細書（予定）_A／B：C_2026年10月.html');
    expect(draftInvoiceFileName(paid, '  ', 'pdf')).toBe('ご利用明細書（予定）_取引先_2026年10月.pdf');
  });
});

describe('カード決済失敗', () => {
  it('charge_failed は別ラベル・請求はしない', () => {
    const lines = buildInvoiceLines(
      [
        booking({ id: 'f', booking_code: 'P-0010', payment_option: 'online_checkin', payment_method_name: 'カード決済（チェックイン日）', payment_status: 'charge_failed' }),
        booking({ id: 's', booking_code: 'P-0011', payment_option: 'online_checkin', payment_method_name: 'カード決済（チェックイン日）', payment_status: 'scheduled' })
      ],
      settings
    );
    const byCode = Object.fromEntries(lines.map((l) => [l.bookingCode, l]));
    expect(byCode['P-0010'].paymentLabel).toContain('カード決済失敗（要確認）');
    expect(byCode['P-0010'].billable).toBe(false);
    expect(byCode['P-0010'].billed).toBe(0);
    expect(byCode['P-0011'].paymentLabel).not.toContain('要確認');
    expect(isChargeFailed({ payment_status: 'charge_failed' })).toBe(true);
    expect(isChargeFailed({ payment_status: 'scheduled' })).toBe(false);
  });
});

describe('送信失敗の回数', () => {
  it('send_error の先頭の印で数える', () => {
    expect(sendFailureCount(null)).toBe(0);
    expect(sendFailureCount('古い形式のエラー')).toBe(1);
    const first = sendFailureMessage(null, '送信先がありません');
    expect(first).toBe('[送信失敗 1回目] 送信先がありません');
    expect(sendFailureCount(first)).toBe(1);
    const second = sendFailureMessage(first, 'HTTP 500');
    expect(second).toBe('[送信失敗 2回目] HTTP 500');
    const third = sendFailureMessage(second, '[送信失敗 9回目] 二重の印は消す');
    expect(third).toBe('[送信失敗 3回目] 二重の印は消す');
    expect(sendFailureCount(third) >= MAX_INVOICE_SEND_ATTEMPTS).toBe(true);
  });
});

describe('ご利用明細書のグループ（お支払方法別）', () => {
  it('ご請求の対象を先に、お支払方法ごとにまとめる。旧形式は paymentLabel を見出しに', () => {
    const base = { bookingId: 'x', checkIn: '2026-10-01', checkOut: '2026-10-02', nights: 1, roomName: 'R', roomCount: 1, adults: 2, planName: 'P', guestName: 'G', bookerName: '', lodging: 1000, bathTax: 0, discount: 0, usage: 1000 };
    const g = groupStatementLines([
      { ...base, bookingCode: 'A', paymentLabel: 'オンライン（済）', paymentMethod: 'オンライン', paymentNote: '済', billable: false, billed: 0 },
      { ...base, bookingCode: 'B', paymentLabel: '月末', paymentMethod: '月末', paymentNote: '', billable: true, billed: 1000 },
      { ...base, bookingCode: 'C', paymentLabel: '月末', paymentMethod: '月末', paymentNote: '', billable: true, billed: 1000 },
      { ...base, bookingCode: 'D', paymentLabel: '旧ラベル', billable: false, billed: 0 }
    ]);
    expect(g.map((x) => [x.method, x.billable, x.lines.length])).toEqual([
      ['月末', true, 2],
      ['オンライン', false, 1],
      ['旧ラベル', false, 1]
    ]);
  });
});

describe('取消の予約のキャンセル料（2026-10-06〜・不課税）', () => {
  const cancelled = (over: Partial<InvoiceBookingSource> = {}) =>
    booking({ status: 'cancelled', cancelled_at: '2026-10-08T05:00:00Z', cancel_fee: 15_600, cancel_fee_rate: 30, cancel_fee_basis: '2日前', cancel_fee_settlement: 'invoice', ...over });
  it('キャンセル料がある取消は、チェックアウト予定日の月に載せる。無ければ載せない', () => {
    expect(isInvoiceTarget(cancelled(), '2026-10-01')).toBe(true);
    expect(isInvoiceTarget(cancelled({ cancel_fee: 0, cancel_fee_settlement: 'none' }), '2026-10-01')).toBe(false);
    expect(isInvoiceTarget(cancelled({ cancel_fee: 0, cancel_fee_settlement: null }), '2026-10-01')).toBe(false);
  });
  it('請求書払いはキャンセル料だけを請求し、10%対象に入れず不課税で集計する', () => {
    const [l] = buildInvoiceLines([cancelled()], settings);
    expect(l).toMatchObject({ lodging: 0, bathTax: 0, usage: 15_600, billable: true, billed: 15_600, cancelFee: 15_600, cancelledOn: '2026-10-08', cancelNote: 'キャンセル料 2日前の取消 30%' });
    const t = invoiceTotals([l, ...buildInvoiceLines([booking()], settings)]);
    expect(t.cancelFee).toBe(15_600);
    expect(t.taxable10).toBe(buildInvoiceLines([booking()], settings)[0].lodging);
  });
  it('予約時決済から差し引いた分・カードで回収した分は対象外（済み）として明細に出す', () => {
    const [r] = buildInvoiceLines([cancelled({ cancel_fee_settlement: 'refund', payment_status: 'refunded', paid_amount: 52_300, refund_amount: 36_700 })], settings);
    expect(r).toMatchObject({ usage: 15_600, billable: false, billed: 0, paymentNote: 'オンライン決済から差引済み' });
    const [c] = buildInvoiceLines([cancelled({ cancel_fee_settlement: 'card', cancel_fee_status: 'charged' })], settings);
    expect(c).toMatchObject({ billable: false, paymentNote: 'カード決済済み' });
  });
});

describe('デポジット（Phase 3b）', () => {
  // 宿泊料金 100,000・入湯税 1,500・デポジット 30% = 30,450（予約時決済割引なし）
  const dep = (over: Partial<InvoiceBookingSource> = {}) =>
    booking({
      total_amount: 100_000,
      bath_tax_amount: 1_500,
      payment_option: 'deposit_online',
      payment_method_name: 'デポジット（予約時にオンライン決済・残額は後日）',
      payment_status: 'paid',
      paid_amount: 30_450,
      deposit_amount: 30_450,
      remainder_option: 'invoice_monthly',
      ...over
    });
  it('残額が請求書: ご請求の対象として残額だけを請求し、デポジットを差し引く', () => {
    const [l] = buildInvoiceLines([dep()], settings);
    expect(l).toMatchObject({ usage: 101_500, billable: true, billed: 71_050, deposit: 30_450, paymentNote: '' });
    const t = invoiceTotals([l]);
    // デポジットは宿泊料金（10%）から先に差し引く。入湯税はそのまま
    expect(t).toMatchObject({ usageTotal: 101_500, billedTotal: 71_050, paidTotal: 30_450, taxable10: 69_550, nonTaxable: 1_500 });
    expect(t.tax10).toBe(Math.floor((69_550 * 10) / 110));
    expect(t.taxable10 + t.nonTaxable).toBe(t.billedTotal);
  });
  it('他の予約と合わせても合計・消費税の端数処理は請求書1枚で1回', () => {
    const lines = buildInvoiceLines([dep(), booking({ id: 'b2', booking_code: 'P-0002' })], settings);
    const t = invoiceTotals(lines);
    expect(t.billedTotal).toBe(71_050 + 33_300);
    expect(t.taxable10).toBe(69_550 + 33_000);
    expect(t.nonTaxable).toBe(1_500 + 300);
    expect(t.tax10).toBe(Math.floor(((69_550 + 33_000) * 10) / 110));
  });
  it('残額が現地: 明細に載るが請求額 0（デポジットお支払い済み・残額は現地で精算）', () => {
    const [l] = buildInvoiceLines([dep({ remainder_option: 'onsite' })], settings);
    expect(l).toMatchObject({ billable: false, billed: 0, deposit: 30_450 });
    expect(l.paymentNote).toBe('デポジット 30,450円 お支払い済み・残額は現地で精算');
  });
  it('紙面に「うちデポジット ○円 お支払い済み」を出す', () => {
    const lines = buildInvoiceLines([dep()], settings);
    const doc: InvoiceDocument = {
      version: 1,
      invoiceNo: 'PI-202610-00001',
      period: '2026-10-01',
      issueDate: '2026-10-31',
      dueDate: '2026-11-30',
      recipient: { name: '株式会社テスト' },
      issuer: { name: '株式会社山人', facilityName: '', address: '', tel: '', registrationNumber: '', bankAccount: '', note: '' },
      lines,
      totals: invoiceTotals(lines)
    };
    const html = renderInvoiceHtml(doc);
    expect(html).toContain('うちデポジット 30,450円 お支払い済み');
    expect(html).toContain('71,050円');
  });
  it('取消（キャンセル料 < デポジット）: 充当分はお支払い済み・請求 0', () => {
    const c = dep({ status: 'cancelled', cancelled_at: '2026-10-08T05:00:00Z', cancel_fee: 10_000, cancel_fee_rate: 10, cancel_fee_basis: '3日前', cancel_fee_settlement: 'deposit', payment_status: 'refunded', refund_amount: 20_450 });
    expect(cancelChargeOf(c)).toBe(10_000);
    expect(isInvoiceTarget(c, '2026-10-01')).toBe(true);
    const [l] = buildInvoiceLines([c], settings);
    expect(l).toMatchObject({ usage: 10_000, billable: false, billed: 0, deposit: 10_000, paymentNote: 'デポジットから充当済み' });
  });
  it('取消（キャンセル料 < デポジット・スタッフが「返金しない」）: デポジット全額を受け取ったままとして扱う', () => {
    const c = dep({ status: 'cancelled', cancel_fee: 10_000, cancel_fee_settlement: 'deposit', payment_status: 'paid' });
    expect(depositCancelPartsOf(c)).toEqual({ kept: 30_450, shortage: 0 });
  });
  it('取消（キャンセル料 > デポジット・残額は請求書）: 不足分だけを不課税で請求', () => {
    const c = dep({ status: 'cancelled', cancelled_at: '2026-10-08T05:00:00Z', cancel_fee: 50_000, cancel_fee_rate: 50, cancel_fee_basis: '前日', cancel_fee_settlement: 'deposit' });
    expect(depositCancelPartsOf(c)).toEqual({ kept: 30_450, shortage: 19_550 });
    const [l] = buildInvoiceLines([c], settings);
    expect(l).toMatchObject({ usage: 50_000, billable: true, billed: 19_550, cancelFee: 50_000, deposit: 30_450 });
    const t = invoiceTotals([l]);
    expect(t).toMatchObject({ billedTotal: 19_550, cancelFee: 19_550, taxable10: 0, nonTaxable: 0, paidTotal: 30_450 });
  });
  it('取消（キャンセル料 > デポジット・残額は現地）: 不足 19,550 を不課税で請求書に（2026-10-07 変更・旧 N3 廃止）', () => {
    const c = dep({ status: 'cancelled', remainder_option: 'onsite', cancel_fee: 50_000, cancel_fee_settlement: 'deposit' });
    expect(cancelChargeOf(c)).toBe(50_000);
    expect(isInvoiceTarget(c, '2026-10-01')).toBe(true);
    const [l] = buildInvoiceLines([c], settings);
    expect(l).toMatchObject({ billable: true, billed: 19_550, deposit: 30_450 });
  });
  it('取引先払いの判定: デポジットは残額の精算先で決める', () => {
    expect(isPartnerBilledBooking({ payment_option: 'deposit_online', remainder_option: 'invoice_monthly' }, settings)).toBe(true);
    expect(isPartnerBilledBooking({ payment_option: 'deposit_online', remainder_option: 'onsite' }, settings)).toBe(false);
    expect(isPartnerBilledBooking({ payment_option: 'custom_bill' }, settings)).toBe(true);
    expect(isPartnerBilledBooking({ payment_option: 'online' }, settings)).toBe(false);
  });
});

describe('全施設分を1枚（version 2・決定 N3・2026-10-09）', () => {
  const NW = { id: 'fac-nw', name: '山人-yamado-', address: '〒029-5514 岩手県和賀郡西和賀町湯川52-71-10', tel: '0197-82-2222' };
  const OGA = { id: 'fac-oga', name: '山人-oga-', address: '〒010-0531 秋田県男鹿市船川港台島字鵜ノ崎62-29', tel: '0185-47-7776' };
  const ORDER = [NW, OGA];
  const at = (f: { id: string; name: string }, over: Partial<InvoiceBookingSource> = {}) =>
    booking({ facility_id: f.id, facility_name: f.name, ...over });

  const v2Of = (bookings: InvoiceBookingSource[], order = ORDER): InvoiceDocumentV2 => {
    const v1 = docOf(bookings);
    return { ...v1, version: 2, issuer: { ...v1.issuer, facilityName: '' }, facilities: facilitiesOfLines(v1.lines, order) };
  };

  const mixed = () => [
    at(OGA, { id: 'o1', booking_code: 'P-0101', check_in_date: '2026-10-04', check_out_date: '2026-10-05', total_amount: 11_006, bath_tax_amount: 150 }),
    at(NW, { id: 'n1', booking_code: 'P-0102', check_in_date: '2026-10-05', check_out_date: '2026-10-06', total_amount: 11_006, bath_tax_amount: 150 }),
    at(NW, { id: 'n2', booking_code: 'P-0103', payment_option: 'online', payment_method_name: 'オンライン決済', payment_status: 'paid', total_amount: 20_000 }),
    // 取消の行（キャンセル料・請求書払い）も予約の施設に帰属する
    at(OGA, {
      id: 'o2',
      booking_code: 'P-0104',
      status: 'cancelled',
      cancel_fee: 5_000,
      cancel_fee_rate: 30,
      cancel_fee_basis: '2日前',
      cancel_fee_settlement: 'invoice',
      cancelled_at: '2026-10-08T01:00:00Z'
    })
  ];

  it('明細の行に予約の施設が付く（取消の行も）。施設の無い入力は従来どおり', () => {
    const lines = buildInvoiceLines(mixed(), settings);
    const by = Object.fromEntries(lines.map((l) => [l.bookingCode, l]));
    expect(by['P-0101']).toMatchObject({ facilityId: 'fac-oga', facilityName: '山人-oga-' });
    expect(by['P-0104']).toMatchObject({ facilityId: 'fac-oga', cancelFee: 5_000, billable: true });
    const [old] = buildInvoiceLines([booking()], settings);
    expect('facilityId' in old).toBe(false);
  });

  it('施設の並び順・施設小計（10%対象・入湯税・キャンセル料・ご請求額だけ。消費税は持たない）', () => {
    const doc = v2Of(mixed());
    expect(doc.facilities.map((f) => f.id)).toEqual(['fac-nw', 'fac-oga']);
    const [nw, oga] = doc.facilities;
    expect(nw).toMatchObject({ name: '山人-yamado-', tel: '0197-82-2222' });
    expect(nw.totals).toEqual({ count: 2, billableCount: 1, usageTotal: 31_456, paidTotal: 20_300, billedTotal: 11_156, taxable10: 11_006, nonTaxable: 150, cancelFee: 0 });
    expect(oga.totals).toEqual({ count: 2, billableCount: 2, usageTotal: 16_156, paidTotal: 0, billedTotal: 16_156, taxable10: 11_006, nonTaxable: 150, cancelFee: 5_000 });
    expect('tax10' in nw.totals).toBe(false);
    // 施設小計の合計は全体と一致
    const sum = (k: 'billedTotal' | 'taxable10' | 'nonTaxable' | 'cancelFee' | 'usageTotal') => doc.facilities.reduce((s, f) => s + f.totals[k], 0);
    expect(sum('billedTotal')).toBe(doc.totals.billedTotal);
    expect(sum('taxable10')).toBe(doc.totals.taxable10);
    expect(sum('nonTaxable')).toBe(doc.totals.nonTaxable);
    expect(sum('cancelFee')).toBe(doc.totals.cancelFee);
    expect(sum('usageTotal')).toBe(doc.totals.usageTotal);
  });

  it('消費税は請求書1枚で1回だけ切り捨て（施設ごとに計算した合計とずれても全体が正）', () => {
    const doc = v2Of(mixed());
    // 11,006 × 10/110 = 1000.5… → 施設ごとなら 1,000 + 1,000 = 2,000。全体なら 22,012 × 10/110 = 2001.09… → 2,001
    expect(doc.totals.taxable10).toBe(22_012);
    expect(doc.totals.tax10).toBe(2_001);
    const perFacility = doc.facilities.reduce((s, f) => s + Math.floor((f.totals.taxable10 * 10) / 110), 0);
    expect(perFacility).toBe(2_000);
  });

  it('order に無い施設は後ろに・名前は行の施設名', () => {
    const lines = buildInvoiceLines([at({ id: 'fac-x', name: '別館' }), at(OGA, { id: 'o9', booking_code: 'P-0999' })], settings);
    expect(facilitiesOfLines(lines, ORDER).map((f) => [f.id, f.name])).toEqual([
      ['fac-oga', '山人-oga-'],
      ['fac-x', '別館']
    ]);
  });

  it('ご利用明細書は 施設 → お支払方法（ご請求の対象を先）の2階層', () => {
    const sections = groupStatementByFacility(v2Of(mixed()));
    expect(sections.map((s) => [s.facility.id, s.groups.map((g) => [g.method, g.billable, g.lines.map((l) => l.bookingCode)])])).toEqual([
      [
        'fac-nw',
        [
          ['月末締め翌月末銀行振込', true, ['P-0102']],
          ['オンライン決済', false, ['P-0103']]
        ]
      ],
      ['fac-oga', [['月末締め翌月末銀行振込', true, ['P-0101', 'P-0104']]]]
    ]);
    // version 1 は1グループ（従来の groupStatementLines と同じ）
    const v1 = docOf([booking(), booking({ id: 'b2', booking_code: 'P-0002', payment_option: 'online', payment_status: 'paid', payment_method_name: 'オンライン決済' })]);
    const [only] = groupStatementByFacility(v1);
    expect(only.groups).toEqual(groupStatementLines(v1.lines));
  });

  it('2施設の紙面: 施設の見出し → 行 → 施設小計。税率ごとの区分は全体で1つ・端数の注記', () => {
    const doc = v2Of(mixed());
    expect(isMultiFacilityInvoice(doc)).toBe(true);
    const html = renderInvoiceHtml(doc);
    // ご請求書: 施設の見出し行と施設小計
    expect(html).toContain('<tr class="fac"><td colspan="5">山人-yamado-');
    expect(html).toContain('<tr class="fac"><td colspan="5">山人-oga-');
    expect(html).toContain(
      '山人-oga- 小計（2件）<br><span class="muted small">うちキャンセル料（不課税） 5,000円</span></td><td class="n">11,006円</td><td class="n">150円</td><td class="n">16,156円</td>'
    );
    expect(html.indexOf('<tr class="fac"><td colspan="5">山人-yamado-')).toBeLessThan(html.indexOf('<tr class="fac"><td colspan="5">山人-oga-'));
    // 消費税の区分の表は1つだけ（施設小計に消費税は出さない）
    expect(html.split('<th class="n">消費税額</th>').length - 1).toBe(1);
    expect(html).toContain('<td>10%対象（宿泊料金）</td><td class="n">22,012円</td><td class="n">2,001円</td>');
    expect(html).toContain('消費税額は請求書全体の10%対象額から1回だけ計算しています');
    // ご利用明細書: 施設の見出し（連絡先つき）と施設小計
    expect(html).toContain('<div class="fac-h"><span>山人-yamado-</span><small>〒029-5514 岩手県和賀郡西和賀町湯川52-71-10　TEL 0197-82-2222・2件</small></div>');
    expect(html).toContain('山人-yamado- 小計（2件）</td><td class="n">31,456円</td><td class="n">11,156円</td>');
    expect(html).toContain('<tr class="sum"><td>合計（4件）</td><td class="n">47,612円</td><td class="n">27,312円</td></tr>');
    // 発行者欄に施設名を出さない
    expect(html).not.toMatch(/<b>株式会社山人<\/b><br>\s*山人-/);
  });

  it('1施設だけの version 2 は施設の見出し・小計を出さず、従来（version 1）と同じ紙面', () => {
    const bookings = [at(NW), at(NW, { id: 'b2', booking_code: 'P-0002', payment_option: 'online', payment_status: 'paid', payment_method_name: 'オンライン決済' })];
    const v2 = v2Of(bookings);
    expect(v2.facilities).toHaveLength(1);
    expect(isMultiFacilityInvoice(v2)).toBe(false);
    const v1: InvoiceDocumentV1 = { ...docOf(bookings), issuer: v2.issuer };
    expect(renderInvoiceHtml(v2)).toBe(renderInvoiceHtml(v1));
    expect(renderInvoiceHtml(v2, { draft: true })).toBe(renderInvoiceHtml(v1, { draft: true }));
    const html = renderInvoiceHtml(v2);
    expect(html).not.toContain('class="fac"');
    expect(html).not.toContain('fac-h');
    expect(html).not.toContain('1回だけ計算しています');
  });

  it('version 1 の紙面は従来どおり（施設名は発行者欄に・施設の見出しなし）', () => {
    const v1 = docOf([at(NW), at(OGA, { id: 'o1', booking_code: 'P-0101' })]);
    expect(v1.version).toBe(1);
    expect(isMultiFacilityInvoice(v1)).toBe(false);
    const html = renderInvoiceHtml(v1);
    expect(html).toMatch(/<b>株式会社山人<\/b><br>\s*山人-yamado-<br>/);
    expect(html).not.toContain('class="fac"');
    expect(html).not.toContain('fac-h');
  });

  it('載っている施設名（一覧の表示用）', () => {
    expect(invoiceFacilityNames(v2Of(mixed()))).toEqual(['山人-yamado-', '山人-oga-']);
    expect(invoiceFacilityNames(docOf([booking()]))).toEqual(['山人-yamado-']);
  });

  it('施設別小計の CSV（期間・取引先・施設・税込・入湯税・キャンセル料・請求額）', () => {
    const csv = invoiceFacilityCsv([
      { period: '2026-10-01', partnerName: '○○トラベル', facilityName: '山人-yamado-', taxable10: 11_006, nonTaxable: 150, cancelFee: 0, billedTotal: 11_156 },
      { period: '2026-10-01', partnerName: 'A,"B"', facilityName: '山人-oga-', taxable10: 0, nonTaxable: 0, cancelFee: 5_000, billedTotal: 5_000 },
      { period: '2026-10-01', partnerName: '=HYPERLINK("x")', facilityName: '山人-oga-', taxable10: 0, nonTaxable: 0, cancelFee: 0, billedTotal: 0 }
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')).toEqual([
      '期間,取引先,施設,10%対象（税込）,入湯税,キャンセル料,ご請求額',
      '2026-10,○○トラベル,山人-yamado-,11006,150,0,11156',
      '2026-10,"A,""B""",山人-oga-,0,0,5000,5000',
      `2026-10,"'=HYPERLINK(""x"")",山人-oga-,0,0,0,0`,
      ''
    ]);
  });
});
