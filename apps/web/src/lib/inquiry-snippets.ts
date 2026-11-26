// 問い合わせの返信の定型文（2026-11-27）。返信欄で「/」を打つと候補を出し、選ぶと差し込み項目を埋めて入れる。
// 差し込みに使う値が無いときは【要確認：…】を残す（【要確認】が残っていると送信できないので、埋め忘れたまま送られない）
export type InquirySnippet = { id: string; title: string; body: string; sort_order: number };
export type SnippetContext = { guestLabel: string; assignee: string; checkIn?: string | null; checkOut?: string | null };

export const SNIPPET_VARIABLES = ['お名前', '担当者名', 'チェックイン日', 'チェックアウト日'] as const;

const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
/** 2026-12-05 → 12月5日（金） */
export function snippetDate(iso: string | null | undefined): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
	if (!m) return '';
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return `${Number(m[2])}月${Number(m[3])}日（${WEEK[d.getUTCDay()]}）`;
}

/** {お名前} などを埋める。分からない値は【要確認：…】のまま残す */
export function expandSnippet(body: string, ctx: SnippetContext): string {
	const values: Record<string, string> = {
		お名前: ctx.guestLabel.trim(),
		担当者名: ctx.assignee.trim(),
		チェックイン日: snippetDate(ctx.checkIn),
		チェックアウト日: snippetDate(ctx.checkOut)
	};
	return body.replace(/[{｛](お名前|担当者名|チェックイン日|チェックアウト日)[}｝]/g, (_, key: string) => values[key] || `【要確認：${key}】`);
}

/**
 * 返信欄の入力位置の直前が「/検索語」なら、その開始位置と検索語を返す。
 * 行の先頭か空白の直後の「/」だけを見る（URL や日付の「/」では開かない）
 */
export function slashQuery(textBeforeCaret: string): { start: number; query: string } | null {
	const m = /(^|[\s　])[/／]([^\s　/／]{0,20})$/.exec(textBeforeCaret);
	if (!m) return null;
	return { start: textBeforeCaret.length - m[2].length - 1, query: m[2] };
}

const fold = (s: string) =>
	s
		.normalize('NFKC')
		.toLowerCase()
		.replace(/\s+/g, '')
		.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** 名前（先）・本文（後）で絞り込む。全角半角・カタカナひらがなの違いは無視 */
export function filterSnippets(list: InquirySnippet[], query: string, limit = 8): InquirySnippet[] {
	const q = fold(query);
	const sorted = [...list].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title, 'ja'));
	if (!q) return sorted.slice(0, limit);
	const byTitle = sorted.filter((s) => fold(s.title).includes(q));
	const byBody = sorted.filter((s) => !byTitle.includes(s) && fold(s.body).includes(q));
	return [...byTitle, ...byBody].slice(0, limit);
}

/** 本文の「/検索語」を定型文に置き換える。戻り値は新しい本文と入力位置 */
export function insertSnippet(body: string, caret: number, start: number, text: string): { body: string; caret: number } {
	const next = body.slice(0, start) + text + body.slice(caret);
	return { body: next, caret: start + text.length };
}
