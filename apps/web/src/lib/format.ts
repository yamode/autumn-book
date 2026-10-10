export { addDays } from '@autumn-book/core';
import { getLocale } from '$lib/paraglide/runtime';

// 旧関数（互換用 alias）— 新コードは formatDate / formatDateLong / formatPrice を使う
export { formatYen } from '@autumn-book/core';

// ---- 短形式日付: 6/15(月) ---- //

export function formatDateJa(date: string): string {
	const d = new Date(date + 'T00:00:00');
	const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
	return `${d.getMonth() + 1}/${d.getDate()}(${dow})`;
}

/** ロケール対応の短形式日付（例: ja → 6/15(月)、en → Mon 6/15、zh-TW → 6/15(一)） */
export function formatDate(date: string): string {
	const locale = getLocale();
	const d = new Date(date + 'T00:00:00');

	if (locale === 'ja') {
		// ja: 従来表記を維持（Intl の ja-JP 出力は異なるため手組み）
		const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
		return `${d.getMonth() + 1}/${d.getDate()}(${dow})`;
	}
	if (locale === 'zh-TW') {
		const dow = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
		return `${d.getMonth() + 1}/${d.getDate()}(${dow})`;
	}
	// en: Mon 6/15 形式
	return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' }).format(d);
}

// ---- 長形式日付: 2026年6月15日（月） ---- //

export function formatDateLongJa(date: string): string {
	const d = new Date(date + 'T00:00:00');
	const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dow}）`;
}

/** ロケール対応の長形式日付（例: ja → 2026年6月15日（月）、en → Monday, June 15, 2026） */
export function formatDateLong(date: string): string {
	const locale = getLocale();
	const d = new Date(date + 'T00:00:00');

	if (locale === 'ja') {
		// ja: 従来表記を維持
		const dow = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
		return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dow}）`;
	}
	if (locale === 'zh-TW') {
		const dow = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
		return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${dow}）`;
	}
	// en: Monday, June 15, 2026 形式
	return new Intl.DateTimeFormat('en-US', {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	}).format(d);
}

/** 料金の明細の泊の見出し用（ja: 4月15日（水）／ zh-TW: 4月15日（三）／ en: Apr 15 (Wed)）。日付だけなので UTC で読む */
export function formatNightDate(date: string): string {
	const locale = getLocale();
	const d = new Date(date + 'T00:00:00Z');
	if (Number.isNaN(d.getTime())) return date;
	const mo = d.getUTCMonth() + 1;
	const day = d.getUTCDate();
	if (locale === 'ja') return `${mo}月${day}日（${['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()]}）`;
	if (locale === 'zh-TW') return `${mo}月${day}日（${['日', '一', '二', '三', '四', '五', '六'][d.getUTCDay()]}）`;
	const mon = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d);
	const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(d);
	return `${mon} ${day} (${wd})`;
}

// ---- 金額: ¥12,345 ---- //

/** ロケール対応の価格表示（JPY のみ。換算なし）。ja は ¥12,345 形式を維持 */
export function formatPrice(amount: number): string {
	const locale = getLocale();

	if (locale === 'ja') {
		// ja: 従来の ¥ + カンマ区切り表記
		return '¥' + amount.toLocaleString('ja-JP');
	}
	// en / zh-TW: Intl の通貨フォーマット（例: ¥12,345）
	return new Intl.NumberFormat(locale === 'zh-TW' ? 'zh-TW' : 'en-US', {
		style: 'currency',
		currency: 'JPY',
		maximumFractionDigits: 0
	}).format(amount);
}

/** 日本時間（Asia/Tokyo）の今日を YYYY-MM-DD で返す。サーバ（Cloudflare）は UTC なので toISOString では JST 0〜9時が前日になる */
export function todayStr(): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
}
