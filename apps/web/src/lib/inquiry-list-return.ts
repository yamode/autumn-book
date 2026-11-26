// 問い合わせの一覧で最後に開いていた絞り込み（状態・検索語・ページ・過去のやり取り）を覚え、詳細画面の「← 受信トレイ」で戻す（2026-11-27）
const KEY = 'ab_inquiry_list_search';
const ALLOWED = new Set(['status', 'origin', 'q', 'page']);

/** 一覧の URL の ? 以降から、覚えてよい項目だけを残す（よその値は持ち込まない） */
export function inquiryListSearch(search: string): string {
	const src = new URLSearchParams(search);
	const out = new URLSearchParams();
	for (const [k, v] of src) if (ALLOWED.has(k) && v.length <= 100) out.set(k, v);
	const s = out.toString();
	return s ? '?' + s : '';
}

export function rememberInquiryList(search: string) {
	try {
		sessionStorage.setItem(KEY, inquiryListSearch(search));
	} catch {
		/* 覚えられない環境では素の一覧に戻る */
	}
}

export function inquiryListHref(): string {
	try {
		return '/admin/inquiries' + inquiryListSearch(sessionStorage.getItem(KEY) ?? '');
	} catch {
		return '/admin/inquiries';
	}
}
