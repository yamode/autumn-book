// 認証（Phase 1: 管理者 / Phase 2: 会員）。AUTH_MODE で切替する。
//   - demo     … 従来のデモセッション（ワンクリック / 偽造可能な cookie）。dev・移行前の既定。
//   - supabase … Supabase Auth で検証。管理者/スタッフは app_metadata.role、
//                 会員は user_metadata.member または book.members 行で判定する。
//
// Phase 2 では会員も Supabase Auth に載せる（メール6桁OTP → register_member）。
// book スキーマは yamado-one（モバイル会員アプリ）と共有するため、
//   ・会員行の作成は必ず book.register_member RPC 経由（テーブル直 insert 禁止）
//   ・user_id = auth.users.id の 1:1 を崩さない
// 管理画面のパスキーは Book のサーバで検証する（lib/server/admin-passkeys.ts・Supabase 標準のパスキーは使わない）。
import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/private';
// PUBLIC_* は $env/dynamic/private には含まれない（SvelteKit が公開プレフィックスを分離するため）。
import { env as publicEnv } from '$env/dynamic/public';
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { SessionUser } from './session';
import { DATA_SOURCE } from './supabase';
import { parseAdminMfaRequired, type AdminAal } from '$lib/admin-mfa';
import { isBanned } from '$lib/admin-passkey';
import { TtlCache } from './ttl-cache';
import { adminPasskeyState } from './admin-passkeys';

export const AUTH_MODE: 'demo' | 'supabase' = env.AUTH_MODE === 'supabase' ? 'supabase' : 'demo';

// 会員データ・書き込みを Supabase 実データ経路にするか（＝本接続）。
// DATA_SOURCE と AUTH_MODE が両方 supabase のときだけ、マイページ/掲示板/おたよりを
// authenticated クライアントで実データに接続する。それ以外は store.ts（デモ）のまま。
export const MEMBER_SUPABASE: boolean = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

// 管理面を Supabase の実データ＋実認証で動かすか。
// アプリ運用画面（/admin/app・push・coupons・preferences）は SECURITY DEFINER RPC を
// cookie 束縛の authenticated クライアントから呼ぶため、これが false のときは機能ごと無効化する。
// （デモ会員は user_id も device_tokens も持たず、通知を「送った体」にしかできない）
export const ADMIN_SUPABASE: boolean = DATA_SOURCE === 'supabase' && AUTH_MODE === 'supabase';

// 管理画面の二段階認証（TOTP）を全員に必須にするか（docs/auth-hardening.md §7.2・M7）。
// 既定 false＝登録は任意（登録した人だけ毎回コードを求める）。true にすると未登録の admin / staff は
// /admin/security で登録するまで他の画面を開けない。本番は wrangler.jsonc の vars で切り替える。
export function adminMfaRequired(): boolean {
	return parseAdminMfaRequired(env.ADMIN_MFA_REQUIRED);
}

/** Book の Supabase Auth セッション cookie 名（RMS の共有 cookie と衝突させない）。会員（公開サイト・マイページ）用。 */
export const BOOK_AUTH_COOKIE = 'sb-autumn-book-auth-token';
/**
 * 管理画面（/admin）用のセッション cookie 名（2026-11-22）。
 * 以前は会員と同じ cookie に入れていたため、同じブラウザでマイページに会員でログインすると管理画面のセッションが上書きされ、
 * 管理画面にログインし直すと今度はマイページが切れていた（本番の記録で、会員ログインの直後に毎回管理画面がログイン画面へ戻っていた）。
 * 名前を分けて、管理画面と会員のログインを同じブラウザで同時に保てるようにする。
 */
export const BOOK_ADMIN_AUTH_COOKIE = 'sb-autumn-book-admin-auth-token';

/** どちらのセッション cookie を使うか。管理画面（/admin 配下）は admin、それ以外は member */
export type AuthCookieKind = 'member' | 'admin';
export function authCookieKindFor(pathname: string): AuthCookieKind {
	return pathname === '/admin' || pathname.startsWith('/admin/') ? 'admin' : 'member';
}
function cookieNameOf(kind: AuthCookieKind): string {
	return kind === 'admin' ? BOOK_ADMIN_AUTH_COOKIE : BOOK_AUTH_COOKIE;
}
/** その名前のセッション cookie（分割された .0 .1 … を含む）がリクエストにあるか */
export function hasAuthCookie(event: Pick<RequestEvent, 'cookies'>, kind: AuthCookieKind): boolean {
	const name = cookieNameOf(kind);
	return event.cookies.getAll().some((c) => c.value && (c.name === name || (c.name.startsWith(name + '.') && /^\d+$/.test(c.name.slice(name.length + 1)))));
}

/** @supabase/ssr の既定と同じ cookie の属性（会員の cookie から管理画面の cookie へ移すときに使う） */
const AUTH_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/**
 * 管理画面の cookie がまだ無く、会員の cookie に運営（admin / staff）のセッションが入っているとき（cookie を分ける前にログインした人）、
 * そのセッションを管理画面の cookie へ移す（コピーして元を消す。同じ refresh token を2か所に残さない）。
 * 移したら true。呼び出し側は、会員の cookie のセッションが運営のものだと確かめてから呼ぶこと。
 */
export function moveLegacyAdminCookie(event: Pick<RequestEvent, 'cookies' | 'url'>): boolean {
	if (hasAuthCookie(event, 'admin')) return false;
	const from = BOOK_AUTH_COOKIE;
	const parts = event.cookies
		.getAll()
		.filter((c) => c.value && (c.name === from || (c.name.startsWith(from + '.') && /^\d+$/.test(c.name.slice(from.length + 1)))));
	if (!parts.length) return false;
	const secure = event.url.protocol === 'https:';
	for (const c of parts) {
		const suffix = c.name.slice(from.length);
		event.cookies.set(BOOK_ADMIN_AUTH_COOKIE + suffix, c.value, { path: '/', sameSite: 'lax', httpOnly: false, secure, maxAge: AUTH_COOKIE_MAX_AGE });
		event.cookies.delete(c.name, { path: '/' });
	}
	return true;
}

/**
 * リクエストの cookie に束縛した Supabase Auth クライアント（SSR）。
 * kind を省くと、管理画面（/admin 配下）は管理画面の cookie、それ以外は会員の cookie を使う。
 */
export function createSupabaseServerClient(event: RequestEvent, kind: AuthCookieKind = authCookieKindFor(event.url.pathname)): SupabaseClient {
	const url = publicEnv.PUBLIC_SUPABASE_URL;
	const key = publicEnv.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	if (!url || !key) throw new Error('PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です');
	return createServerClient(url, key, {
		// cookie 名を Book 専用にする。autumn-rms は本番で auth cookie を Domain=.yamado.app で共有している
		// （アプリ切替の再ログイン不要化）。既定名のままだと book.yamado.app に RMS の cookie と Book の cookie が
		// 同名で2つ届き、先に作られた RMS 側（運営スタッフ）のセッションが読まれて、会員がログインしても
		// ログイン画面へ戻される（2026-09-26 本番で発生）。会員と運営のセッションを混ぜないため分ける。
		// さらに管理画面と会員でも名前を分ける（2026-11-22・BOOK_ADMIN_AUTH_COOKIE の説明）。
		cookieOptions: { name: cookieNameOf(kind) },
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
	/** 管理者/スタッフのときだけ: セッションの認証レベルと登録済みの第2要素の数（二段階認証の関所に使う）。 */
	adminAal: AdminAal | null;
}

// ---------------------------------------------------------------------------
// ログインの確認（2026-10-18 高速化）
//   以前は画面遷移のたびに getUser()（Supabase の認証サーバへの往復）をしていた。
//   いまは getClaims() でアクセストークンの署名をその場で確かめる（ES256・公開鍵は auth-js が isolate 内で覚える＝往復なし）。
//   管理者/スタッフは、権限の外し忘れ・利用停止・第2要素の数を取りこぼさないよう、認証サーバの最新の user を
//   ユーザーごとに 60 秒だけ覚えて使う（ずれは最大 60 秒）。会員の扱いは従来どおり。
// ---------------------------------------------------------------------------
type Claims = {
	sub: string;
	email?: string;
	aal?: string;
	session_id?: string;
	app_metadata?: { role?: string } | null;
	user_metadata?: { member?: boolean; name?: string } | null;
};

const staffUserCache = new TtlCache<User | null>(60_000);

/** 管理者/スタッフの最新の user（認証サーバの値・60 秒覚える）。読めなければ null */
async function freshStaffUser(client: SupabaseClient, userId: string): Promise<User | null> {
	const hit = staffUserCache.get(userId);
	if (hit !== undefined) return hit;
	try {
		const { data, error } = await client.auth.getUser();
		const user = !error && data.user?.id === userId ? data.user : null;
		// 確かめられた結果だけ覚える。通信の失敗など一時的なエラーで「管理者でない」を 60 秒覚えると、
		// その間の保存がすべて「権限がありません」になる（2026-11-02）。外された人は error なしで別の値が返る
		if (!error) staffUserCache.set(userId, user);
		return user;
	} catch {
		return null;
	}
}

/** 権限・第2要素を変えたあと、すぐ反映させたいとき（同じ isolate のぶん） */
export function forgetStaffUser(userId?: string): void {
	if (userId) staffUserCache.delete(userId);
	else staffUserCache.clear();
}

/**
 * 管理者/スタッフのセッションの認証レベル（docs/auth-hardening.md §7.2）。
 * - jwtAal / sessionId は getClaims() で署名を確かめたトークンのクレーム。
 * - 第2要素の数は認証サーバの user.factors の verified（freshStaffUser・60 秒覚える）。
 * - パスキー（lib/server/admin-passkeys.ts）も第2要素に数え、このセッションをパスキーで確認済みなら aal2 とする。
 * - 読めないときは「登録なし・aal1」扱い（required=false なら通る＝既存のログインを止めない）。
 */
async function readAdminAal(claims: Claims, user: User): Promise<AdminAal> {
	const totpFactors = (user.factors ?? []).filter((f) => f.status === 'verified').length;
	const jwtAal = claims.aal ?? null;
	const sessionId = typeof claims.session_id === 'string' ? claims.session_id.toLowerCase() : null;
	const pk = await adminPasskeyState(user.id, sessionId);
	return {
		current: pk.verified ? 'aal2' : jwtAal,
		verifiedFactors: totpFactors + pk.passkeys,
		totpFactors,
		passkeys: pk.passkeys,
		jwtAal,
		sessionId
	};
}

/**
 * Supabase セッションから locals へ載せる SessionUser を解決する。
 *   1. app_metadata.role が admin / staff  → その role（認証サーバの最新の値で確かめる）
 *   2. user_metadata.member === true        → member（Phase 2・register_member 済み）
 *   3. フラグがなくても book.my_profile が通る → member（別アプリで登録した会員）
 *   4. それ以外（OTP 済み・未登録）          → pending（会員登録のプロフィール入力へ）
 */
export async function resolveSupabaseSessionUser(event: RequestEvent, kind: AuthCookieKind = authCookieKindFor(event.url.pathname)): Promise<SupabaseAuthResolution> {
	let client: SupabaseClient;
	let claims: Claims;
	try {
		client = createSupabaseServerClient(event, kind);
		const { data, error } = await client.auth.getClaims();
		if (error || !data?.claims?.sub) return { user: null, pending: null, adminAal: null };
		claims = data.claims as unknown as Claims;
	} catch {
		// Supabase 未設定/到達不可でも公開サイトは落とさない（未ログイン扱い）
		return { user: null, pending: null, adminAal: null };
	}

	// トークンの役割が admin / staff なら、認証サーバの最新の値で確かめる（外された・停止された人を通さない）
	const claimRole = claims.app_metadata?.role;
	if (claimRole === 'admin' || claimRole === 'staff') {
		const user = await freshStaffUser(client, claims.sub);
		if (!user || isBanned((user as { banned_until?: string | null }).banned_until)) return { user: null, pending: null, adminAal: null };
		const role = (user.app_metadata as { role?: string } | null)?.role;
		if (role === 'admin' || role === 'staff') {
			const name = ((user.user_metadata as { name?: string } | null)?.name ?? user.email ?? '管理者') as string;
			return { user: { id: user.id, role, name }, pending: null, adminAal: await readAdminAal(claims, user) };
		}
		// 権限を外された人は、以下の会員の判定へ
	}

	const meta = claims.user_metadata ?? null;
	if (meta?.member === true) {
		const name = (meta.name ?? 'ゲスト') as string;
		return { user: { id: claims.sub, role: 'member', name }, pending: null, adminAal: null };
	}

	// 他アプリ経由の会員や metadata 同期に失敗した会員も、実際の会員行で解決する。
	// OTP 検証後に my_profile が成功しても metadata だけを見るとログインへ戻ってしまう。
	const { data: profile, error } = await client.schema('book').rpc('my_profile');
	if (!error && profile?.user_id === claims.sub) {
		const name = (profile.name as string | null) ?? meta?.name ?? 'ゲスト';
		return { user: { id: claims.sub, role: 'member', name }, pending: null, adminAal: null };
	}

	// OTP 認証は済んだが register_member 前（＝会員行なし）。プロフィール入力へ誘導する。
	return { user: null, pending: { id: claims.sub, email: claims.email ?? '' }, adminAal: null };
}

const NO_SESSION: SupabaseAuthResolution = { user: null, pending: null, adminAal: null };
const isStaffResolution = (r: SupabaseAuthResolution) => r.user?.role === 'admin' || r.user?.role === 'staff';

/**
 * リクエストのログインを決める（hooks から呼ぶ・2026-11-22 に管理画面と会員の cookie を分けた）。
 * - 管理画面（/admin 配下）: 管理画面の cookie だけを見る。まだ無く、会員の cookie に運営のセッションがあれば（分ける前にログインした人）
 *   管理画面の cookie へ移す。会員のセッションは管理画面では使わない。
 * - それ以外: 会員の cookie を見る。会員でログインしていなければ、管理画面の cookie の運営を user にする（今までどおりプレビュー等が動く）。
 *   運営は会員でログイン中でも staff に入れる。
 */
export async function resolveRequestSessions(event: RequestEvent): Promise<SupabaseAuthResolution & { staff: { user: SessionUser; adminAal: AdminAal | null } | null }> {
	if (authCookieKindFor(event.url.pathname) === 'admin') {
		let r = hasAuthCookie(event, 'admin') ? await resolveSupabaseSessionUser(event, 'admin') : NO_SESSION;
		if (!r.user && !hasAuthCookie(event, 'admin') && hasAuthCookie(event, 'member')) {
			const legacy = await resolveSupabaseSessionUser(event, 'member');
			if (isStaffResolution(legacy) && moveLegacyAdminCookie(event)) r = legacy;
		}
		if (!isStaffResolution(r)) r = NO_SESSION;
		return { ...r, pending: null, staff: r.user ? { user: r.user, adminAal: r.adminAal } : null };
	}
	const member = hasAuthCookie(event, 'member') ? await resolveSupabaseSessionUser(event, 'member') : NO_SESSION;
	const admin = hasAuthCookie(event, 'admin') ? await resolveSupabaseSessionUser(event, 'admin') : NO_SESSION;
	const staffRes = isStaffResolution(admin) ? admin : isStaffResolution(member) ? member : null;
	const staff = staffRes?.user ? { user: staffRes.user, adminAal: staffRes.adminAal } : null;
	if (member.user || member.pending) return { ...member, staff };
	return { ...(isStaffResolution(admin) ? admin : NO_SESSION), pending: null, staff };
}

/**
 * Supabase セッションから管理者/スタッフのみを解決する（互換 API・Phase 1 の呼び出し向け）。
 * 会員/未登録は null を返す。
 */
export async function getSupabaseAdminUser(event: RequestEvent): Promise<SessionUser | null> {
	const { user } = await resolveSupabaseSessionUser(event);
	return user && (user.role === 'admin' || user.role === 'staff') ? user : null;
}
