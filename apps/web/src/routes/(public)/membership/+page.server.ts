import type { PageServerLoad } from './$types';

// 会員プログラム紹介ページ（公開・ログイン不要）。会員なら CTA を出し分けるだけ。
export const load: PageServerLoad = async ({ locals }) => {
	return { isMember: locals.user?.role === 'member' };
};
