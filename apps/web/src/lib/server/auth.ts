// 管理者認証（Phase 1）。AUTH_MODE で切替する。
//   - demo     … 従来のデモセッション（ワンクリック / 偽造可能な cookie）。dev・移行前の既定。
//   - supabase … Supabase Auth（email+パスワード）で管理者を検証。app_metadata.role で admin/staff を判定。
//
// Phase 1 では「管理者/スタッフのみ」を Supabase Auth に載せ、会員側はデモのまま（§Phase 2 で移行）。
// パスキーはドメイン確定後（Phase 3）に Supabase 側 RP 設定のうえで有効化する。
import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/private';
// PUBLIC_* は $env/dynamic/private には含まれない（SvelteKit が公開プレフィックスを分離するため）。
import { env as publicEnv } from '$env/dynamic/public';
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SessionUser } from './session';

export const AUTH_MODE: 'demo' | 'supabase' = env.AUTH_MODE === 'supabase' ? 'supabase' : 'demo';

/** リクエストの cookie に束縛した Supabase Auth クライアント（SSR）。 */
export function createSupabaseServerClient(event: RequestEvent): SupabaseClient {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const key = publicEnv.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です');
	return createServerClient(url, key, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookiesToSet) => {
				for (const { name, value, options } of cookiesToSet) {
					event.cookies.set(name, value, { ...options, path: '/' });
				}
			}
		}
	});
}

/**
 * Supabase セッションから管理者/スタッフを解決する（JWT を Supabase 側で検証）。
 * app_metadata.role が admin / staff のユーザーのみ通す。会員（role なし）は null を返す。
 */
export async function getSupabaseAdminUser(event: RequestEvent): Promise<SessionUser | null> {
	try {
		const supabase = createSupabaseServerClient(event);
		// getUser() は cookie の JWT を Supabase に問い合わせて検証する（getSession の信用任せではない）
		const {
			data: { user },
			error
		} = await supabase.auth.getUser();
		if (error || !user) return null;

		const role = (user.app_metadata as { role?: string } | null)?.role;
		if (role !== 'admin' && role !== 'staff') return null; // 管理権限を持つユーザーのみ

		const name = ((user.user_metadata as { name?: string } | null)?.name ?? user.email ?? '管理者') as string;
		return { id: user.id, role, name };
	} catch {
		// Supabase 未設定/到達不可でも公開サイトは落とさない（管理者が解決できないだけ＝未ログイン扱い）。
		// 毎リクエスト経由するため、ここで例外を握りつぶすのは安全側の設計。
		return null;
	}
}
