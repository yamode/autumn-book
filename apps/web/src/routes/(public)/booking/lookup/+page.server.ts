// ご予約の確認（案内ページ）。照会フォームは作らない（個人情報・トークンを受けない）。
// docs/launch-tripla-cutover.md §3.3。旧 tripla マイページの段は LEGACY_MYPAGE_URL* が空なら出さず、LEGACY_MYPAGE_UNTIL 以後は「終了しました」に変わる。
import { facilities } from '$lib/server/store';
import { legacyMypageFromEnv } from '$lib/server/legacy-mypage-env';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => ({
	legacy: legacyMypageFromEnv(),
	isMember: locals.user?.role === 'member',
	phones: facilities.map((f) => ({ slug: f.slug, phone: f.phone }))
});
