// Markdown → HTML（設計書 §2.3: 生 HTML 不許可。先にエスケープしてから marked でパース）
// 2026-10-17: 赤字（==文字==）を追加。リンクは http(s)・tel・mailto と サイト内（/…）だけ通す（javascript: 等は文字だけにする）
import { marked, type Tokens } from 'marked';
import { stripMore } from './plan-summary';

/** 赤字の色（メール本文でも効くよう、クラスではなく style で付ける） */
export const MD_RED = '#dc2626';

const SAFE_HREF = /^(https?:\/\/|tel:|mailto:|\/(?!\/)|#)/i;

marked.use({
	gfm: true,
	breaks: true,
	extensions: [
		{
			// **太字**（エディタの「B」ボタンが入れる）。2026-10-17: 日本語の文中で効かないことがあったため自前で拾う。
			// CommonMark の決まりでは、閉じる ** の内側が記号（」）など）で外側が文字だと太字にならない
			// （例:「料金は**¥1,000（税込）**です」）。日本語では普通の書き方なので、前後の文字を問わず ** と ** の間を太字にする。
			// 開く ** の直後・閉じる ** の直前が空白のときと、*** の並びは従来どおり marked に任せる
			name: 'strongJa',
			level: 'inline',
			start(src: string) {
				const i = src.indexOf('**');
				return i < 0 ? undefined : i;
			},
			tokenizer(src: string) {
				const m = /^\*\*(?=[^\s*])([\s\S]*?[^\s*\\])\*\*(?!\*)/.exec(src);
				if (!m) return undefined;
				return { type: 'strongJa', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
			},
			renderer(token) {
				return `<strong>${this.parser.parseInline(token.tokens ?? [])}</strong>`;
			}
		},
		{
			// ==赤字== （エディタの「赤字」ボタンが入れる）
			name: 'red',
			level: 'inline',
			start(src: string) {
				const i = src.indexOf('==');
				return i < 0 ? undefined : i;
			},
			tokenizer(src: string) {
				const m = /^==(?=\S)([\s\S]*?\S)==/.exec(src);
				if (!m) return undefined;
				return { type: 'red', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
			},
			renderer(token) {
				return `<span style="color:${MD_RED};font-weight:600">${this.parser.parseInline(token.tokens ?? [])}</span>`;
			}
		}
	],
	renderer: {
		link(token: Tokens.Link) {
			const text = this.parser.parseInline(token.tokens);
			// エスケープ済みの本文から来るので & は &amp; のまま。危ない形のリンクは文字だけ残す
			const href = token.href.trim();
			if (!SAFE_HREF.test(href)) return text;
			const title = token.title ? ` title="${token.title.replace(/"/g, '&quot;')}"` : '';
			return `<a href="${href.replace(/"/g, '%22')}"${title}>${text}</a>`;
		}
	}
});

export function renderMarkdown(src: string): string {
	// プラン紹介文の一覧用の区切り（<!--more-->）は表示しない
	const escaped = stripMore(src ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return marked.parse(escaped) as string;
}

/** メルマガ等の差込変数をデモ展開 */
export function fillVars(src: string, vars: Record<string, string>): string {
	return src.replace(/\{([^}]+)\}/g, (m, key) => vars[key] ?? m);
}
