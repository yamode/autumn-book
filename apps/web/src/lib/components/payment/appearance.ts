// Stripe Elements の見た目（Appearance API）を Book の公開サイトのデザインに合わせる（純関数）。
//
// Elements は Stripe のドメインの iframe の中に描かれるので、ページの CSS 変数（--color-accent-600 等）は届かない。
// 色は16進の値で渡す。施設の差し色（取引先ページの --pt-accent 等）は accent / accentSoft で上書きする。
import type { Appearance } from '@stripe/stripe-js';

export type PaymentTheme = {
  accent: string; // ボタン・選択中・フォーカスの色（Book の accent-600 / 施設の差し色）
  accentSoft: string; // フォーカスの輪
  text: string; // 文字（brand-900）
  muted: string; // 弱い文字（stone-500）
  border: string; // 入力欄の枠（stone-300）
  danger: string; // エラー（rose-700）
  background: string; // 入力欄の地
  radius: string; // 角丸（入力欄は rounded-md）
  fontFamily: string;
};

// Book の公開サイト（app.css の @theme・予約フローの入力欄）と同じ値
export const BOOK_PAYMENT_THEME: PaymentTheme = {
  accent: '#95742c',
  accentSoft: '#f1e9d6',
  text: '#1f1d15',
  muted: '#78716c',
  border: '#d6d3d1',
  danger: '#be123c',
  background: '#ffffff',
  radius: '6px',
  fontFamily:
    "system-ui, -apple-system, 'Segoe UI', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Yu Gothic Medium', 'YuGothic', 'Meiryo', 'Noto Sans JP', sans-serif"
};

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// 渡された色のうち、16進として正しいものだけで既定を上書きする（CSS 変数や空文字は Stripe が受け付けない）。
export function resolvePaymentTheme(overrides: Partial<PaymentTheme> = {}): PaymentTheme {
  const out = { ...BOOK_PAYMENT_THEME };
  for (const k of Object.keys(overrides) as (keyof PaymentTheme)[]) {
    const v = overrides[k]?.trim();
    if (!v) continue;
    if (k === 'radius' || k === 'fontFamily' ? true : HEX.test(v)) out[k] = v;
  }
  return out;
}

export function stripeAppearance(overrides: Partial<PaymentTheme> = {}): Appearance {
  const t = resolvePaymentTheme(overrides);
  return {
    theme: 'stripe',
    variables: {
      colorPrimary: t.accent,
      colorText: t.text,
      colorTextSecondary: t.muted,
      colorTextPlaceholder: '#a8a29e',
      colorDanger: t.danger,
      colorBackground: t.background,
      borderRadius: t.radius,
      fontFamily: t.fontFamily,
      fontSizeBase: '16px',
      fontWeightNormal: '500',
      spacingUnit: '4px',
      focusBoxShadow: `0 0 0 3px ${t.accentSoft}`,
      focusOutline: 'none'
    },
    rules: {
      '.Input': { border: `1px solid ${t.border}`, boxShadow: 'none', padding: '10px 12px' },
      '.Input:focus': { borderColor: t.accent, boxShadow: `0 0 0 3px ${t.accentSoft}` },
      '.Input--invalid': { borderColor: t.danger, boxShadow: 'none' },
      '.Label': { fontSize: '14px', fontWeight: '500', color: t.text, marginBottom: '4px' },
      '.Tab': { border: `1px solid ${t.border}`, boxShadow: 'none' },
      '.Tab:hover': { borderColor: t.accent },
      '.Tab--selected': { borderColor: t.accent, boxShadow: `0 0 0 1px ${t.accent}` },
      '.Error': { fontSize: '13px' }
    }
  };
}
