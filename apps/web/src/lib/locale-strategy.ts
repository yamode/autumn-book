import {
	baseLocale,
	cookieMaxAge,
	cookieName,
	defineCustomClientStrategy,
	defineCustomServerStrategy,
	extractLocaleFromUrl,
	isLocale
} from '$lib/paraglide/runtime';

// 言語の「持ち越し」戦略（2026-11-02）。
// 既定の url 戦略は ja を接頭辞なしのキャッチオールにしているため、接頭辞の無いリンク（href="/plans" 等）を
// 押すと cookie に English が入っていても必ず ja になっていた。そこで url より先にこの戦略を置き、
//   1. URL に /en・/zh-TW の接頭辞があればその言語（共有されたリンクはそのまま開ける）
//   2. 接頭辞が無ければ、公式サイト側のページに限り cookie（言語切替で保存した言語）を使う
// とする。ページ（document）の要求なら paraglideMiddleware が /en/... へ 307 で付け替え、
// クライアント遷移でも getLocale() が cookie の言語を返すので、表示言語が保たれる。
export const STICKY_LOCALE_STRATEGY = 'custom-stickyLocale';

// 日本語固定の画面（管理画面・取引先ページ・API）は cookie を見ず、従来どおり URL だけで決める
const NON_STICKY_PREFIXES = ['/admin', '/partner', '/p', '/api'];

function isStickyPath(pathname: string): boolean {
	return !NON_STICKY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function readLocaleCookie(cookieHeader: string | null | undefined): string | undefined {
	return cookieHeader
		?.split(';')
		.map((c) => c.trim())
		.find((c) => c.startsWith(`${cookieName}=`))
		?.slice(cookieName.length + 1);
}

/** URL と cookie から持ち越す言語を決める。決まらなければ undefined（次の url 戦略で ja になる） */
export function resolveStickyLocale(url: string, cookieHeader: string | null | undefined): string | undefined {
	const fromUrl = extractLocaleFromUrl(url);
	if (fromUrl && fromUrl !== baseLocale) return fromUrl;
	if (!isStickyPath(new URL(url).pathname)) return undefined;
	const fromCookie = readLocaleCookie(cookieHeader);
	return fromCookie && isLocale(fromCookie) ? fromCookie : undefined;
}

defineCustomServerStrategy(STICKY_LOCALE_STRATEGY, {
	getLocale: (request) => (request ? resolveStickyLocale(request.url, request.headers.get('cookie')) : undefined)
});

defineCustomClientStrategy(STICKY_LOCALE_STRATEGY, {
	getLocale: () =>
		typeof window === 'undefined' ? undefined : resolveStickyLocale(window.location.href, document.cookie),
	// 言語の cookie を保存する（言語切替の setLocale と、ページを開いたときの初回判定から呼ばれる）。
	// 日本語固定の画面では書かない（管理画面を開いただけで公式サイトの言語が ja に戻らないように）
	setLocale: (locale) => {
		if (typeof document === 'undefined' || !isStickyPath(window.location.pathname)) return;
		document.cookie = `${cookieName}=${locale}; path=/; max-age=${cookieMaxAge}`;
	}
});
