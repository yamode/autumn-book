import { redirect } from '@sveltejs/kit';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { looksLikePrecheckinToken, precheckinSplashHtml, type SplashLocale } from '$lib/precheckin-splash';
import { resolvePrecheckin, setPrecheckinCookie } from '$lib/server/precheckin';
import type { RequestHandler } from './$types';

// 事前チェックインのご案内メール・SMS のリンク（/ci/<token>）の着地点（docs/pre-checkin.md §4）。
//
// 1) ?go=1 が無いとき: DB に触らず、読み込み中の画面（$lib/precheckin-splash）をすぐ返す（2026-11-15）。
//    その画面が同じ URL に ?go=1 を付けて開き直す。次の画面が届くまでのあいだ、真っ白にならない。
// 2) ?go=1 のとき: トークンを検証し、有効なら httpOnly Cookie（ab_ci）に移して /ci へ 302。以降 URL にトークンは出ない
//    （履歴・共有からの漏洩を防ぐ。/r/c/[token] と同じ）。無効なら /ci?e=<理由>。
export const GET: RequestHandler = async (event) => {
	if (event.url.searchParams.get('go') !== '1' && looksLikePrecheckinToken(event.params.token)) {
		const locale = getLocale();
		return new Response(precheckinSplashHtml(
				event.url.pathname,
				(['ja', 'en', 'zh-TW'] as const).includes(locale as SplashLocale) ? (locale as SplashLocale) : 'ja',
				// ?f=<施設の slug> … 中央に出すロゴを選ぶだけの目印（リンクを作るときに付けている）
				event.url.searchParams.get('f')
			), {
			headers: {
				'content-type': 'text/html; charset=utf-8',
				// トークン入りの URL の画面を、端末にも途中の機器にも残さない
				'cache-control': 'no-store',
				'referrer-policy': 'no-referrer',
				'x-robots-tag': 'noindex, nofollow'
			}
		});
	}
	const r = await resolvePrecheckin(event, event.params.token);
	if ('ctx' in r) {
		setPrecheckinCookie(event.cookies, r.token, r.ctx.expiresAt);
		redirect(302, localizeHref('/ci'));
	}
	redirect(302, localizeHref(`/ci?e=${r.error}`));
};
