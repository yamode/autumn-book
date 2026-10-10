import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CREDIT_DEPOSIT,
  depositAmountOf,
  depositRemainderIdOf,
  depositRemainderModeOf,
  depositStateOf,
  firstNightLodgingOf,
  intentAmountOf,
  isDepositRemainderBilled,
  isStripePaymentOption,
  normalizeCreditDeposit,
  partnerPlanName,
  canBookFor,
  describeInvoiceDue,
  invoiceDueDate,
  normalizeInvoiceDue,
  chargeAmountOf,
  quoteChargeOf,
  applyPrepayDiscount,
  canPartnerCancel,
  DEFAULT_PARTNER_BOOKING_SETTINGS,
  describePrepayDiscount,
  normalizePrepayDiscount,
  normalizePartnerBookingSettings,
  resolveOptionAnswers,
  validatePartnerBookingSettings,
  describeBooker,
  describePerks,
  EMPTY_BOOKER,
  isCustomPaymentOption,
  normalizeBooker,
  partnerPaymentChoices,
  paymentOptionLabel,
  perksForPlan,
  resolveTransport,
  validateBooker,
  mergePartnerSettingsRaw,
  splitPartnerBookingSettings,
  partnerFacilityOverrides,
  PARTNER_FACILITY_SETTING_KEYS
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
      { id: 'a', label: '送迎', type: 'check', choices: [], required: false, scope: 'booking' as const },
      { id: 'c', label: '夕食時間', type: 'select', choices: ['18:00', '19:00'], required: true, scope: 'booking' as const }
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
    { id: 'pick', label: '送迎希望', type: 'check' as const, choices: [], required: false, scope: 'booking' as const },
    { id: 'time', label: '夕食時間', type: 'select' as const, choices: ['18:00', '19:00'], required: true, scope: 'booking' as const },
    { id: 'memo', label: '記念日', type: 'text' as const, choices: [], required: false, scope: 'booking' as const }
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
    expect(describePrepayDiscount({ type: 'yen', value: 1000 })).toBe('1名あたり1泊 1,000円引き');
    expect(describePrepayDiscount({ type: 'percent', value: 5 })).toBe('5%引き');
  });

  it('チェックアウト日決済も支払方法として残す', () => {
    expect(normalizePartnerBookingSettings({ paymentOptions: ['online_checkin', 'online'] }).paymentOptions).toEqual(['online', 'online_checkin']);
  });
});

describe('オンライン決済の金額', () => {
  const q = { total: 30000, bathTax: 600, prepay: { total: 28500 } };
  it('予約時決済は割引後の宿泊料金＋入湯税', () => {
    expect(quoteChargeOf(q, 'online')).toEqual({ lodging: 28500, bathTax: 600, charge: 29100, discounted: true });
  });
  it('チェックアウト日決済・後払いは割引しない', () => {
    expect(quoteChargeOf(q, 'online_checkin')).toEqual({ lodging: 30000, bathTax: 600, charge: 30600, discounted: false });
    expect(quoteChargeOf({ ...q, prepay: null }, 'online').charge).toBe(30600);
  });
  it('台帳の請求額（Intent の金額）は宿泊料金＋入湯税', () => {
    expect(chargeAmountOf({ total_amount: 28500, bath_tax_amount: 600 })).toBe(29100);
    expect(chargeAmountOf({ total_amount: 28500, bath_tax_amount: null })).toBe(28500);
  });
});

// ---- 2026-10-01: 自由入力の支払方法・取引先特典・予約者・交通手段 ----

describe('normalizePartnerBookingSettings（自由入力の支払方法）', () => {
  it('不正な id は custom_<n> に振り直し、重複は末尾に _ を足して分ける', () => {
    const s = normalizePartnerBookingSettings({
      customPaymentOptions: [
        { id: 'bad id', label: '現地精算' },
        { id: 'custom_x', label: '請求書A' },
        { id: 'custom_x', label: '請求書B' }
      ],
      paymentOptions: []
    });
    expect(s.customPaymentOptions.map((o) => o.id)).toEqual(['custom_1', 'custom_x', 'custom_x_']);
  });

  it('ラベル空は除外し、最大5つまで。名前・説明は文字数で切る', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ id: `custom_${i}`, label: i === 0 ? '  ' : `支払${i}`, note: 'x'.repeat(300) }));
    const s = normalizePartnerBookingSettings({ customPaymentOptions: many });
    expect(s.customPaymentOptions).toHaveLength(5);
    expect(s.customPaymentOptions[0]).toMatchObject({ id: 'custom_1', label: '支払1' });
    expect(s.customPaymentOptions[0].note).toHaveLength(200);
    const long = normalizePartnerBookingSettings({ customPaymentOptions: [{ id: 'custom_a', label: 'あ'.repeat(50) }] });
    expect(long.customPaymentOptions[0].label).toHaveLength(40);
  });

  it('定義に無い custom id は paymentOptions から落ち、並びは 固定 → 自由入力（定義順）', () => {
    const s = normalizePartnerBookingSettings({
      customPaymentOptions: [
        { id: 'custom_b', label: 'B' },
        { id: 'custom_a', label: 'A' }
      ],
      paymentOptions: ['custom_a', 'custom_gone', 'online', 'custom_b', 'invoice_monthly', 'unknown']
    });
    expect(s.paymentOptions).toEqual(['invoice_monthly', 'online', 'custom_b', 'custom_a']);
  });

  it('自由入力だけでも予約受付オンで保存できる', () => {
    const s = normalizePartnerBookingSettings({ customPaymentOptions: [{ id: 'custom_a', label: '現地精算' }], paymentOptions: ['custom_a'] });
    expect(validatePartnerBookingSettings(s, true)).toBeNull();
  });
});

describe('paymentOptionLabel / partnerPaymentChoices', () => {
  const s = normalizePartnerBookingSettings({ customPaymentOptions: [{ id: 'custom_a', label: '現地精算（法人カード）', note: '当日フロントで' }] });
  it('固定・自由入力の名前を引ける。不明な id はそのまま', () => {
    expect(paymentOptionLabel('invoice_monthly')).toBe('月末締め翌月末銀行振込');
    expect(paymentOptionLabel('custom_a', s)).toBe('現地精算（法人カード）');
    expect(paymentOptionLabel('custom_a')).toBe('custom_a');
    expect(paymentOptionLabel('custom_zz', s)).toBe('custom_zz');
  });
  it('選択肢は固定の3種 → 自由入力', () => {
    expect(partnerPaymentChoices(s).map((o) => o.id)).toEqual(['invoice_monthly', 'online', 'online_checkin', 'custom_a']);
    expect(isCustomPaymentOption('custom_a')).toBe(true);
    expect(isCustomPaymentOption('online')).toBe(false);
  });
});

describe('取引先特典', () => {
  it('タイトル空は除外・最大10件・対象プランは重複と空を除く', () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, title: i === 0 ? '' : `特典${i}`, planCodes: ['a001', 'a001', ' ', 'b002'] }));
    const s = normalizePartnerBookingSettings({ perks: raw });
    expect(s.perks).toHaveLength(10);
    expect(s.perks[0]).toEqual({ id: 'p1', title: '特典1', description: '', imageUrl: '', planCodes: ['a001', 'b002'] });
  });
  it('画像は https の URL だけ受ける', () => {
    const s = normalizePartnerBookingSettings({
      perks: [
        { title: 'A', imageUrl: ' https://example.supabase.co/storage/v1/object/public/book-photos/partners/x/1.jpg ' },
        { title: 'B', imageUrl: 'javascript:alert(1)' },
        { title: 'C', imageUrl: 'http://example.com/a.jpg' },
        { title: 'D' }
      ]
    });
    expect(s.perks.map((p) => p.imageUrl)).toEqual(['https://example.supabase.co/storage/v1/object/public/book-photos/partners/x/1.jpg', '', '', '']);
  });
  it('id が無ければ perk-<n>', () => {
    const s = normalizePartnerBookingSettings({ perks: [{ title: 'ドリンク' }] });
    expect(s.perks[0].id).toBe('perk-1');
  });
  it('perksForPlan: 対象プラン空は全プラン、絞ったものは一致するプランだけ', () => {
    const perks = [
      { id: '1', title: '全員', description: '', planCodes: [] },
      { id: '2', title: '会席', description: '', planCodes: ['a001'] }
    ];
    expect(perksForPlan(perks, 'a001').map((p) => p.id)).toEqual(['1', '2']);
    expect(perksForPlan(perks, 'b002').map((p) => p.id)).toEqual(['1']);
    expect(perksForPlan(perks, null).map((p) => p.id)).toEqual(['1']);
    expect(describePerks(perks)).toBe('全員／会席');
  });
});

describe('resolveTransport', () => {
  it('未選択は空、JR・車はそのまま', () => {
    expect(resolveTransport('', '')).toEqual({ ok: true, value: '' });
    expect(resolveTransport('jr', '無視')).toEqual({ ok: true, value: 'JR' });
    expect(resolveTransport('car', '')).toEqual({ ok: true, value: '車' });
  });
  it('その他は内容必須', () => {
    expect(resolveTransport('other', ' 路線バス ')).toEqual({ ok: true, value: 'その他（路線バス）' });
    expect(resolveTransport('other', '  ').ok).toBe(false);
    expect(resolveTransport('plane', '').ok).toBe(false);
  });
});

describe('予約者', () => {
  it('normalizeBooker は欠けを空にして文字数で切る', () => {
    expect(normalizeBooker(null)).toEqual(EMPTY_BOOKER);
    expect(normalizeBooker({ name: ' 山田 太郎 ', phone: '0'.repeat(30) }).phone).toHaveLength(20);
  });
  it('validateBooker: 氏名・メール必須、形式チェック', () => {
    const ok = { ...EMPTY_BOOKER, name: '山田', email: 'yamada@example.com' };
    expect(validateBooker(ok)).toBeNull();
    expect(validateBooker({ ...ok, name: '' })).toContain('お名前');
    expect(validateBooker({ ...ok, email: '' })).toContain('メールアドレス');
    expect(validateBooker({ ...ok, email: 'bad' })).toContain('形式');
    expect(validateBooker({ ...ok, phone: 'abc' })).toContain('電話番号');
    expect(validateBooker({ ...ok, phone: '03-1234-5678' })).toBeNull();
  });
  it('describeBooker は部署を括弧で添え、空の項目は出さない', () => {
    expect(describeBooker({ name: '山田 太郎', kana: '', department: '総務部', phone: '03-1234-5678', email: 'y@example.com' })).toBe(
      '山田 太郎（総務部） / 03-1234-5678 / y@example.com'
    );
    expect(describeBooker({ ...EMPTY_BOOKER, name: '山田', email: 'y@example.com' })).toBe('山田 / y@example.com');
  });
});

describe('ご請求書のお支払期限（2026-10-02）', () => {
  it('invoiceDueDate: 翌月末', () => {
    expect(invoiceDueDate('2026-10-01', { type: 'next_month_end' })).toBe('2026-11-30');
    expect(invoiceDueDate('2027-01-01', { type: 'next_month_end' })).toBe('2027-02-28');
    expect(invoiceDueDate('2027-12-01', { type: 'next_month_end' })).toBe('2028-01-31');
  });
  it('invoiceDueDate: 翌月25日（2月・12月→翌年1月も）', () => {
    const due = { type: 'next_month_day', day: 25 } as const;
    expect(invoiceDueDate('2026-10-01', due)).toBe('2026-11-25');
    expect(invoiceDueDate('2027-01-01', due)).toBe('2027-02-25');
    expect(invoiceDueDate('2026-12-01', due)).toBe('2027-01-25');
    expect(invoiceDueDate('2026-12-01', { type: 'next_month_day', day: 5 })).toBe('2027-01-05');
  });
  it('normalizeInvoiceDue: 範囲外・不正は翌月末', () => {
    expect(normalizeInvoiceDue({ type: 'next_month_day', day: 25 })).toEqual({ type: 'next_month_day', day: 25 });
    expect(normalizeInvoiceDue({ type: 'next_month_day', day: 0 })).toEqual({ type: 'next_month_end' });
    expect(normalizeInvoiceDue({ type: 'next_month_day', day: 29 })).toEqual({ type: 'next_month_end' });
    expect(normalizeInvoiceDue({ type: 'next_month_day', day: 'x' })).toEqual({ type: 'next_month_end' });
    expect(normalizeInvoiceDue({ type: 'weird' })).toEqual({ type: 'next_month_end' });
    expect(normalizeInvoiceDue(null)).toEqual({ type: 'next_month_end' });
  });
  it('describeInvoiceDue', () => {
    expect(describeInvoiceDue({ type: 'next_month_end' })).toBe('翌月末');
    expect(describeInvoiceDue({ type: 'next_month_day', day: 25 })).toBe('翌月25日');
  });
  it('normalizePartnerBookingSettings: 既定は宛名空・翌月末', () => {
    const s = normalizePartnerBookingSettings({});
    expect(s.invoiceRecipientName).toBe('');
    expect(s.invoiceDue).toEqual({ type: 'next_month_end' });
  });
});

describe('取引先向けのプラン名', () => {
  it('付けた名前があればそれ、無ければ既定の表示名', () => {
    const names = { a003: '再春館様専用 会席プラン' };
    expect(partnerPlanName(names, 'a003', '基本■2食■スタンダード(+20350円)')).toBe('再春館様専用 会席プラン');
    expect(partnerPlanName(names, 'a004', '基本■2食■フルコース(+25850円)')).toBe('フルコース');
    expect(partnerPlanName(undefined, null, '基本■素泊■素泊(±0円)')).toBe('素泊');
  });
  it('正規化: 空・不正なコードは落とし、空白をまとめて60文字まで', () => {
    const s = normalizePartnerBookingSettings({ planNames: { a003: '  会席　 プラン ', a004: '   ', 'x y': 'NG', a005: 'あ'.repeat(80) } });
    expect(s.planNames).toEqual({ a003: '会席 プラン', a005: 'あ'.repeat(60) });
    expect(normalizePartnerBookingSettings({}).planNames).toEqual({});
  });
});

describe('デポジット（Phase 3b・受付枠を超えた予約）', () => {
  const rooms2 = [
    { adults: 2, nights: [{ date: '2027-02-10', unit_price: 20000 }, { date: '2027-02-11', unit_price: 15000 }] },
    { adults: 1, nights: [{ date: '2027-02-10', unit_price: 25000 }, { date: '2027-02-11', unit_price: 20000 }] }
  ];

  it('定率 30%（既定）: 宿泊料金 100,000・入湯税 1,500 → 30,450／残額 71,050', () => {
    const amount = depositAmountOf(DEFAULT_CREDIT_DEPOSIT, { lodging: 100000, bathTax: 1500, rooms: 1, nights: 1, firstNight: 100000 });
    expect(amount).toBe(30450);
    expect(100000 + 1500 - amount).toBe(71050);
  });
  it('定率は円未満切り捨て', () => {
    expect(depositAmountOf({ type: 'percent', value: 33 }, { lodging: 10001, bathTax: 0, rooms: 1, nights: 1, firstNight: 0 })).toBe(3300);
  });
  it('1室あたりの額 × 室数（請求額を超えない）', () => {
    expect(depositAmountOf({ type: 'yen_per_room', value: 10000 }, { lodging: 100000, bathTax: 1500, rooms: 3, nights: 1, firstNight: 0 })).toBe(30000);
    expect(depositAmountOf({ type: 'yen_per_room', value: 50000 }, { lodging: 60000, bathTax: 900, rooms: 2, nights: 1, firstNight: 0 })).toBe(60900);
  });
  it('1泊分: 1泊目の宿泊料金（全部屋）＋入湯税の1泊ぶん', () => {
    const first = firstNightLodgingOf(rooms2, '2027-02-10');
    expect(first).toBe(20000 * 2 + 25000 * 1);
    // 入湯税 150円 × 3名 × 2泊 = 900 → 1泊ぶん 450
    expect(depositAmountOf({ type: 'first_night', value: 0 }, { lodging: 135000, bathTax: 900, rooms: 2, nights: 2, firstNight: first })).toBe(65450);
  });
  it('設定の正規化（読めない値は定率 30%）', () => {
    expect(normalizeCreditDeposit(undefined)).toEqual({ type: 'percent', value: 30 });
    expect(normalizeCreditDeposit({ type: 'percent', value: 0 })).toEqual({ type: 'percent', value: 30 });
    expect(normalizeCreditDeposit({ type: 'percent', value: 150 })).toEqual({ type: 'percent', value: 100 });
    expect(normalizeCreditDeposit({ type: 'yen_per_room', value: -1 })).toEqual({ type: 'percent', value: 30 });
    expect(normalizeCreditDeposit({ type: 'yen_per_room', value: '10000' })).toEqual({ type: 'yen_per_room', value: 10000 });
    expect(normalizeCreditDeposit({ type: 'first_night', value: 5 })).toEqual({ type: 'first_night', value: 0 });
    expect(normalizeCreditDeposit({ value: 50 })).toEqual({ type: 'percent', value: 30 });
    expect(normalizePartnerBookingSettings({}).creditDeposit).toEqual({ type: 'percent', value: 30 });
    expect(normalizePartnerBookingSettings({}).creditDepositRemainder).toBeNull();
  });
  it('残額の精算先: 既定は請求書払いの支払方法があれば請求書、無ければ現地', () => {
    const invoice = normalizePartnerBookingSettings({ paymentOptions: ['invoice_monthly', 'online'] });
    expect(depositRemainderModeOf(invoice)).toBe('invoice');
    expect(depositRemainderIdOf(invoice)).toBe('invoice_monthly');
    const custom = normalizePartnerBookingSettings({
      paymentOptions: ['custom_1', 'custom_2'],
      customPaymentOptions: [
        { id: 'custom_1', label: '現地精算', note: '', billable: false },
        { id: 'custom_2', label: '請求書で精算する', note: '', billable: true }
      ]
    });
    expect(depositRemainderIdOf(custom)).toBe('custom_2');
    const onsite = normalizePartnerBookingSettings({ paymentOptions: ['online_checkin'] });
    expect(depositRemainderModeOf(onsite)).toBe('onsite');
    expect(depositRemainderIdOf(onsite)).toBe('onsite');
    // 明示した設定が優先。請求書を選んだのに請求書払いの支払方法が無ければ invoice_monthly
    expect(depositRemainderIdOf({ ...onsite, creditDepositRemainder: 'invoice' })).toBe('invoice_monthly');
    expect(depositRemainderIdOf({ ...invoice, creditDepositRemainder: 'onsite' })).toBe('onsite');
    expect(isDepositRemainderBilled('invoice_monthly')).toBe(true);
    expect(isDepositRemainderBilled('custom_2')).toBe(true);
    expect(isDepositRemainderBilled('onsite')).toBe(false);
    expect(isDepositRemainderBilled(null)).toBe(false);
  });
  it('支払方法 deposit_online: Stripe・表示名・Intent の額', () => {
    expect(isStripePaymentOption('deposit_online')).toBe(true);
    expect(paymentOptionLabel('deposit_online')).toBe('デポジット（予約時にオンライン決済・残額は後日）');
    // 取引先の設定の支払方法には出さない
    expect(normalizePartnerBookingSettings({ paymentOptions: ['deposit_online', 'online'] }).paymentOptions).toEqual(['online']);
    const b = { total_amount: 100000, bath_tax_amount: 1500, prepay_discount_amount: 0, payment_option: 'deposit_online', deposit_amount: 30450, paid_amount: null };
    expect(intentAmountOf(b)).toBe(30450);
    expect(depositStateOf(b)).toEqual({ deposit: 30450, remainder: 71050 });
    expect(intentAmountOf({ ...b, payment_option: 'online' })).toBe(101500);
    expect(depositStateOf({ ...b, payment_option: 'online' })).toBeNull();
  });
});

// 複数施設化（docs/partner-multi-facility.md §4.2・決定 N6・2026-10-09）: 共通 ‖ 施設 の合成と保存時の振り分け
describe('normalizePartnerBookingSettings（共通＋施設の合成・N6）', () => {
  const common = {
    leadDays: 3,
    cutoffHour: 17,
    maxRooms: 4,
    maxNights: 5,
    cancelDays: 2,
    prepayDiscount: { type: 'percent', value: 5 },
    notice: '共通の案内',
    paymentOptions: ['invoice_monthly', 'online']
  };

  it('1引数の呼び出しは従来どおり', () => {
    expect(normalizePartnerBookingSettings(common)).toEqual(normalizePartnerBookingSettings(common, undefined));
    expect(normalizePartnerBookingSettings(common).leadDays).toBe(3);
  });

  it('施設にキーが無ければ共通の値', () => {
    const s = normalizePartnerBookingSettings(common, {});
    expect(s.leadDays).toBe(3);
    expect(s.cancelDays).toBe(2);
    expect(s.prepayDiscount).toEqual({ type: 'percent', value: 5 });
    expect(s.notice).toBe('共通の案内');
    expect(normalizePartnerBookingSettings(common, null).leadDays).toBe(3);
  });

  it('0・空文字・空配列・false も「値あり」として上書きする', () => {
    const s = normalizePartnerBookingSettings(
      { ...common, showOfficialPerks: true, notifyEmails: ['a@example.com'] },
      { leadDays: 0, cancelDays: 0, notice: '', notifyEmails: [], showOfficialPerks: false }
    );
    expect(s.leadDays).toBe(0);
    expect(s.cancelDays).toBe(0);
    expect(s.notice).toBe('');
    expect(s.notifyEmails).toEqual([]);
    expect(s.showOfficialPerks).toBe(false);
  });

  it('null も上書き（cancelDays: null = 画面から取り消せない）', () => {
    expect(normalizePartnerBookingSettings(common, { cancelDays: null }).cancelDays).toBeNull();
  });

  it('undefined の値は「キーが無い」と同じ（JSON に残らないため）', () => {
    const s = normalizePartnerBookingSettings(common, { leadDays: undefined, notice: undefined });
    expect(s.leadDays).toBe(3);
    expect(s.notice).toBe('共通の案内');
  });

  it('prepayDiscount はオブジェクトごと上書き（type と value を別々に継承しない）', () => {
    expect(normalizePartnerBookingSettings(common, { prepayDiscount: { type: 'none' } }).prepayDiscount).toEqual({ type: 'none', value: 0 });
    expect(normalizePartnerBookingSettings(common, { prepayDiscount: { type: 'yen', value: 1000 } }).prepayDiscount).toEqual(
      normalizePrepayDiscount({ type: 'yen', value: 1000 })
    );
  });

  it('共通だけのキー（支払方法）は施設にあっても SQL と同じく上書きされる（キーの有無だけで判定）', () => {
    expect(normalizePartnerBookingSettings(common, { paymentOptions: ['online'] }).paymentOptions).toEqual(['online']);
  });

  it('mergePartnerSettingsRaw は SQL の common || facility と同じ（トップレベルのキーで上書き）', () => {
    expect(mergePartnerSettingsRaw({ a: 1, b: { x: 1 } }, { b: { y: 2 }, c: 0 })).toEqual({ a: 1, b: { y: 2 }, c: 0 });
    expect(mergePartnerSettingsRaw(null, null)).toEqual({});
  });
});

describe('splitPartnerBookingSettings（保存時の振り分け）', () => {
  const s = normalizePartnerBookingSettings({
    planNames: { a001: '取引先向け' },
    notice: '案内',
    notifyEmails: ['a@example.com'],
    leadDays: 2,
    prepayDiscount: { type: 'percent', value: 5 }
  });

  it('施設ごとのキーは施設へ、それ以外（N6 の上書きキーを含む）は共通へ', () => {
    const { common, facility } = splitPartnerBookingSettings(s);
    expect(Object.keys(facility).sort()).toEqual([...PARTNER_FACILITY_SETTING_KEYS].sort());
    expect(facility.planNames).toEqual({ a001: '取引先向け' });
    expect(common.leadDays).toBe(2);
    expect(common.prepayDiscount).toEqual({ type: 'percent', value: 5 });
    expect(common.paymentOptions).toEqual(['invoice_monthly']);
    for (const k of PARTNER_FACILITY_SETTING_KEYS) expect(k in common).toBe(false);
  });

  it('施設で上書き中の N6 キーは施設へ戻す', () => {
    const { common, facility } = splitPartnerBookingSettings(s, ['leadDays', 'prepayDiscount']);
    expect(facility.leadDays).toBe(2);
    expect(facility.prepayDiscount).toEqual({ type: 'percent', value: 5 });
    expect('leadDays' in common).toBe(false);
    expect(common.cutoffHour).toBe(18);
  });

  it('分けて合成し直すと元に戻る', () => {
    const { common, facility } = splitPartnerBookingSettings(s, ['cancelDays']);
    expect(normalizePartnerBookingSettings(common, facility)).toEqual(s);
  });

  it('partnerFacilityOverrides はキーの有無で判定する（0・null も上書き）', () => {
    expect(partnerFacilityOverrides({ leadDays: 0, cancelDays: null, notice: 'x', maxRooms: undefined })).toEqual(['leadDays', 'cancelDays']);
    expect(partnerFacilityOverrides(null)).toEqual([]);
  });
});
