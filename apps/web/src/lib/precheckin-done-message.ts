// 事前チェックイン完了画面（/ci/done）に出す「施設からのご案内」（2026-11-28）。
// 保存先は book.precheckin_settings の done_message（日本語）/ done_message_en / done_message_zh（繁体中国語）。
// 編集は管理画面（/admin/precheckin）。ここは純粋な部分（言語ごとの出し分け・URL のリンク化）だけを持つ。

export type DoneMessage = { ja: string; en: string; zh: string };

export const DONE_MESSAGE_MAX = 2000;

export const EMPTY_DONE_MESSAGE: DoneMessage = { ja: '', en: '', zh: '' };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** DB の行（無ければ null）を、空文字で埋めた形にそろえる */
export function normalizeDoneMessage(row: unknown): DoneMessage {
	if (!row || typeof row !== 'object') return { ...EMPTY_DONE_MESSAGE };
	const r = row as Record<string, unknown>;
	return { ja: str(r.done_message), en: str(r.done_message_en), zh: str(r.done_message_zh) };
}

/**
 * お客様の言語で出す本文。空の言語は 繁中 → 英語 → 日本語、英語 → 日本語 の順に落とす。
 * どれも空なら ''（＝案内の枠ごと出さない）。
 */
export function doneMessageFor(msg: DoneMessage, locale: string): string {
	if (locale === 'zh-TW') return msg.zh || msg.en || msg.ja;
	if (locale === 'en') return msg.en || msg.ja;
	return msg.ja;
}

export type TextPart = { text: string; href?: string };

/**
 * 本文を「ふつうの文字」と「http(s) の URL」に分ける（画面は URL だけリンクにする）。
 * HTML としては扱わない（{@html} を使わない）ので、施設が入れた文字がそのまま文字として出る。
 * 末尾の句読点・閉じ括弧は URL に含めない。
 */
export function linkifyParts(text: string): TextPart[] {
	const parts: TextPart[] = [];
	const re = /https?:\/\/[^\s<>"'（）「」、。]+/g;
	let last = 0;
	for (const m of text.matchAll(re)) {
		let url = m[0];
		const trail = url.match(/[.,;:!?)\]}]+$/);
		if (trail) url = url.slice(0, -trail[0].length);
		const start = m.index ?? 0;
		if (start > last) parts.push({ text: text.slice(last, start) });
		parts.push({ text: url, href: url });
		last = start + url.length;
	}
	if (last < text.length) parts.push({ text: text.slice(last) });
	return parts;
}
