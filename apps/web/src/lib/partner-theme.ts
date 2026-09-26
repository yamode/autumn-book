// 取引先ページ（/p）の施設ごとの差し色（yamado = 森の緑 / oga = 夜の海）。
// 画面の CSS 変数（--pt-accent / --pt-accent-soft）と、Stripe の決済部品（iframe の中なので16進で渡す）の両方で使う。
export type PartnerAccent = { accent: string; accentSoft: string };

export const PARTNER_ACCENTS: Record<string, PartnerAccent> = {
  yamado: { accent: '#4a6b52', accentSoft: '#e7eee8' },
  oga: { accent: '#2d4a5a', accentSoft: '#e4ecf0' }
};

export const PARTNER_DEFAULT_ACCENT: PartnerAccent = { accent: '#44402f', accentSoft: '#e9e6dc' };

export const partnerAccent = (facilitySlug: string | null | undefined): PartnerAccent =>
  PARTNER_ACCENTS[facilitySlug ?? ''] ?? PARTNER_DEFAULT_ACCENT;
