import { redirect } from '@sveltejs/kit';
import { localizeHref } from '$lib/paraglide/runtime';
import { resolvePrecheckin, setPrecheckinCookie } from '$lib/server/precheckin';
import type { RequestHandler } from './$types';

// 事前チェックインのご案内メールのリンク（/ci/<token>）の着地点（docs/pre-checkin.md §4）。
// トークンを検証し、有効なら httpOnly Cookie（ab_ci）に移して /ci へ 302。以降 URL にトークンは出ない
// （履歴・共有からの漏洩を防ぐ。/r/c/[token] と同じ）。無効なら /ci?e=<理由>。
export const GET: RequestHandler = async (event) => {
	const r = await resolvePrecheckin(event, event.params.token);
	if ('ctx' in r) {
		setPrecheckinCookie(event.cookies, r.token, r.ctx.expiresAt);
		redirect(302, localizeHref('/ci'));
	}
	redirect(302, localizeHref(`/ci?e=${r.error}`));
};
