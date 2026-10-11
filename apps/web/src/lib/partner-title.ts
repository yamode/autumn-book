// 取引先ページの <title>（2026-10-06 指示・A案）。ブックマーク・タブは先頭しか見えないことが多いので、
// 「どの宿の・自社専用の予約ページか」を先頭に置き、ページ名は後ろに付ける。
//   例: 山人-oga- 再春館製薬所様 専用予約｜料金カレンダー
// ログイン・パスワード設定はページ名を付けない（最初に開く画面なので、ここでブックマークされても名前がきれいに残る）。
// 特別会員の専用ページ（portal.kind='member'・docs/vip-member-page.md）は、ページ名（「○○様 専用ページ」）をそのまま使う。
//   例: 山人-yamado- 山田太郎様 専用ページ｜料金カレンダー
export function partnerTitle(
  portal: { facilityName?: string | null; partnerName?: string | null; kind?: 'partner' | 'member' } | null | undefined,
  page?: string
): string {
  const site =
    portal?.kind === 'member'
      ? [portal?.facilityName, portal?.partnerName || '会員さま専用ページ'].filter(Boolean).join(' ')
      : [portal?.facilityName, portal?.partnerName ? `${portal.partnerName}様` : '', '専用予約'].filter(Boolean).join(' ');
  return page ? `${site}｜${page}` : site;
}
