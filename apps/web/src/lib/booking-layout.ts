// 予約入力画面の幅と列（取引先ページ /p/[token]/book と公式サイト /booking/hold で共通・2026-11-02 指示）。
// 見た目（色・部品）はそれぞれのまま、ページの最大幅・左右の余白・2 列の幅と切り替わる画面幅だけをそろえる。
// Tailwind が拾えるよう、クラスは文字列のまま書く（組み立てない）。

/** ページの最大幅と左右の余白 */
export const BOOKING_PAGE_CLASS = 'mx-auto max-w-6xl px-4 sm:px-6';
/** 入力（左）と料金のまとめ（右・380px）の 2 列。lg（1024px）から 2 列 */
export const BOOKING_COLUMNS_CLASS = 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start';
