// 管理画面のうち、まだ本番データ（Supabase）に繋がっておらずデモストア（メモリ）にしか書けない画面の保存ガード。
// DATA_SOURCE=supabase の環境でデモストアに書くと「保存しました」と出るのに顧客画面には反映されず、
// 再デプロイ・再起動で消える。黙って成功させず、理由を返して止める。
// 対象画面は管理画面レイアウトの navGroups で demoOnly を付けたもの（画面上部にも同じ注意を出す）。
import { fail } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';

export const DEMO_STORE_ONLY =
	'この画面はまだ本番データに繋がっていないため、保存できません（保存してもお客様の画面には反映されません）。';

export function denyDemoStoreWrite() {
	if (DATA_SOURCE !== 'supabase') return null;
	return fail(503, { error: DEMO_STORE_ONLY, message: DEMO_STORE_ONLY });
}
