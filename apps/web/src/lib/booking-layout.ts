// 予約入力画面の幅と列（取引先ページ /p/[token]/book と公式サイト /booking/hold で共通・2026-11-02 指示）。
// 見た目（差し色）はページで変数（--bk-accent 等・app.css の .bk-*）を決め、幅・列・枠・入力欄の形をそろえる。
// Tailwind が拾えるよう、クラスは文字列のまま書く（組み立てない）。

/** ページの最大幅と左右の余白 */
export const BOOKING_PAGE_CLASS = 'mx-auto max-w-6xl px-4 sm:px-6';
/** 入力（左）と料金のまとめ（右・380px）の 2 列。lg（1024px）から 2 列 */
export const BOOKING_COLUMNS_CLASS = 'grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start';

/** 入力欄（枠の色は --bk-accent。取引先ページは施設の差し色、公式サイトはアクセント色） */
export const BOOKING_INPUT_CLASS =
	'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none transition focus:border-[var(--bk-accent)] focus:ring-2 focus:ring-[var(--bk-accent-soft)]';
/** 入力欄の見出し */
export const BOOKING_LABEL_CLASS = 'mb-1 block text-sm font-medium';
