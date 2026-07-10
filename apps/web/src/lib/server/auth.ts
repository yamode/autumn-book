// 認証（Phase 1: 管理者 / Phase 2: 会員）。AUTH_MODE で切替する。
//   - demo     … 従来のデモセッション（ワンクリック / 偽造可能な cookie）。dev・移行前の既定。
//   - supabase … Supabase Auth で検証。管理者/スタッフは app_metadata.role、
//                 会員は user_metadata.member + book.members 行で判定する。
//
// Phase 2 では会員も Supabase Auth に載せる（メール6桁OTP → register_member）。
// book スキーマは yamado-one（モバイル会員アプリ）と共有するため、
//   ・会員行の作成は必ず book.register_member RPC 経由（テーブル直 insert 禁止）
//   ・user_id = auth.users.id の 1:1 を崩さない
// パスキーはドメイン確定後（Phase 3）に Supabase 側 RP 設定のうえで有効化する。
import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/private';
// PUBLIC_* は $env/dynamic/private には含まれない（SvelteKit が公開プレフィックスを分離するため）。
import { env as publicEnv } from '$env/dynamic/public';
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { SessionUser } from './session';
import { DATA_SOURCE } from './supabase';

export const AUTH_MODE: 'demo' | 'supabase' = env.AUTH_MODE === 'supabase' ? 'supabase' : 'demo';

// 会員データ・書き込みを Supabase 実データ経路にするか（＝本接続）。
// DATA_SOURCE と AUTH_MODE が両方 supabase のときだけ、マイページ/掲示板/おたよりを
// authenticated クライアントで実データに接続する。それ以外は store.ts（デモ）のまま。
export const MEMBER_SUPABASE: boolean = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

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
 * cookie の JWT を Supabase 側で検証し、認証済みユーザーと cookie 連携クライアントを返す。
 * getUser() は一度だけ呼ぶ（getSession の信用任せではなく Supabase に問い合わせて検証）。
 * 未設定/到達不可/未ログインはすべて null（公開サイトを落とさない安全側設計）。
 */
export async function getSupabaseUser(
	event: RequestEvent
): Promise<{ user: User; client: SupabaseClient } | null> {
	try {
		const client = createSupabaseServerClient(event);
		const {
			data: { user },
			error
		} = await client.auth.getUser();
		if (error || !user) return null;
		return { user, client };
	} catch {
		// Supabase 未設定/到達不可でも公開サイトは落とさない（未ログイン扱い）。
		return null;
	}
}

/** Supabase セッションの解決結果。 */
export interface SupabaseAuthResolution {
	/** 管理者/スタッフ/会員として確定したユーザー（locals.user へ）。 */
	user: SessionUser | null;
	/** OTP 認証は済んだが book.members 未登録のユーザー（/auth/register のプロフィール入力で使う）。 */
	pending: { id: string; email: string } | null;
}

/**
 * Supabase セッションから locals へ載せる SessionUser を解決する。
 *   1. app_metadata.role が admin / staff  → その role（Phase 1）
 *   2. user_metadata.member === true        → member（Phase 2・register_member 済み）
 *   3. それ以外（OTP 済み・未登録）          → pending（会員登録のプロフィール入力へ）
 */
export async function resolveSupabaseSessionUser(event: RequestEvent): Promise<SupabaseAuthResolution> {
	const got = await getSupabaseUser(event);
	if (!got) return { user: null, pending: null };
	const { user } = got;

	const role = (user.app_metadata as { role?: string } | null)?.role;
	if (role === 'admin' || role === 'staff') {
		const name = ((user.user_metadata as { name?: string } | null)?.name ?? user.email ?? '管理者') as string;
		return { user: { id: user.id, role, name }, pending: null };
	}

	const meta = user.user_metadata as { member?: boolean; name?: string } | null;
	if (meta?.member === true) {
		const name = (meta.name ?? 'ゲスト') as string;
		return { user: { id: user.id, role: 'member', name }, pending: null };
	}

	// OTP 認証は済んだが register_member 前（＝会員行なし）。プロフィール入力へ誘導する。
	return { user: null, pending: { id: user.id, email: user.email ?? '' } };
}

/**
 * Supabase セッションから管理者/スタッフのみを解決する（互換 API・Phase 1 の呼び出し向け）。
 * 会員/未登録は null を返す。
 */
export async function getSupabaseAdminUser(event: RequestEvent): Promise<SessionUser | null> {
	const { user } = await resolveSupabaseSessionUser(event);
	return user && (user.role === 'admin' || user.role === 'staff') ? user : null;
}
