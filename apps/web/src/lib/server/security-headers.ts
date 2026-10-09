// 全応答に付けるセキュリティヘッダ（2026-10-09・セキュリティレビュー M-2）。
// Cloudflare Pages の _headers は静的ファイルにしか効かず、SvelteKit が返す画面・API には付かないため hooks で付ける。
//   ・他サイトへの埋め込み禁止（クリックジャッキング対策）: X-Frame-Options と CSP frame-ancestors。
//     同じサイト内の埋め込み（管理画面のプレビュー等）は許す。HP の FAQ は widget.js で読み込むので影響しない
//   ・nosniff: ブラウザに Content-Type を推測させない
//   ・Referrer-Policy: 外部へ URL のパス・クエリを渡さない（取引先ページは portal.ts で no-referrer を付けており、それを優先）
//   ・HSTS: 本番ドメインだけ（プレビューの *.pages.dev には付けない）
// 既に同じヘッダがある応答（請求書 HTML の CSP など）は上書きしない。
// CSP の本格導入（script-src 等）は Stripe・GA4・地図のタイル等の洗い出しが要るため別途（Report-Only から）。
const PRIMARY_HOST = 'book.yamado.app';

export function applySecurityHeaders(response: Response, url: URL): Response {
	const set = (name: string, value: string) => {
		if (!response.headers.has(name)) response.headers.set(name, value);
	};
	try {
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
