// 公開ホスト（本番ドメイン）。hooks.server.ts の旧ドメイン転送と、お客様へ送るリンク（事前チェックインの SMS・メール）で使う。
export const PRIMARY_ORIGIN = 'https://book.yamado.app';

/**
 * お客様へ送るリンクのホスト。ローカル開発（localhost）はそのまま、それ以外（本番・プレビューデプロイ）は本番ドメイン。
 * プレビューから送っても DB は同じなので、本番のリンクで開ける（プレビューの URL をお客様に渡さない）。
 */
export function customerLinkOrigin(url: URL): string {
	if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return url.origin;
	return PRIMARY_ORIGIN;
}
