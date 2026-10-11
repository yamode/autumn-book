// 特別会員の専用ページの純関数（docs/vip-member-page.md §13.4.6）
import { describe, expect, it } from 'vitest';
import {
  CANCEL_POLICY_LABELS,
  earnEstimateOf,
  fromCancelRules,
  groupMemberHoldRooms,
  isMemberCartItem,
  isMemberPage,
  MEMBER_CART_STORAGE_KEY,
  memberBenefitLines,
  memberCartPayCompatible,
  memberCartPayload,
  memberMaxRooms,
  memberPageBookingOpen,
  memberPageBookingsOf,
  memberPageHrefOf,
  memberPageInput,
  memberPageOpError,
  normalizeCancelPolicyMode,
  normalizeCancelRules,
  normalizeMemberCartItem,
  parseMemberHoldRooms,
  parseMemberPageSnapshot,
  parseMemberPerks,
  perksSnapshotOf,
  rankLabelOf,
  toCancelRules,
  toHoldLines,
  type MemberCartItem
} from './partner-member-page';
import { canAddToCart, cartGroups, readCartWith, writeCartWith } from './multi-room';
import { isMemberPortalDenied } from './server/partners/portal';

const form = (o: Record<string, string>) => (k: string) => (k in o ? o[k] : null);

describe('種別・受付', () => {
  it('member だけが特別会員（ambassador は TS では扱わない）', () => {
    expect(isMemberPage('member')).toBe(true);
    expect(isMemberPage('agent')).toBe(false);
    expect(isMemberPage('ambassador')).toBe(false);
  });
  it('予約受付は支払方法を見ない（member・受付オン・施設オン）', () => {
    expect(memberPageBookingOpen({ kind: 'member', booking_enabled: true, facility_available: true })).toBe(true);
    expect(memberPageBookingOpen({ kind: 'member', booking_enabled: false, facility_available: true })).toBe(false);
    expect(memberPageBookingOpen({ kind: 'member', booking_enabled: true, facility_available: false })).toBe(false);
    expect(memberPageBookingOpen({ kind: 'agent', booking_enabled: true, facility_available: true })).toBe(false);
  });
  it('室数の上限は 4（取引先の最大室数が 5 以上でも）', () => {
    expect(memberMaxRooms({ maxRooms: 5 })).toBe(4);
    expect(memberMaxRooms({ maxRooms: 20 })).toBe(4);
    expect(memberMaxRooms({ maxRooms: 2 })).toBe(2);
    expect(memberMaxRooms({ maxRooms: 0 })).toBe(1);
  });
});

describe('キャンセル方式・規定', () => {
  it('不明な方式は favorable（既定）', () => {
    expect(normalizeCancelPolicyMode('page')).toBe('page');
    expect(normalizeCancelPolicyMode('x')).toBe('favorable');
    expect(CANCEL_POLICY_LABELS.favorable).toBe('お客さまに有利な方');
  });
  it('規定は日数の多い順・範囲外を捨て・同じ日数は後の段', () => {
    expect(
      normalizeCancelRules([
        { days_before: 1, rate: 0.5 },
        { days_before: 7, rate: 0.1 },
        { days_before: 7, rate: 0.2 },
        { days_before: -1, rate: 1 },
        { days_before: 3, rate: 1.5 },
        'x'
      ])
    ).toEqual([
      { days_before: 7, rate: 0.2 },
      { days_before: 1, rate: 0.5 }
    ]);
    expect(normalizeCancelRules(null)).toEqual([]);
  });
  it('率 % ⇔ 0〜1', () => {
    expect(toCancelRules([{ days_before: 3, rate_percent: 30 }])).toEqual([{ days_before: 3, rate: 0.3 }]);
    expect(fromCancelRules([{ days_before: 3, rate: 0.333 }])).toEqual([{ days_before: 3, rate_percent: 33.3 }]);
  });
  it('RPC に渡す束の値: rank では専用規定を写さない', () => {
    expect(memberPageInput('A', 'rank', [{ days_before: 1, rate: 0.5 }])).toEqual({ page_name: 'A', cancel_policy_mode: 'rank', cancel_rules: [] });
    expect(memberPageInput('A', 'page', [{ days_before: 1, rate: 0.5 }]).cancel_rules).toEqual([{ days_before: 1, rate: 0.5 }]);
  });
});

describe('会員特典の 2 段目・獲得ポイント', () => {
  it('還元率・方式・ポイント利用の 3 行', () => {
    const lines = memberBenefitLines('GOLD', 0.03, 'favorable');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('3%');
    expect(lines[0]).toContain('GOLD');
    expect(lines[1]).toContain('お客さまに有利な方');
  });
  it('グレードの表示名（DB のラベル → 既定 → 大文字）', () => {
    expect(rankLabelOf('gold', null)).toBe('GOLD');
    expect(rankLabelOf('gold', 'ゴールド')).toBe('ゴールド');
    expect(rankLabelOf('vip', null)).toBe('VIP');
  });
  it('獲得予定ポイントは DB と同じ式 floor(額 ÷ 1.10 × 率)', () => {
    expect(earnEstimateOf(40000, 0.03)).toBe(1090);
    expect(earnEstimateOf(140000, 0.01)).toBe(1272);
  });
});

describe('束・部屋の写し', () => {
  it('DB の member_page を読む（partner_id が無ければ null）', () => {
    expect(
      parseMemberPageSnapshot({
        partner_id: 'p',
        facility_id: 'f',
        member_user_id: 'u',
        page_name: '特別様',
        via: 'family',
        cancel_policy_mode: 'page',
        cancel_rules: [{ days_before: 1, rate: 0.2 }]
      })
    ).toEqual({ partnerId: 'p', facilityId: 'f', memberUserId: 'u', pageName: '特別様', via: 'family', cancelPolicyMode: 'page', cancelRules: [{ days_before: 1, rate: 0.2 }] });
    expect(parseMemberPageSnapshot(null)).toBeNull();
    expect(parseMemberPageSnapshot({})).toBeNull();
  });
  it('部屋の特典（title の無いものは捨て・空なら null）', () => {
    expect(parseMemberPerks([{ id: 'a', title: 'ワイン', description: 'ハーフ' }, { title: '' }])).toEqual([{ id: 'a', title: 'ワイン', description: 'ハーフ' }]);
    expect(parseMemberPerks([])).toBeNull();
    expect(parseMemberPerks(null)).toBeNull();
  });
  it('このプランに付く特典だけを写す（全プラン対象を含む）', () => {
    const perks = [
      { id: '1', title: '全部', description: '', planCodes: [] },
      { id: '2', title: 'A だけ', description: 'x', planCodes: ['a001'] },
      { id: '3', title: 'B だけ', description: '', planCodes: ['b001'] }
    ];
    expect(perksSnapshotOf(perks, 'a001')?.map((p) => p.id)).toEqual(['1', '2']);
    expect(perksSnapshotOf(perks.slice(2), 'a001')).toBeNull();
  });
});

describe('予約へ進む（?/hold）のフォーム', () => {
  it('rooms JSON（かご）', () => {
    const r = parseMemberHoldRooms(form({ rooms: JSON.stringify([{ roomCode: 'WA', planCode: 'a001', planName: '基本■2食', adults: 2 }, { roomCode: 'YO', planCode: 'a002', planName: '朝食', adults: 1 }]) }), 4);
    expect(r).toEqual({
      ok: true,
      rooms: [
        { roomCode: 'WA', planCode: 'a001', planName: '基本■2食', adults: 2 },
        { roomCode: 'YO', planCode: 'a002', planName: '朝食', adults: 1 }
      ]
    });
  });
  it('1 タップ（同じ部屋タイプ × N 室・同じ人数）', () => {
    const r = parseMemberHoldRooms(form({ room: 'WA', plan: 'a001', name: '基本', guests: '2', rooms: '3' }), 4);
    expect(r.ok && r.rooms.length).toBe(3);
  });
  it('上限・不正', () => {
    expect(parseMemberHoldRooms(form({ room: 'WA', plan: 'a001', name: 'x', guests: '2', rooms: '5' }), 4)).toEqual({ ok: false, code: 'too_many_rooms' });
    expect(parseMemberHoldRooms(form({ room: 'WA', plan: 'a001', name: 'x', guests: '2', rooms: '3' }), 2)).toEqual({ ok: false, code: 'too_many_rooms' });
    expect(parseMemberHoldRooms(form({}), 4)).toEqual({ ok: false, code: 'missing' });
    expect(parseMemberHoldRooms(form({ rooms: '[{"roomCode":"WA","planCode":"a001","planName":"x","adults":7}]' }), 4)).toEqual({ ok: false, code: 'invalid' });
    expect(parseMemberHoldRooms(form({ rooms: '[{"roomCode":"W A","planCode":"a001","planName":"x","adults":2}]' }), 4)).toEqual({ ok: false, code: 'invalid' });
    expect(parseMemberHoldRooms(form({ rooms: '[oops' }), 4)).toEqual({ ok: false, code: 'invalid' });
  });
  it('部屋タイプ・プランの組にまとめる（quotePartnerBooking を呼ぶ単位）', () => {
    const g = groupMemberHoldRooms([
      { roomCode: 'WA', planCode: 'a', planName: 'x', adults: 2 },
      { roomCode: 'YO', planCode: 'a', planName: 'x', adults: 1 },
      { roomCode: 'WA', planCode: 'a', planName: 'x', adults: 3 }
    ]);
    expect(g).toEqual([
      { roomCode: 'WA', planCode: 'a', planName: 'x', indexes: [0, 2] },
      { roomCode: 'YO', planCode: 'a', planName: 'x', indexes: [1] }
    ]);
  });
  it('見積の部屋 → RPC の泊明細', () => {
    expect(toHoldLines({ adults: 2, nights: [{ date: '2026-11-09', unit_price: 27000 }, { date: '2026-11-10', unit_price: 25000 }] })).toEqual([
      { date: '2026-11-09', unit_price: 27000, adults: 2, subtotal: 54000 },
      { date: '2026-11-10', unit_price: 25000, adults: 2, subtotal: 50000 }
    ]);
  });
});

describe('ご予約一覧・リンク', () => {
  const rs = [
    { code: 'A', memberPage: { partnerId: 'p1', memberUserId: 'u1' } },
    { code: 'B', memberPage: { partnerId: 'p1', memberUserId: 'u2' } },
    { code: 'C', memberPage: { partnerId: 'p2', memberUserId: 'u1' } },
    { code: 'D', memberPage: null }
  ];
  it('このページから本人が予約した分だけ（家族・別ページ・公式は出さない）', () => {
    expect(memberPageBookingsOf(rs, 'p1', 'u1').map((r) => r.code)).toEqual(['A']);
  });
  it('予約詳細の URL', () => {
    expect(memberPageHrefOf('tok', 'YB-2026-000001')).toBe('/p/tok/bookings/YB-2026-000001');
  });
});

describe('専用ページのかご（公式と同じ判定・別の保存キー）', () => {
  const item = (o: Partial<MemberCartItem> = {}): MemberCartItem => ({
    key: Math.random().toString(36),
    partnerToken: 'tok',
    facilityId: 'f1',
    facilitySlug: 'yamado',
    checkin: '2026-11-09',
    nights: 1,
    roomCode: 'WA',
    roomTypeId: 'WA',
    roomName: '和室',
    planCode: 'a001',
    planName: '基本',
    displayName: '基本',
    adults: 2,
    total: 54000,
    pay: { onsite: true, prepay: false },
    remaining: 3,
    ...o
  });
  it('4 室まで・別日程は other_stay・支払方法が両立しないと mixed_payment・残室', () => {
    const cart = [item(), item(), item({ roomCode: 'YO', roomTypeId: 'YO' })];
    expect(canAddToCart(cart, item({ roomCode: 'YO', roomTypeId: 'YO' }))).toEqual({ ok: true });
    expect(canAddToCart([...cart, item({ roomCode: 'YO', roomTypeId: 'YO' })], item())).toEqual({ ok: false, reason: 'full' });
    expect(canAddToCart(cart, item({ checkin: '2026-11-10' }))).toEqual({ ok: false, reason: 'other_stay' });
    expect(canAddToCart(cart, item({ roomCode: 'YO', roomTypeId: 'YO', pay: { onsite: false, prepay: true } }))).toEqual({ ok: false, reason: 'mixed_payment' });
    expect(canAddToCart(cart, item({ remaining: 2 }))).toEqual({ ok: false, reason: 'no_remaining' });
    // 取引先の最大室数（2）で止める
    expect(canAddToCart(cart.slice(0, 2), item(), 2)).toEqual({ ok: false, reason: 'full' });
  });
  it('内訳のまとめ（同じ部屋タイプ・プラン・人数）', () => {
    const g = cartGroups([item(), item(), item({ planCode: 'a002' })], (c) => c.planCode);
    expect(g.map((x) => x.count)).toEqual([2, 1]);
  });
  it('sessionStorage は ab_member_cart_v1（公式のかごと混ざらない）・壊れた値は空', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    writeCartWith(storage, MEMBER_CART_STORAGE_KEY, [item()]);
    expect(store.has('ab_member_cart_v1')).toBe(true);
    expect(store.has('ab_booking_cart_v1')).toBe(false);
    const read = readCartWith(storage, MEMBER_CART_STORAGE_KEY, isMemberCartItem, normalizeMemberCartItem);
    expect(read).toHaveLength(1);
    expect(read[0].roomTypeId).toBe('WA');
    store.set(MEMBER_CART_STORAGE_KEY, '{oops');
    expect(readCartWith(storage, MEMBER_CART_STORAGE_KEY, isMemberCartItem)).toEqual([]);
  });
  it('送る形と支払方法の両立', () => {
    expect(memberCartPayload([item()])).toEqual([{ roomCode: 'WA', planCode: 'a001', planName: '基本', adults: 2 }]);
    expect(memberCartPayCompatible([item(), item({ pay: { onsite: true, prepay: true } })])).toBe(true);
    expect(memberCartPayCompatible([item(), item({ pay: { onsite: false, prepay: true } })])).toBe(false);
  });
});

describe('専用ページで使わないルート（resolvePortal が 404）', () => {
  it('取引先の機能は 404・料金カレンダー・予約・ご予約一覧は使う', () => {
    for (const p of ['/group', '/group/new', '/memorandum', '/account/users', '/mfa', '/passkey/login/options', '/setup', '/payment', '/stay', '/legal/terms', '/logout', '/book/reserve', '/book/attachments/x', '/bookings/PB-1/attachments'])
      expect(isMemberPortalDenied(p)).toBe(true);
    for (const p of ['/', '/calendar', '/calendar/month', '/rooms', '/plans', '/rate-sheet', '/facility', '/book', '/book/quote', '/bookings', '/bookings/YB-2026-000001', '/bookings/YB-2026-000001/amend', '/bookings/YB-2026-000001/options'])
      expect(isMemberPortalDenied(p)).toBe(false);
  });
});

describe('専用ページの操作の例外 → 画面（具体的な語から判定）', () => {
  const code = (m: string) => memberPageOpError({ message: m }).code;
  it('room_not_found は not_found に当たらない・option_sold_out は sold_out に当たらない', () => {
    expect(code('room_not_found')).toBe('invalid');
    expect(code('option_sold_out')).toBe('option_sold_out');
    expect(code('sold_out:a0000000-0000-0000-0000-00000000000a')).toBe('sold_out');
    expect(code('not_member_page_booking')).toBe('not_found');
    expect(code('not_found')).toBe('not_found');
    expect(code('member_page_booking')).toBe('forbidden');
  });
  it('日程変更・取消の語', () => {
    expect(code('amend_in_penalty')).toBe('in_penalty');
    expect(code('prepaid_online')).toBe('prepaid_online');
    expect(code('amend_limit')).toBe('amend_limit');
    expect(code('past_deadline')).toBe('deadline_passed');
    expect(code('invalid_lines')).toBe('invalid');
    expect(code('not_cancellable')).toBe('not_allowed');
    expect(code('forbidden')).toBe('forbidden');
    expect(memberPageOpError(new Error('something else')).status).toBe(500);
  });
});
