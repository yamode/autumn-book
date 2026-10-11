import { beforeEach, describe, expect, it } from 'vitest';
import { memberCart, memberCartBlockMessage, memberCartFullNotice } from './member-cart.svelte';
import type { MemberCartItem } from './partner-member-page';

// 特別会員の専用ページのかご（docs/vip-member-page.md §13.4.3）。テストでは sessionStorage が無いので画面の中だけで持つ
const room = (over: Partial<Omit<MemberCartItem, 'key' | 'partnerToken'>> = {}): Omit<MemberCartItem, 'key' | 'partnerToken'> => ({
  facilityId: 'fac-1',
  facilitySlug: 'yamado',
  checkin: '2026-12-01',
  nights: 1,
  roomCode: 'WA',
  roomTypeId: 'WA',
  roomName: '和室',
  planCode: 'P1',
  planName: '基本■2食',
  displayName: '基本プラン',
  adults: 2,
  total: 40000,
  pay: { onsite: true, prepay: true },
  remaining: null,
  ...over
});

describe('memberCart', () => {
  beforeEach(() => {
    memberCart.load('tok');
    memberCart.clear();
  });

  it('4 室まで入り、4 室目で上限の注意・5 室目は入らない', () => {
    for (let i = 0; i < 4; i++) expect(memberCart.add(room(), 4, () => true)).toBe(true);
    expect(memberCart.items).toHaveLength(4);
    expect(memberCart.add(room(), 4, () => true)).toBe(false);
    expect(memberCart.items).toHaveLength(4);
    expect(memberCart.message).toBe(memberCartFullNotice(4));
    expect(memberCartFullNotice(4)).toContain('4 室まで');
    expect(memberCartFullNotice(4)).toContain('5 室以上');
  });

  it('最大室数が 4 より少ないページはその室数まで', () => {
    expect(memberCart.add(room(), 2, () => true)).toBe(true);
    expect(memberCart.add(room({ roomCode: 'YO', roomTypeId: 'YO' }), 2, () => true)).toBe(true);
    expect(memberCart.add(room(), 2, () => true)).toBe(false);
  });

  it('別の日程は「かごを空にしますか」で確かめ、断れば何もしない・受ければ入れ替える', () => {
    memberCart.add(room(), 4, () => true);
    expect(memberCart.add(room({ checkin: '2026-12-02' }), 4, () => false)).toBe(false);
    expect(memberCart.items.map((c) => c.checkin)).toEqual(['2026-12-01']);
    expect(memberCart.add(room({ checkin: '2026-12-02' }), 4, () => true)).toBe(true);
    expect(memberCart.items.map((c) => c.checkin)).toEqual(['2026-12-02']);
  });

  it('支払方法が両立しないプランは入らない（理由を出す）', () => {
    memberCart.add(room({ pay: { onsite: true, prepay: false } }), 4, () => true);
    expect(memberCart.add(room({ planCode: 'P2', pay: { onsite: false, prepay: true } }), 4, () => true)).toBe(false);
    expect(memberCart.message).toBe(memberCartBlockMessage('mixed_payment', 4));
  });

  it('送る形は部屋タイプ・プラン・人数だけ（金額は送らない）', () => {
    memberCart.add(room(), 4, () => true);
    expect(memberCart.payload()).toEqual([{ roomCode: 'WA', planCode: 'P1', planName: '基本■2食', adults: 2 }]);
  });
});
