import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTNER_BOOKING_SETTINGS, normalizePartnerBookingSettings, type PartnerBookingSettings } from './partner-booking';
import {
  canAccept,
  canAnswer,
  canReject,
  canWithdrawBy,
  defaultAnswerExpiry,
  describeRoomAdults,
  groupInquiryAvailable,
  groupInquiryBlockReason,
  groupNightDates,
  groupPriceLimitError,
  groupPaymentChoices,
  groupQuoteStatusOf,
  groupRoomsTotal,
  groupSettingsOf,
  groupStatusTab,
  isAnswerExpired,
  isRealIsoDate,
  isValidPriceRooms,
  normalizeGroupDraftItem,
  overrideUnitPrices,
  resolveGroupChoice,
  splitAdultsEvenly,
  spreadTotalOverRooms,
  suggestRoomCount,
  validateGroupDraft,
  type GroupDraftItem
} from './partner-group';

const settings = (patch: Partial<PartnerBookingSettings> = {}): PartnerBookingSettings => ({
  ...normalizePartnerBookingSettings({}),
  groupInquiryEnabled: true,
  paymentOptions: ['invoice_monthly', 'online', 'custom_ring'],
  customPaymentOptions: [{ id: 'custom_ring', label: 'ペイメントリング', note: '', billable: false }],
  ...patch
});

describe('団体予約の設定の既定', () => {
  it('既定はオフ（取引先ごとに管理画面でオンにする）', () => {
    expect(DEFAULT_PARTNER_BOOKING_SETTINGS.groupInquiryEnabled).toBe(false);
    expect(normalizePartnerBookingSettings({}).groupInquiryEnabled).toBe(false);
    expect(normalizePartnerBookingSettings({ groupInquiryEnabled: true }).groupInquiryEnabled).toBe(true);
  });
  it('上限・選択肢を正規化する', () => {
    const s = normalizePartnerBookingSettings({ groupMaxRooms: 500, groupTransportChoices: [' 大型バス ', '', '大型バス', 'JR'], groupDinnerTimeChoices: 'x' });
    expect(s.groupMaxRooms).toBe(100);
    expect(s.groupTransportChoices).toEqual(['大型バス', 'JR']);
    expect(s.groupDinnerTimeChoices).toEqual(DEFAULT_PARTNER_BOOKING_SETTINGS.groupDinnerTimeChoices);
    expect(s.groupMaxNights).toBe(7);
    expect(s.groupAnswerDays).toBe(7);
  });
});

describe('groupInquiryAvailable / groupInquiryBlockReason', () => {
  it('旅行会社でオンのときだけ（許可リスト）', () => {
    expect(groupInquiryAvailable({ kind: 'agent', booking_settings: settings() })).toBe(true);
    expect(groupInquiryAvailable({ kind: 'agent', booking_settings: settings({ groupInquiryEnabled: false }) })).toBe(false);
    for (const kind of ['corporate', 'other', 'member', 'ambassador']) expect(groupInquiryAvailable({ kind, booking_settings: settings() })).toBe(false);
  });
  it('支払方法は後払いと自由入力だけ（Stripe 系を除く）', () => {
    expect(groupPaymentChoices(settings()).map((o) => o.id)).toEqual(['invoice_monthly', 'custom_ring']);
    expect(groupPaymentChoices(settings()).find((o) => o.id === 'custom_ring')?.label).toBe('ペイメントリング');
    expect(groupInquiryBlockReason({ booking_settings: settings({ paymentOptions: ['online'] }) })).toMatch(/支払方法/);
    expect(groupInquiryBlockReason({ booking_settings: settings(), booking_enabled: false })).toMatch(/受け付けていません/);
    expect(groupInquiryBlockReason({ booking_settings: settings(), booking_enabled: true, facility_available: true })).toBeNull();
  });
});

describe('人数・室数', () => {
  it('均等割（先頭から +1）', () => {
    expect(splitAdultsEvenly(10, 5)).toEqual([2, 2, 2, 2, 2]);
    expect(splitAdultsEvenly(11, 5)).toEqual([3, 2, 2, 2, 2]);
    expect(splitAdultsEvenly(5, 0)).toEqual([]);
  });
  it('室数の目安', () => {
    expect(suggestRoomCount(10, 4)).toBe(3);
    expect(suggestRoomCount(10, 2)).toBe(5);
    expect(suggestRoomCount(0, 2)).toBe(1);
  });
  it('人数の表示', () => {
    expect(describeRoomAdults([{ adults: 3 }, { adults: 2 }, { adults: 2 }])).toBe('3名×1室・2名×2室');
  });
});

describe('resolveGroupChoice', () => {
  it('選択肢・その他・未選択', () => {
    expect(resolveGroupChoice({ choice: '中型バス1台', other: '' }, ['中型バス1台'], '交通機関')).toEqual({ ok: true, value: '中型バス1台' });
    expect(resolveGroupChoice({ choice: 'other', other: '観光バス2台' }, [], '交通機関')).toEqual({ ok: true, value: 'その他（観光バス2台）' });
    expect(resolveGroupChoice({ choice: '', other: '' }, [], '交通機関')).toEqual({ ok: true, value: '' });
    expect(resolveGroupChoice({ choice: 'other', other: ' ' }, [], '交通機関').ok).toBe(false);
    expect(resolveGroupChoice({ choice: 'ヘリ', other: '' }, ['JR'], '交通機関').ok).toBe(false);
  });
});

describe('validateGroupDraft', () => {
  const now = new Date('2026-04-01T00:00:00Z');
  const item = (patch: Partial<GroupDraftItem> = {}): GroupDraftItem =>
    normalizeGroupDraftItem({
      facilityId: 'f1',
      groupName: '270413精華旅行社',
      roomCode: 'JS',
      planCode: 'a001',
      planName: '一泊二食',
      checkIn: '2026-04-15',
      nights: 1,
      adults: 10,
      rooms: splitAdultsEvenly(10, 5).map((adults) => ({ adults })),
      paymentOption: 'custom_ring',
      transport: { choice: '中型バス1台', other: '' },
      dinnerTime: { choice: '18:30', other: '' },
      note: '',
      booker: { name: '山田', kana: '', department: '', phone: '03-1234-5678', email: 'yamada@example.com' },
      ...patch
    });
  const s = groupSettingsOf(settings());
  const ctx = { bounds: { earliest: '2026-04-01', latest: '2026-12-31' }, now, capacityOf: () => 4, paymentIds: ['invoice_monthly', 'custom_ring'] };
  it('正しい束は通る・同じ日程は警告だけ', () => {
    const r = validateGroupDraft([item(), item({ checkIn: '2026-04-17' }), item()], s, ctx);
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([{ index: 2, message: '1件目と同じ日程・部屋タイプ・プランです。' }]);
  });
  it('人数の合計・定員・支払方法・締切・予約者の電話', () => {
    const bad = validateGroupDraft(
      [
        item({ adults: 11 }),
        item({ rooms: [{ adults: 5 }, { adults: 5 }], adults: 10 }),
        item({ paymentOption: 'online' }),
        item({ checkIn: '2026-04-02' }),
        item({ booker: { name: '山田', kana: '', department: '', phone: '', email: 'yamada@example.com' } })
      ],
      s,
      ctx
    );
    expect(bad.ok).toBe(false);
    const byIndex = (i: number) => bad.errors.filter((e) => e.index === i).map((e) => e.message).join(' ');
    expect(byIndex(0)).toMatch(/合計/);
    expect(byIndex(1)).toMatch(/定員/);
    expect(byIndex(2)).toMatch(/お支払方法/);
    expect(byIndex(3)).toMatch(/締め切りました/);
    expect(byIndex(4)).toMatch(/電話番号/);
  });
  it('束の件数の上限・室数の上限・公開範囲', () => {
    const r = validateGroupDraft(Array.from({ length: 21 }, () => item()), s, ctx);
    expect(r.errors.some((e) => e.index === -1)).toBe(true);
    const many = validateGroupDraft([item({ adults: 31, rooms: Array.from({ length: 31 }, () => ({ adults: 1 })) })], s, ctx);
    expect(many.errors[0].message).toMatch(/室数/);
    const far = validateGroupDraft([item({ checkIn: '2026-12-31', nights: 2 })], s, ctx);
    expect(far.errors[0].message).toMatch(/期間/);
  });
  it('実在しない日付・DB の上限（大人 600 名・100 室・30 泊）', () => {
    const badDate = validateGroupDraft([item({ checkIn: '2026-02-30' })], s, ctx);
    expect(badDate.errors.map((e) => e.message).join(' ')).toMatch(/チェックイン日が正しくありません/);
    const wide = groupSettingsOf(settings({ groupMaxRooms: 100, groupMaxNights: 30 }));
    const many = validateGroupDraft([item({ adults: 601, rooms: Array.from({ length: 100 }, (_, i) => ({ adults: i === 0 ? 7 : 6 })) })], wide, { ...ctx, capacityOf: () => 7 });
    expect(many.errors.map((e) => e.message).join(' ')).toMatch(/600 名以内/);
    const rooms101 = validateGroupDraft([{ ...item({ adults: 101 }), rooms: Array.from({ length: 101 }, () => ({ adults: 1 })) }], { ...wide, groupMaxRooms: 500 }, ctx);
    expect(rooms101.errors.map((e) => e.message).join(' ')).toMatch(/1〜100 室/);
    const nights31 = validateGroupDraft([item({ nights: 31 })], { ...wide, groupMaxNights: 60 }, ctx);
    expect(nights31.errors.map((e) => e.message).join(' ')).toMatch(/1〜30 泊/);
  });
});

describe('状態', () => {
  const now = new Date('2026-04-05T00:00:00Z');
  it('承諾・辞退・取り下げ・回答の可否', () => {
    const offered = { status: 'offered' as const, answer: 'ok' as const, answer_expires_at: '2026-04-10T00:00:00Z', booking_id: null, account_id: 'a1' };
    expect(canAccept(offered, now)).toBe(true);
    expect(canAccept({ ...offered, answer_expires_at: '2026-04-01T00:00:00Z' }, now)).toBe(false);
    expect(isAnswerExpired({ ...offered, answer_expires_at: '2026-04-01T00:00:00Z' }, now)).toBe(true);
    expect(canAccept({ ...offered, booking_id: 'b' }, now)).toBe(false);
    expect(canReject(offered)).toBe(true);
    expect(canWithdrawBy(offered, { id: 'a1' })).toBe(true);
    expect(canWithdrawBy(offered, { id: 'a2' })).toBe(false);
    expect(canWithdrawBy(offered, { id: 'a2', is_master: true })).toBe(true);
    expect(canAnswer({ status: 'accepted' })).toBe(false);
    expect(groupStatusTab('expired')).toBe('closed');
    expect(groupStatusTab('offered')).toBe('answered');
  });
  it('見積の文言から quote_status', () => {
    expect(groupQuoteStatusOf('2026-04-15 は休館日のため、ご予約いただけません。')).toBe('closed');
    expect(groupQuoteStatusOf('2026-04-15 は 7名1室 の料金がありません。人数を変えてお試しください。')).toBe('no_rate');
    expect(groupQuoteStatusOf('なにか')).toBe('error');
  });
});

describe('回答の料金', () => {
  const dates = groupNightDates('2026-04-15', 2);
  const rooms = [{ adults: 3 }, { adults: 2 }];
  it('1名単価の上書き（無い段は自動計算の単価）', () => {
    const base = [
      { adults: 3, nights: dates.map((date) => ({ date, unit_price: 20000 })) },
      { adults: 2, nights: dates.map((date) => ({ date, unit_price: 22000 })) }
    ];
    const r = overrideUnitPrices(rooms, dates, { '2': 21000 }, base)!;
    expect(r[0].nights[0].unit_price).toBe(20000);
    expect(r[1].nights[1].unit_price).toBe(21000);
    expect(groupRoomsTotal(r)).toBe(20000 * 3 * 2 + 21000 * 2 * 2);
    expect(overrideUnitPrices(rooms, dates, { '2': 21000 }, null)).toBeNull();
    expect(isValidPriceRooms(r, rooms, dates)).toBe(true);
  });
  it('合計の均等割（端数は最初の部屋の最初の泊・PMS の明細と合計が一致）', () => {
    const r = spreadTotalOverRooms(rooms, dates, 100_003)!;
    // 人泊 10 → 10,000 円 ＋ 端数 3 円は最初の部屋（3名）の最初の泊に 1 円
    expect(r.rooms[0].nights[0].unit_price).toBe(10_001);
    expect(r.total).toBe(groupRoomsTotal(r.rooms));
    expect(r.total).toBe(100_003);
    expect(spreadTotalOverRooms(rooms, dates, 5)).toBeNull();
  });
  it('料金の上限（1名1泊 1,000,000 円以下・合計 2,000,000,000 円未満）', () => {
    const at = (unit: number) => rooms.map((r) => ({ adults: r.adults, nights: dates.map((date) => ({ date, unit_price: unit })) }));
    expect(groupPriceLimitError(at(1_000_000))).toBeNull();
    expect(groupPriceLimitError(at(1_000_001))).toMatch(/1,000,000 円以下/);
    const big = Array.from({ length: 100 }, () => ({ adults: 6, nights: groupNightDates('2026-04-15', 30).map((date) => ({ date, unit_price: 1_000_000 })) }));
    expect(groupPriceLimitError(big)).toMatch(/2,000,000,000 円未満/);
    expect(groupPriceLimitError(null)).toBeNull();
  });
  it('実在する日付か', () => {
    expect(isRealIsoDate('2026-04-15')).toBe(true);
    expect(isRealIsoDate('2028-02-29')).toBe(true);
    expect(isRealIsoDate('2026-02-29')).toBe(false);
    expect(isRealIsoDate('2026-13-01')).toBe(false);
    expect(isRealIsoDate('2026-4-1')).toBe(false);
    expect(isRealIsoDate(null)).toBe(false);
  });
  it('回答の有効期限の既定はチェックイン日の前日を超えない', () => {
    const now = new Date('2026-04-10T00:00:00Z');
    expect(defaultAnswerExpiry(now, 7, '2026-05-01').toISOString()).toBe('2026-04-17T14:59:59.000Z');
    expect(defaultAnswerExpiry(now, 7, '2026-04-13').toISOString()).toBe('2026-04-12T14:59:59.000Z');
  });
});
