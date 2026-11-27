import { json, redirect } from '@sveltejs/kit';
import { getLocale, localizeHref } from '$lib/paraglide/runtime';
import { looksLikePrecheckinToken, precheckinSplashHtml, PRECHECKIN_ENTRANCE_COOKIE, type SplashLocale } from '$lib/precheckin-splash';
import { DEMO_PRECHECKIN_FACILITY_SLUG, isDemoPrecheckinToken } from '$lib/precheckin';
import { clearDemoAnswers, resolvePrecheckin, setPrecheckinCookie } from '$lib/server/precheckin';
import { clearDemoBath } from '$lib/server/precheckin-demo-bath';
import type { RequestHandler } from './$types';

// 事前チェックインのご案内メール・SMS のリンク（/ci/<token>）の着地点（docs/pre-checkin.md §4）。
//
// 1) ?go=1 が無いとき: DB に触らず、読み込み中の画面（$lib/precheckin-splash）をすぐ返す（2026-11-15）。
//    その画面が同じ URL に ?go=1 を付けて開き直す。次の画面が届くまでのあいだ、真っ白にならない。
// 2) ?go=1 のとき: トークンを検証して httpOnly Cookie（ab_ci）に移し、非同期なら遷移先を返す。以降 URL にトークンは出ない
//    （履歴・共有からの漏洩を防ぐ。/r/c/[token] と同じ）。無効なら /ci?e=<理由>。
export const GET: RequestHandler = async (event) => {
	if (event.url.searchParams.get('go') !== '1' && looksLikePrecheckinToken(event.params.token)) {
		const locale = getLocale();
		return new Response(precheckinSplashHtml(
				event.url.pathname,
				(['ja', 'en', 'zh-TW'] as const).includes(locale as SplashLocale) ? (locale as SplashLocale) : 'ja',
				// 見本の施設は固定。本予約リンクの ?f はロゴ表示だけに使う。
				isDemoPrecheckinToken(event.params.token)
					? DEMO_PRECHECKIN_FACILITY_SLUG
					: event.url.searchParams.get('f')
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
		if (isDemoPrecheckinToken(r.token)) {
			clearDemoAnswers(event.cookies);
			clearDemoBath(event.cookies);
		}
		setPrecheckinCookie(event.cookies, r.token, r.ctx.expiresAt);
		// 「いまリンクから入った」印（20 秒だけ）。/ci の最初の表示で、ゆっくり現れる演出を出すのに使う（+layout.server.ts が読んで消す）
		event.cookies.set(PRECHECKIN_ENTRANCE_COOKIE, '1', { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 20 });
	}
	const location = localizeHref('ctx' in r ? '/ci' : `/ci?e=${r.error}`);
	if (event.url.searchParams.get('go') === '1' && event.request.headers.get('accept') === 'application/json') {
		return json({ location }, { headers: { 'cache-control': 'no-store', vary: 'Accept' } });
	}
	redirect(302, location);
};
