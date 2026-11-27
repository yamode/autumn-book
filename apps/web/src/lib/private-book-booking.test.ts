import { describe, expect, it } from 'vitest';
import {
  PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE,
  privateBookChangeBlock,
  privateBookOfferKey,
  privateBookRouteOf,
  splitPrivateBookPlanKey
} from './private-book-booking';

const ME = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const PAGE = '33333333-3333-3333-3333-333333333333';

describe('privateBookRouteOf（公式マイページの操作の行き先）', () => {
  it('一般の予約（member_page なし）は今までどおり公式の RPC', () => {
    expect(privateBookRouteOf({ code: 'B1', memberPage: null }, ME)).toEqual({ kind: 'general' });
    expect(privateBookRouteOf({ code: 'B1' }, ME)).toEqual({ kind: 'general' });
    // ログインしていなくても一般の予約の行き先は変わらない（本人確認は公式の RPC）
    expect(privateBookRouteOf({ code: 'B1', memberPage: null }, null)).toEqual({ kind: 'general' });
  });

  it('予約した本人なら、写しの partnerId とログイン中の会員で入口を呼ぶ', () => {
    expect(privateBookRouteOf({ code: 'B2', memberPage: { partnerId: PAGE, memberUserId: ME } }, ME)).toEqual({
      kind: 'private_book',
      who: { partnerId: PAGE, memberUserId: ME, code: 'B2' }
    });
  });

  it('写しに会員が無い古い予約は本人として扱う（会員はログイン中の id・DB が予約した本人を確かめる）', () => {
    expect(privateBookRouteOf({ code: 'B3', memberPage: { partnerId: PAGE, memberUserId: null } }, ME)).toEqual({
      kind: 'private_book',
      who: { partnerId: PAGE, memberUserId: ME, code: 'B3' }
    });
  });

  it('別の会員の予約・ログインしていないときは断る', () => {
    expect(privateBookRouteOf({ code: 'B4', memberPage: { partnerId: PAGE, memberUserId: OTHER } }, ME)).toEqual({ kind: 'deny' });
    expect(privateBookRouteOf({ code: 'B4', memberPage: { partnerId: PAGE, memberUserId: ME } }, null)).toEqual({ kind: 'deny' });
    expect(privateBookRouteOf({ code: 'B4', memberPage: { partnerId: PAGE, memberUserId: ME } }, '')).toEqual({ kind: 'deny' });
    expect(privateBookRouteOf({ code: 'B4', memberPage: { partnerId: '', memberUserId: ME } }, ME)).toEqual({ kind: 'deny' });
  });
});

describe('privateBookChangeBlock（日程・お部屋の変更とアレンジはページを使える方だけ）', () => {
  const open = { is_active: true, valid_from: null, valid_until: null };
  it('対象者で公開中なら通す', () => {
    expect(privateBookChangeBlock({ access: true, page: open }, '2026-11-27')).toBeNull();
    expect(privateBookChangeBlock({ access: true, page: { is_active: true, valid_from: '2026-11-27', valid_until: '2026-11-27' } }, '2026-11-27')).toBeNull();
  });
  it('対象から外れた方は止める', () => {
    expect(privateBookChangeBlock({ access: false, page: open }, '2026-11-27')).toBe(PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE);
  });
  it('ページが読めない・公開停止・期間外は止める', () => {
    expect(privateBookChangeBlock({ access: true, page: null }, '2026-11-27')).toBe(PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE);
    expect(privateBookChangeBlock({ access: true, page: { ...open, is_active: false } }, '2026-11-27')).toBe(PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE);
    expect(privateBookChangeBlock({ access: true, page: { ...open, valid_from: '2026-11-28' } }, '2026-11-27')).toBe(PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE);
    expect(privateBookChangeBlock({ access: true, page: { ...open, valid_until: '2026-11-26' } }, '2026-11-27')).toBe(PRIVATE_BOOK_CHANGE_CLOSED_MESSAGE);
  });
});

describe('部屋の変更の候補の識別', () => {
  it('planCode■planName と部屋タイプのコードを offer にし、プランを分け直せる', () => {
    expect(privateBookOfferKey('P1■夕朝食付き', 'W01')).toBe('P1■夕朝食付き__W01');
    expect(splitPrivateBookPlanKey('P1■夕朝食付き')).toEqual({ planCode: 'P1', planName: '夕朝食付き' });
    // プラン名に ■ が入っていても最初の ■ で分ける
    expect(splitPrivateBookPlanKey('P1■A■B')).toEqual({ planCode: 'P1', planName: 'A■B' });
  });
  it('形が違えば null', () => {
    expect(splitPrivateBookPlanKey('P1')).toBeNull();
    expect(splitPrivateBookPlanKey('■名前')).toBeNull();
    expect(splitPrivateBookPlanKey('P1■ ')).toBeNull();
    expect(splitPrivateBookPlanKey('')).toBeNull();
  });
});
