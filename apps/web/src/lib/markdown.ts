// Markdown → HTML（設計書 §2.3: 生 HTML 不許可。先にエスケープしてから marked でパース）
import { marked } from 'marked';
import { stripMore } from './plan-summary';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(src: string): string {
	// プラン紹介文の一覧用の区切り（<!--more-->）は表示しない
	const escaped = stripMore(src ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return marked.parse(escaped) as string;
}

/** メルマガ等の差込変数をデモ展開 */
export function fillVars(src: string, vars: Record<string, string>): string {
	return src.replace(/\{([^}]+)\}/g, (m, key) => vars[key] ?? m);
}
