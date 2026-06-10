// Markdown → HTML（設計書 §2.3: 生 HTML 不許可。先にエスケープしてから marked でパース）
import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(src: string): string {
	const escaped = (src ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	return marked.parse(escaped) as string;
}

/** メルマガ等の差込変数をデモ展開 */
export function fillVars(src: string, vars: Record<string, string>): string {
	return src.replace(/\{([^}]+)\}/g, (m, key) => vars[key] ?? m);
}
