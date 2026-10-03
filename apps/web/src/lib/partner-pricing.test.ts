// 取引先向け特別レートの計算（純関数）のテスト。
import { describe, it, expect } from 'vitest';
import {
  buildPartnerDays,
  clampPartnerPrice,
  partnerPriceRange,
  mergePriceExtreme,
  decidePartnerPrice,
  isRetiredPlanName,
  DEFAULT_PARTNER_PRICING,
  normalizePartnerPricing,
  validatePartnerPricing,
  type PartnerPricing,
  type PartnerRateRule,
  type PartnerRateDay,
  type PartnerSourceDay
} from './partner-pricing';

const rule = (r: Partial<PartnerRateRule>): PartnerRateRule => ({
  id: 'r',
  label: '',
  roomCodes: [],
  planGroupCodes: ['a001'],
  mealTypes: [],
  guestCounts: [],
  weekdays: [],
  dateFrom: null,
  dateTo: null,
  action: 'adjust',
  adjustType: 'percent',
  value: 0,
  ...r
});
const pricing = (p: Partial<PartnerPricing>): PartnerPricing => ({ ...DEFAULT_PARTNER_PRICING, ...p });
const target = { date: '2026-10-07', roomCode: '101', planGroupCode: 'a001', mealType: '2食', guestCount: 2 };

describe('decidePartnerPrice', () => {
  it('％引きを当てて100円単位で切り捨てる', () => {
    const d = decidePartnerPrice(pricing({ rules: [rule({ id: 'p', value: -10 })] }), target, 23_650);
    expect(d).toEqual({ hidden: false, price: 21_200, ruleId: 'p' }); // 21,285 → 21,200
  });

  it('浮動小数の誤差で端数処理がずれない', () => {
    // 9,900 × 0.9 = 8,910.000000000002 → 10円単位の切り上げでも 8,910 のまま
    const d = decidePartnerPrice(pricing({ rules: [rule({ id: 'p', value: -10 })], roundingUnit: 10, roundingMode: 'ceil' }), target, 9_900);
    expect(d).toEqual({ hidden: false, price: 8_910, ruleId: 'p' });
  });

  it('上から最初に当てはまったルールで決まる', () => {
    const p = pricing({
      rules: [
        rule({ id: 'a', roomCodes: ['999'], adjustType: 'amount', value: -5000 }),
        rule({ id: 'b', planGroupCodes: ['a001'], adjustType: 'amount', value: -1000 }),
        rule({ id: 'c', adjustType: 'fixed', value: 1 })
      ]
    });
    expect(decidePartnerPrice(p, target, 20_000)).toEqual({ hidden: false, price: 19_000, ruleId: 'b' });
  });

  it('非表示ルール・どのルールにも当たらなければ出さない', () => {
    expect(decidePartnerPrice(pricing({ rules: [rule({ id: 'h', action: 'hide', mealTypes: ['2食'] })] }), target, 20_000)).toEqual({
      hidden: true,
      ruleId: 'h'
    });
    expect(decidePartnerPrice(pricing({}), target, 20_000)).toEqual({ hidden: true, ruleId: undefined });
    expect(decidePartnerPrice(pricing({ rules: [rule({ planGroupCodes: ['a002'] })] }), target, 20_000)).toEqual({ hidden: true, ruleId: undefined });
  });

  it('固定単価と下限単価', () => {
    const p = pricing({ minPricePerPerson: 15_000, rules: [rule({ id: 'f', guestCounts: [2], adjustType: 'fixed', value: 12_345 })] });
    expect(decidePartnerPrice(p, target, 30_000)).toEqual({ hidden: false, price: 15_000, ruleId: 'f' });
    expect(decidePartnerPrice(p, { ...target, guestCount: 3 }, 30_000)).toEqual({ hidden: true, ruleId: undefined });
  });

  it('期間・曜日・祝日で絞り込む', () => {
    const p = pricing({
      rules: [
        rule({ id: 'sat', weekdays: [6], adjustType: 'amount', value: 2000 }),
        rule({ id: 'hol', weekdays: [7], adjustType: 'amount', value: 3000 }),
        rule({ id: 'period', dateFrom: '2026-12-29', dateTo: '2027-01-03', action: 'hide' }),
        rule({ id: 'all' })
      ]
    });
    expect(decidePartnerPrice(p, { ...target, date: '2026-10-10' }, 20_000)).toMatchObject({ price: 22_000, ruleId: 'sat' }); // 土
    expect(decidePartnerPrice(p, { ...target, date: '2026-11-03' }, 20_000)).toMatchObject({ price: 23_000, ruleId: 'hol' }); // 文化の日（火）
    expect(decidePartnerPrice(p, { ...target, date: '2026-10-07' }, 20_000)).toMatchObject({ price: 20_000 }); // 水
    expect(decidePartnerPrice(p, { ...target, date: '2026-12-31' }, 20_000)).toMatchObject({ hidden: true, ruleId: 'period' });
  });

  it('先行案内料金は "advance" でまとめて指定できる', () => {
    const p = pricing({ rules: [rule({ id: 'adv', planGroupCodes: ['advance'], action: 'hide' }), rule({ id: 'all' })] });
    expect(decidePartnerPrice(p, { ...target, planGroupCode: 'advance:xyz' }, 20_000)).toMatchObject({ hidden: true });
    expect(decidePartnerPrice(p, target, 20_000)).toMatchObject({ hidden: false });
  });
});

describe('normalizePartnerPricing / validatePartnerPricing', () => {
  it('不正値・欠けを補う', () => {
    const p = normalizePartnerPricing({
      defaultAction: 'adjust',
      defaultValue: '-5',
      roundingUnit: 7,
      rules: [{ roomCodes: ['101', '101', ''], guestCounts: [2, 'x', 0], weekdays: [9, 1], dateFrom: 'bad', adjustType: 'zzz' }]
    });
    expect(p.defaultAction).toBe('hide'); // 旧データの「既定で出す」は読込時に「出さない」へ寄せる
    expect(p.roundingUnit).toBe(100);
    expect(p.rules[0]).toMatchObject({ id: 'rule-1', roomCodes: ['101'], guestCounts: [2], weekdays: [1], dateFrom: null, adjustType: 'percent', action: 'adjust' });
    expect(normalizePartnerPricing(null)).toEqual(DEFAULT_PARTNER_PRICING);
  });

  it('明らかな入力ミスを弾く', () => {
    expect(validatePartnerPricing(pricing({ rules: [rule({ value: -100 })] }))).toMatch(/％/);
    expect(validatePartnerPricing(pricing({ rules: [rule({ planGroupCodes: [] })] }))).toMatch(/プランを選んで/);
    expect(validatePartnerPricing(pricing({ rules: [rule({ planGroupCodes: [], action: 'hide' })] }))).toBeNull();
    expect(validatePartnerPricing(pricing({ rules: [rule({ adjustType: 'fixed', value: 0 })] }))).toMatch(/固定単価/);
    expect(validatePartnerPricing(pricing({ rules: [rule({ dateFrom: '2026-10-10', dateTo: '2026-10-01' })] }))).toMatch(/開始日/);
    expect(validatePartnerPricing(pricing({ rules: [rule({ value: -15 })] }))).toBeNull();
  });
});

describe('buildPartnerDays', () => {
  const rooms = [
    { roomCode: '101', name: '和室' },
    { roomCode: '201', name: '洋室' }
  ];
  const days: PartnerSourceDay[] = [
    {
      date: '2026-10-07',
      options: [
        { planGroupCode: 'a001', planLabel: '素泊まり', roomCode: '201', mealType: '素泊', salesStatus: '1', pricesByGuest: { 1: 20_000, 2: 12_000 } },
        { planGroupCode: 'a002', planLabel: '2食付', roomCode: '101', mealType: '2食', salesStatus: '1', pricesByGuest: { 2: 25_000 } },
        { planGroupCode: 'a003', planLabel: '売止プラン', roomCode: '101', mealType: '2食', salesStatus: '2', pricesByGuest: { 2: 30_000 } },
        { planGroupCode: 'advance:1', planLabel: '先行', roomCode: '101', pricesByGuest: { 2: 28_000 } }
      ]
    },
    { date: '2026-10-08', options: [{ planGroupCode: 'a001', planLabel: '素泊まり', roomCode: '101', pricesByGuest: { 2: 12_000 } }] }
  ];
  const inventory = {
    '2026-10-07': {
      isClosed: false,
      remainingRoomCount: 9,
      byRoomType: [
        { remaining: 2, roomCode: '101' },
        { remaining: 1, roomCode: '101' },
        { remaining: 4, roomCode: '201' }
      ]
    },
    '2026-10-08': { isClosed: true, remainingRoomCount: 0 }
  };

  it('部屋タイプ順に並べ、売止を除き、残室を部屋タイプ別に合計する', () => {
    const out = buildPartnerDays(days, inventory, {
      pricing: pricing({ rules: [rule({ planGroupCodes: ['a001', 'a002', 'a003', 'advance'], value: -10 })] }),
      rooms,
      showInventory: true,
      includeAdvance: true
    });
    expect(out[0].rooms.map((r) => r.roomCode)).toEqual(['101', '201']);
    expect(out[0].rooms[0]).toMatchObject({ roomName: '和室', remainingRooms: 3 });
    expect(out[0].rooms[0].plans.map((p) => p.planCode)).toEqual(['a002', 'advance:1']);
    expect(out[0].rooms[0].plans[0].pricesPerPerson).toEqual({ '2': 22_500 });
    expect(out[0].rooms[0].plans[0].basePricesPerPerson).toBeUndefined();
    expect(out[0].remainingRooms).toBe(7);
    expect(out[1]).toEqual({ date: '2026-10-08', closed: true, remainingRooms: 0, rooms: [] });
  });

  it('残室を出さない・先行案内を出さない・人数と部屋で絞る', () => {
    const out = buildPartnerDays(days, inventory, {
      pricing: pricing({ rules: [rule({ planGroupCodes: ['a001', 'a002', 'advance'] })] }),
      rooms,
      showInventory: false,
      includeAdvance: false,
      guestFilter: [2],
      roomFilter: ['101'],
      includeBase: true
    });
    expect(out[0].remainingRooms).toBeNull();
    expect(out[0].rooms).toHaveLength(1);
    expect(out[0].rooms[0].remainingRooms).toBeNull();
    expect(out[0].rooms[0].plans).toEqual([
      { planCode: 'a002', planName: '2食付', mealType: '2食', advance: false, pricesPerPerson: { '2': 25_000 }, basePricesPerPerson: { '2': 25_000 } }
    ]);
    expect(out[1].remainingRooms).toBeNull();
  });

  it('公開している部屋が無い日は、施設全体の残室を出さない', () => {
    const out = buildPartnerDays(
      [{ date: '2026-10-09', options: [] }],
      { '2026-10-09': { isClosed: false, remainingRoomCount: 5 } },
      { pricing: pricing({ rules: [rule({})] }), rooms, showInventory: true, includeAdvance: false }
    );
    expect(out[0]).toMatchObject({ remainingRooms: null, rooms: [] });
  });

  it('同じコードで残っている旧プラン（×××・削除予定も）は出さない', () => {
    const src: PartnerSourceDay[] = [
      {
        date: '2026-10-07',
        options: [
          { planGroupCode: 'a000', planLabel: '基本■2食■スタンダード(+17050円)旧プラン', roomCode: '101', salesStatus: '1', pricesByGuest: { 2: 40_000 } },
          { planGroupCode: 'a000', planLabel: '基本■2食■スタンダード(+17050円)', roomCode: '101', salesStatus: '1', pricesByGuest: { 2: 39_100 } },
          { planGroupCode: 'z000', planLabel: 'セール■2食■自社セール　×××', roomCode: '101', salesStatus: '1', pricesByGuest: { 2: 30_000 } },
          { planGroupCode: 'a009', planLabel: '削除予定 ひとり旅', roomCode: '101', salesStatus: '1', pricesByGuest: { 1: 30_000 } }
        ]
      }
    ];
    const p = pricing({ rules: [rule({ planGroupCodes: ['a000', 'z000', 'a009'] })] });
    const out = buildPartnerDays(src, {}, { pricing: p, rooms, showInventory: false, includeAdvance: true });
    expect(out[0].rooms[0].plans.map((p) => [p.planCode, p.planName])).toEqual([['a000', '基本■2食■スタンダード(+17050円)']]);
    expect(isRetiredPlanName('基本■2食■スタンダード(+17050円)')).toBe(false);
  });
});

// ---- 2026-10-01: 最高料金（maxPricePerPerson）・料金の幅 ----

describe('最低・最高料金', () => {
  it('normalize: 正の数だけ残し（四捨五入）、空・0・不正は null', () => {
    expect(normalizePartnerPricing({ maxPricePerPerson: 30000.4 }).maxPricePerPerson).toBe(30000);
    expect(normalizePartnerPricing({ maxPricePerPerson: '' }).maxPricePerPerson).toBeNull();
    expect(normalizePartnerPricing({ maxPricePerPerson: 0 }).maxPricePerPerson).toBeNull();
    expect(normalizePartnerPricing({ maxPricePerPerson: 'abc' }).maxPricePerPerson).toBeNull();
    expect(normalizePartnerPricing({}).maxPricePerPerson).toBeNull();
  });

  it('clampPartnerPrice: 上限・下限・両方', () => {
    expect(clampPartnerPrice(35000, { minPricePerPerson: null, maxPricePerPerson: 30000 })).toBe(30000);
    expect(clampPartnerPrice(8000, { minPricePerPerson: 10000, maxPricePerPerson: null })).toBe(10000);
    expect(clampPartnerPrice(20000, { minPricePerPerson: 10000, maxPricePerPerson: 30000 })).toBe(20000);
    expect(clampPartnerPrice(5000, { minPricePerPerson: 10000, maxPricePerPerson: 30000 })).toBe(10000);
    expect(clampPartnerPrice(40000, { minPricePerPerson: 10000, maxPricePerPerson: 30000 })).toBe(30000);
    expect(clampPartnerPrice(12345, { minPricePerPerson: null, maxPricePerPerson: null })).toBe(12345);
  });

  it('validate: 最低料金が最高料金を上回るとエラー（同額は可）', () => {
    expect(validatePartnerPricing(pricing({ minPricePerPerson: 20000, maxPricePerPerson: 10000 }))).toContain('最低料金が最高料金');
    expect(validatePartnerPricing(pricing({ minPricePerPerson: 10000, maxPricePerPerson: 10000 }))).toBeNull();
  });

  it('decidePartnerPrice: 端数処理の後に上限で頭打ちにする', () => {
    const d = decidePartnerPrice(pricing({ rules: [rule({ id: 'p', value: 10 })], maxPricePerPerson: 25_000 }), target, 23_650);
    expect(d).toEqual({ hidden: false, price: 25_000, ruleId: 'p' }); // 26,015 → 26,000 → 上限 25,000
    const under = decidePartnerPrice(pricing({ rules: [rule({ id: 'p', value: 0 })], maxPricePerPerson: 25_000 }), target, 23_650);
    expect(under).toEqual({ hidden: false, price: 23_600, ruleId: 'p' });
  });
});

describe('partnerPriceRange', () => {
  const day = (date: string, closed: boolean, prices: Record<string, number>[]): PartnerRateDay => ({
    date,
    closed,
    remainingRooms: null,
    rooms: [
      {
        roomCode: '101',
        roomName: '和室',
        remainingRooms: null,
        plans: prices.map((p, i) => ({ planCode: `a00${i}`, planName: 'プラン', mealType: '2食', advance: false, pricesPerPerson: p }))
      }
    ]
  });

  it('休館日を除いて 1名1泊 の最低・最高を出す', () => {
    const r = partnerPriceRange([
      day('2026-10-01', false, [{ '1': 30000, '2': 22000 }]),
      day('2026-10-02', true, [{ '2': 5000 }]),
      day('2026-10-03', false, [{ '2': 18000 }, { '3': 0 }])
    ]);
    expect(r).toEqual({
      min: { price: 18000, count: 1, samples: [{ date: '2026-10-03', roomName: '和室', planCode: 'a000', planName: 'プラン', guests: 2 }] },
      max: { price: 30000, count: 1, samples: [{ date: '2026-10-01', roomName: '和室', planCode: 'a000', planName: 'プラン', guests: 1 }] }
    });
  });

  it('同額が複数あれば件数を数え、根拠は日付の早い順に5件まで', () => {
    const days = Array.from({ length: 7 }, (_, i) => day(`2026-10-${String(10 - i).padStart(2, '0')}`, false, [{ '2': 20000 }]));
    const r = partnerPriceRange(days)!;
    expect(r.min.count).toBe(7);
    expect(r.min.samples.map((s) => s.date)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
  });

  it('チャンクをまたいだ合算: 安い方を残し、同額なら件数と根拠を足す', () => {
    const a = partnerPriceRange([day('2026-11-02', false, [{ '2': 15000 }])])!;
    const b = partnerPriceRange([day('2026-10-02', false, [{ '2': 15000 }]), day('2026-10-03', false, [{ '2': 16000 }])])!;
    const min = mergePriceExtreme(a.min, b.min, (x, y) => x < y)!;
    expect(min.count).toBe(2);
    expect(min.samples.map((s) => s.date)).toEqual(['2026-10-02', '2026-11-02']);
    const max = mergePriceExtreme(a.max, b.max, (x, y) => x > y)!;
    expect(max).toEqual({ price: 16000, count: 1, samples: [{ date: '2026-10-03', roomName: '和室', planCode: 'a000', planName: 'プラン', guests: 2 }] });
  });

  it('出せる料金が無ければ null', () => {
    expect(partnerPriceRange([])).toBeNull();
    expect(partnerPriceRange([day('2026-10-02', true, [{ '2': 5000 }])])).toBeNull();
  });
});
