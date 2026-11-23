import type { PageServerLoad } from './$types';
import { getLocale } from '$lib/paraglide/runtime';
import { loadMemberBenefitTexts } from '$lib/server/site-texts';

// 会員プログラム紹介ページ（公開・ログイン不要）。会員なら CTA を出し分ける。
// 説明文は管理画面（会員特典）で上書きできる（book.site_texts・2026-11-23）。
export const load: PageServerLoad = async ({ locals }) => {
	return { isMember: locals.user?.role === 'member', texts: await loadMemberBenefitTexts(getLocale()) };
};
