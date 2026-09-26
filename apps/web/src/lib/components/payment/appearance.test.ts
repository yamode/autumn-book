// 決済部品の見た目（Stripe Appearance）の純関数のテスト
import { describe, expect, it } from 'vitest';
import { BOOK_PAYMENT_THEME, resolvePaymentTheme, stripeAppearance } from './appearance';

describe('決済部品の見た目', () => {
  it('既定は Book の配色（accent-600・brand-900・角丸 6px）', () => {
    const a = stripeAppearance();
    expect(a.variables?.colorPrimary).toBe('#95742c');
    expect(a.variables?.colorText).toBe('#1f1d15');
    expect(a.variables?.borderRadius).toBe('6px');
  });
  it('施設の差し色で上書きできる（16進以外は無視）', () => {
    const t = resolvePaymentTheme({ accent: '#4a6b52', accentSoft: 'var(--pt-accent-soft)', text: '' });
    expect(t.accent).toBe('#4a6b52');
    expect(t.accentSoft).toBe(BOOK_PAYMENT_THEME.accentSoft);
    expect(t.text).toBe(BOOK_PAYMENT_THEME.text);
    expect(stripeAppearance({ accent: '#2d4a5a' }).rules?.['.Input:focus']?.borderColor).toBe('#2d4a5a');
  });
});
