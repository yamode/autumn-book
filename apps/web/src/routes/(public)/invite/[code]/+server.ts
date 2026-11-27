// アンバサダーの招待 URL（/invite/<コード>・docs/ambassador.md §3）。
// コードをクッキー ab_invite（30日・最後に開いたものが勝つ）に入れて会員登録へ送る。
// ここではコードが本物かは確かめない（総当たりで持ち主を探られないよう、結べるかは登録の時に DB が決める）。
import { redirect } from '@sveltejs/kit';
import { INVITE_COOKIE, INVITE_COOKIE_MAX_AGE, normalizeInviteCode } from '$lib/ambassador';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ params, cookies, locals, url }) => {
	const code = normalizeInviteCode(params.code);
	if (code) {
		cookies.set(INVITE_COOKIE, code, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: INVITE_COOKIE_MAX_AGE
		});
	}
	// 既に会員なら招待は使えないのでマイページへ
	if (locals.user?.role === 'member') redirect(303, '/account');
	redirect(303, code ? `/auth/register?invite=${code}` : '/auth/register');
};
