import type { PageServerLoad } from './$types';

// 会員プログラム紹介ページ（公開・ログイン不要）。会員なら CTA を出し分ける。
export const load: PageServerLoad = ({ locals }) => {
	return { isMember: locals.user?.role === 'member' };
};
