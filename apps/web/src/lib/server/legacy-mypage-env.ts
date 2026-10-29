// 旧 tripla マイページ動線の表示状態を環境変数（wrangler の vars）から作る。判定の本体は $lib/legacy-mypage（純関数）。
import { env } from '$env/dynamic/private';
import { legacyMypageState, type LegacyMypageState } from '$lib/legacy-mypage';

export function legacyMypageFromEnv(now: Date = new Date()): LegacyMypageState {
	return legacyMypageState(now, {
		url: env.LEGACY_MYPAGE_URL,
		urlNishiwaga: env.LEGACY_MYPAGE_URL_NISHIWAGA,
		urlOga: env.LEGACY_MYPAGE_URL_OGA,
		until: env.LEGACY_MYPAGE_UNTIL,
		launchDate: env.BOOK_LAUNCH_DATE
	});
}
