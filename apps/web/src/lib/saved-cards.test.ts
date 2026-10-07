// 保存カード（2026-10-07・docs/saved-cards.md）の純関数のテスト。`pnpm --filter @autumn-book/web test`
import { describe, expect, it } from 'vitest';
import {
  bookingBlocksCardRemoval,
  cardBrandLabel,
  cardExpiredOn,
  cardExpLabel,
  duplicateCardOf,
  savedCardCustomerFor,
  savedCardOf,
  savedCardsOf,
  savedCardTitle,
  savedCardView,
  selectedCardExpiresBefore,
  shortHash
} from './saved-cards';

const pm = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030, fingerprint: `fp_${id}` },
  created: 1_790_000_000,
  allow_redisplay: 'always',
  ...extra
});

describe('表示', () => {
  it('ブランド・有効期限・見出し', () => {
    expect(cardBrandLabel('visa')).toBe('Visa');
    expect(cardBrandLabel('amex')).toBe('American Express');
    expect(cardBrandLabel('jcb')).toBe('JCB');
    expect(cardBrandLabel('')).toBe('カード');
    expect(cardExpLabel(3, 2031)).toBe('03/31');
    expect(cardExpLabel(null, 2031)).toBe('—');
    expect(cardExpLabel(13, 2031)).toBe('—');
    expect(savedCardTitle({ brand: 'mastercard', last4: '4444' })).toBe('Mastercard •••• 4444');
  });
  it('画面へは fingerprint を渡さない', () => {
    const c = savedCardOf(pm('pm_1'), null)!;
    expect(c.fingerprint).toBe('fp_pm_1');
    expect('fingerprint' in savedCardView(c)).toBe(false);
  });
});

describe('一覧', () => {
  it('保存の同意を取ったカード（always）だけ・既定 → 新しい順', () => {
    const list = savedCardsOf(
      [
        pm('pm_old', { created: 1_700_000_000 }),
        pm('pm_new', { created: 1_800_000_000 }),
        pm('pm_def', { created: 1_600_000_000 }),
        // 予約ごとのカード登録で付いたカードは出さない
        pm('pm_booking', { allow_redisplay: 'unspecified' }),
        { id: 'pm_nocard', allow_redisplay: 'always' }
      ],
      'pm_def'
    );
    expect(list.map((c) => c.id)).toEqual(['pm_def', 'pm_new', 'pm_old']);
    expect(list[0].isDefault).toBe(true);
    expect(list[1].created).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });
  it('同じカード（fingerprint）は自分以外で探す', () => {
    const cards = [
      { id: 'pm_a', fingerprint: 'fp_x' },
      { id: 'pm_b', fingerprint: 'fp_y' }
    ];
    expect(duplicateCardOf(cards, { id: 'pm_new', fingerprint: 'fp_x' })).toBe('pm_a');
    expect(duplicateCardOf(cards, { id: 'pm_a', fingerprint: 'fp_x' })).toBeNull();
    expect(duplicateCardOf(cards, { id: 'pm_new', fingerprint: null })).toBeNull();
    expect(duplicateCardOf(cards, { id: 'pm_new', fingerprint: 'fp_z' })).toBeNull();
  });
});

describe('有効期限', () => {
  it('マイページの登録は今日の時点で切れていないか（余裕なし）', () => {
    expect(cardExpiredOn({ exp_month: 9, exp_year: 2026 }, '2026-10-07')).toBe(true);
    expect(cardExpiredOn({ exp_month: 10, exp_year: 2026 }, '2026-10-07')).toBe(false);
    expect(cardExpiredOn(null, '2026-10-07')).toBe(false);
  });
  it('予約画面で選んだ保存カード: Stripe のカード情報か自前の一覧で、請求日の月から2か月以内なら止める', () => {
    const cards = [{ id: 'pm_a', expMonth: 12, expYear: 2026 }];
    // 請求日 2026-11-20 → 2027年1月以降のカードだけ通す
    expect(selectedCardExpiresBefore({ id: 'pm_a', card: null }, cards, '2026-11-20')).toBe(true);
    expect(selectedCardExpiresBefore({ id: 'pm_a', card: { exp_month: 1, exp_year: 2027 } }, cards, '2026-11-20')).toBe(false);
    expect(selectedCardExpiresBefore({ id: 'pm_unknown', card: null }, cards, '2026-11-20')).toBe(false);
    expect(selectedCardExpiresBefore(null, cards, '2026-11-20')).toBe(false);
    expect(selectedCardExpiresBefore({ id: 'pm_a', card: null }, cards, null)).toBe(false);
  });
});

describe('削除を止める予約（取引先）', () => {
  it('請求前・請求失敗のチェックアウト日決済と、カードへのキャンセル料の請求途中', () => {
    expect(bookingBlocksCardRemoval({ status: 'confirmed', payment_status: 'scheduled' })).toBe(true);
    expect(bookingBlocksCardRemoval({ status: 'confirmed', payment_status: 'charge_failed' })).toBe(true);
    expect(bookingBlocksCardRemoval({ status: 'confirmed', payment_status: 'paid' })).toBe(false);
    const now = new Date('2026-10-07T12:00:00Z');
    expect(bookingBlocksCardRemoval({ status: 'cancelled', cancel_fee_settlement: 'card', cancel_fee_status: null, cancelled_at: '2026-10-07T03:00:00Z' }, now)).toBe(true);
    // 取消から24時間を過ぎて残っているもの・取消日時が分からないものは止めない（削除を永久に止めない逃げ道）
    expect(bookingBlocksCardRemoval({ status: 'cancelled', cancel_fee_settlement: 'card', cancel_fee_status: null, cancelled_at: '2026-10-06T11:00:00Z' }, now)).toBe(false);
    expect(bookingBlocksCardRemoval({ status: 'cancelled', cancel_fee_settlement: 'card', cancel_fee_status: null }, now)).toBe(false);
    expect(bookingBlocksCardRemoval({ status: 'cancelled', cancel_fee_settlement: 'card', cancel_fee_status: 'charged' })).toBe(false);
    expect(bookingBlocksCardRemoval({ status: 'cancelled', cancel_fee_settlement: 'invoice', cancel_fee_status: 'charge_failed' })).toBe(false);
  });
});

describe('予約画面に保存カードを出す Customer', () => {
  it('Intent に付く Customer と同じときだけ', () => {
    expect(savedCardCustomerFor(null, null)).toBeNull();
    expect(savedCardCustomerFor('cus_s', null)).toBe('cus_s');
    expect(savedCardCustomerFor('cus_s', { payment_option: 'online', stripe_customer_id: null })).toBe('cus_s');
    expect(savedCardCustomerFor('cus_s', { payment_option: 'online_checkin', stripe_customer_id: null })).toBe('cus_s');
    expect(savedCardCustomerFor('cus_s', { payment_option: 'online_checkin', stripe_customer_id: 'cus_s' })).toBe('cus_s');
    // 予約ごとの Customer（旧予約）の登録し直しには出さない
    expect(savedCardCustomerFor('cus_s', { payment_option: 'online_checkin', stripe_customer_id: 'cus_booking' })).toBeNull();
  });
});

describe('冪等キーのハッシュ', () => {
  it('同じ入力は同じ値・違う入力は違う値（8桁の16進）', () => {
    expect(shortHash('山人|info@yamado.co.jp')).toMatch(/^[0-9a-f]{8}$/);
    expect(shortHash('a')).toBe(shortHash('a'));
    expect(shortHash('a')).not.toBe(shortHash('b'));
    expect(shortHash('')).toBe('811c9dc5');
  });
});
