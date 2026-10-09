// ログイン後などの戻り先（?next=）を同じサイト内の相対パスに限る（2026-10-09・セキュリティレビュー M-1）。
// 外部 URL（https://evil.example）・プロトコル相対（//evil.example）・バックスラッシュ（/\evil.example）を
// そのまま redirect するとオープンリダイレクトになり、正規ドメインを踏み台にしたフィッシングに使われる。
export function safeNext(next: string | null | undefined, fallback: string): string {
	if (!next) return fallback;
	if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
	// 制御文字（改行・タブ等）はブラウザが取り除いて別の解釈になりうるので拒否する
	if (/[\u0000-\u001f\u007f]/.test(next)) return fallback;
	try {
		const base = 'https://book.invalid';
		const u = new URL(next, base);
		if (u.origin !== base) return fallback;
		return u.pathname + u.search + u.hash;
	} catch {
		return fallback;
	}
}
