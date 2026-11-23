// 全応答に付けるセキュリティヘッダ（2026-10-09・セキュリティレビュー M-2）。
// Cloudflare Pages の _headers は静的ファイルにしか効かず、SvelteKit が返す画面・API には付かないため hooks で付ける。
//   ・他サイトへの埋め込み禁止（クリックジャッキング対策）: X-Frame-Options と CSP frame-ancestors。
//     同じサイト内の埋め込み（管理画面のプレビュー等）は許す。HP の FAQ は widget.js で読み込むので影響しない
//   ・nosniff: ブラウザに Content-Type を推測させない
//   ・Referrer-Policy: 外部へ URL のパス・クエリを渡さない（取引先ページは portal.ts で same-origin を付けており、それを優先）
//   ・HSTS: 本番ドメインだけ（プレビューの *.pages.dev には付けない）
// 既に同じヘッダがある応答（請求書 HTML の CSP など）は上書きしない。
// CSP の本体（script-src 等）は svelte.config.js の kit.csp（2026-11-23 レビュー L-1 で強制へ）。画面には SvelteKit が付ける。
const PRIMARY_HOST = 'book.yamado.app';

// 埋め込みを一切許さない画面（AI 連携の同意画面）。SvelteKit の CSP（frame-ancestors 'self'）を 'none' に替える。
// 画面の setHeaders で付けた CSP は SvelteKit が自分の CSP で上書きするため、ここで直す。
const FRAME_DENY = [/^\/booking-mcp\/oauth\/authorize\/?$/, /^\/booking-mcp\/muse\//];
// srcdoc の iframe でスクリプトを動かす画面（メルマガの編集・プレビュー）。srcdoc は親の CSP を引き継ぎ、
// 中の nonce つきスクリプトが止まるため、ここだけ Report-Only に戻す（frame-ancestors は強制のまま）。管理画面（二段階認証の内側）だけ。
const CSP_REPORT_ONLY = [/^\/admin\/mail(?:\/|$)/];

/** SvelteKit が付けた強制の CSP を、画面ごとの例外に合わせて直す */
function adjustPageCsp(headers: Headers, pathname: string): void {
	const csp = headers.get('content-security-policy');
	if (!csp || !/script-src/.test(csp)) return;
	if (FRAME_DENY.some((r) => r.test(pathname))) {
		headers.set('content-security-policy', csp.replace(/frame-ancestors[^;]*/, "frame-ancestors 'none'"));
		headers.set('x-frame-options', 'DENY');
	} else if (CSP_REPORT_ONLY.some((r) => r.test(pathname))) {
		headers.set('content-security-policy-report-only', csp.replace(/;?\s*frame-ancestors[^;]*/, ''));
		headers.set('content-security-policy', "frame-ancestors 'self'");
	}
}

export function applySecurityHeaders(response: Response, url: URL): Response {
	const set = (name: string, value: string) => {
		if (!response.headers.has(name)) response.headers.set(name, value);
	};
	try {
		adjustPageCsp(response.headers, url.pathname);
		set('x-content-type-options', 'nosniff');
		set('x-frame-options', 'SAMEORIGIN');
		set('content-security-policy', "frame-ancestors 'self'");
		set('referrer-policy', 'strict-origin-when-cross-origin');
		if (url.hostname === PRIMARY_HOST) set('strict-transport-security', 'max-age=31536000; includeSubDomains');
		return response;
	} catch {
		// ヘッダが変更不可の応答（fetch をそのまま返した等）は複製して付け直す
		const copy = new Response(response.body, response);
		return applySecurityHeaders(copy, url);
	}
}
