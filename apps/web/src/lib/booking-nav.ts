// 予約の流れの「どこから来たか」（プラン詳細の手前のページ）を覚えて、パンくず・戻り先に使う。
// プラン詳細へは「客室・プラン一覧（空室カレンダー）」からも「施設トップのプランカード」「客室ページ」からも来るため、
// 決め打ちで一覧に戻すと実際の経路とずれる。

/** サイト内の相対パスだけ通す（外部・プロトコル相対は捨てる） */
export function safeLocalPath(value: string | null | undefined): string {
	const path = String(value ?? '');
	return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : '';
}

export type ViaCrumb = { href: string; kind: 'plans' | 'room' | 'facility' };

/** プラン詳細の手前のページ → パンくずの1段。施設の外や予約手続き中のページは null */
export function viaCrumb(via: string, facility: { brandSlug: string; slug: string }): ViaCrumb | null {
	const href = safeLocalPath(via);
	if (!href) return null;
	const base = `/${facility.brandSlug}/${facility.slug}`;
	const pathname = href.split(/[?#]/)[0].replace(/\/$/, '');
	if (pathname === `${base}/plans`) return { href, kind: 'plans' };
	if (pathname.startsWith(`${base}/rooms/`)) return { href, kind: 'room' };
	if (pathname === base || (pathname.startsWith(`${base}/`) && !pathname.startsWith(`${base}/plans/`))) return { href, kind: 'facility' };
	return null;
}

/** プラン詳細ごとに手前のページを覚えておく sessionStorage のキー */
export const viaStorageKey = (planPath: string) => `book:via:${planPath}`;

/** 予約入力画面へ経路を渡す Cookie（仮押さえ ID ごと） */
export const HOLD_NAV_COOKIE = 'book_hold_nav';
