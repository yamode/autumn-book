// 共有セッション Cookie による管理画面の自動ログイン（docs/auth-hardening.md §7.6）の純関数。
// サーバ（lib/server/admin-shared-sso.ts・routes/admin/sso・routes/(public)/auth/logout）とテスト（admin-shared-sso.test.ts）から使う。
//
// 仕組み: PMS / RMS / Order は Supabase の Cookie `sb-<project-ref>-auth-token`（Domain=.yamado.app）を共有している。
// 同じ親ドメインなので book.yamado.app にもブラウザが送ってくる。Book はそこから **access_token だけ**を読み、
// 認証サーバで確かめたうえで、Book 専用 Cookie に**独立した新しいセッション**（別の refresh token 家族）を作る。
//
// ★refresh_token は読まない・返さない・覚えない（readSharedAccessToken は access_token と、その中の exp / session_id だけ返す）
// ★共有 Cookie を Book の名前でコピーしない（同じ refresh token を 2 か所で使うと、ローテーションの再利用検知で家族ごと失効する・2026-06-12 の事故）
// ★access_token・Cookie の値はログに出さない（覚えるのは SHA-256 の指紋だけ）
// 参考実装: autumn-pms desktop/electron/sso.cjs の parseSessionCookies（あちらは Electron の Cookie 一覧、こちらは Cookie ヘッダ）
import { isAdminPath } from './admin-mfa';
import { safeNext } from './safe-next';

/** Book 専用 Cookie（lib/server/auth.ts の BOOK_AUTH_COOKIE）。共有 Cookie と取り違えない */
const BOOK_COOKIE_PREFIX = 'sb-autumn-book-auth-token';
const AUTH_COOKIE_RE = /^sb-(.+)-auth-token(?:\.(\d+))?$/;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
/** Cookie ヘッダ・トークンの長さの上限（異常に大きい入力で処理を重くしない） */
const HEADER_MAX = 64 * 1024;
const TOKEN_MAX = 8192;

/** Book でログアウトしたあと、自動ログインを止めておく印（値は共有セッションの指紋） */
export const SHARED_SSO_PAUSE_COOKIE = 'ab_admin_sso_pause';
/** 止めておく長さ（秒）。共有 Cookie が消える（PMS でログアウト）か、別のセッションになれば早く解ける */
export const SHARED_SSO_PAUSE_SEC = 12 * 60 * 60;
/** 失敗した access_token の指紋（同じトークンで何度も試さない＝リダイレクトの往復・ログの洪水を防ぐ） */
export const SHARED_SSO_TRIED_COOKIE = 'ab_admin_sso_tried';
/** access_token の寿命（1 時間）に合わせる */
export const SHARED_SSO_TRIED_SEC = 60 * 60;
/** 指紋の値に使う文字（自分で書いた Cookie 以外を読まない） */
const FP_RE = /^[0-9a-f]{16}$/;
/** セッション id が読めないトークンでログアウトしたときの印（時間で解けるのを待つ） */
export const PAUSE_ANY = 'any';

/** PUBLIC_SUPABASE_URL（https://<ref>.supabase.co）からプロジェクトの ref。@supabase/ssr の既定の Cookie 名と同じ導き方 */
export function supabaseProjectRef(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const ref = new URL(url).hostname.split('.')[0] ?? '';
		return /^[a-z0-9-]{1,64}$/i.test(ref) ? ref : null;
	} catch {
		return null;
	}
}

/** Cookie ヘッダを名前と値の並びにする（同じ名前が 2 つ届いても両方残す。値の解釈は呼び出し側） */
export function parseCookieHeader(header: string | null | undefined): { name: string; value: string }[] {
	if (!header || header.length > HEADER_MAX) return [];
	const out: { name: string; value: string }[] = [];
	for (const part of header.split(';')) {
		const i = part.indexOf('=');
		if (i <= 0) continue;
		const name = part.slice(0, i).trim();
		let value = part.slice(i + 1).trim();
		if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1);
		if (name) out.push({ name, value });
	}
	return out;
}

function base64UrlDecode(s: string): string {
	const norm = s.replace(/-/g, '+').replace(/_/g, '/');
	const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
	const bin = atob(norm + pad);
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

/** Cookie の値（base64- 接頭辞／URL エンコードの JSON／旧形式の配列）から access_token だけを取り出す */
function accessTokenFromValue(raw: string): string | null {
	let json: unknown;
	try {
		let text = raw;
		if (text.startsWith('base64-')) text = base64UrlDecode(text.slice('base64-'.length));
		else if (/%[0-9A-Fa-f]{2}/.test(text)) text = decodeURIComponent(text);
		json = JSON.parse(text);
	} catch {
		return null;
	}
	let token: unknown = null;
	if (Array.isArray(json)) {
		token = json[0]; // 旧形式 [access, refresh, ...]
	} else if (json && typeof json === 'object') {
		const o = json as { access_token?: unknown; currentSession?: { access_token?: unknown } | null };
		token = o.access_token ?? o.currentSession?.access_token ?? null;
	}
	json = null; // refresh_token を含む中身は以後持たない
	return typeof token === 'string' && token.length <= TOKEN_MAX && JWT_SHAPE.test(token) ? token : null;
}

/** JWT の中身（**署名は確かめない**。どのトークンを試すか・期限切れかの目安にだけ使い、本人確認は必ず認証サーバで行う） */
export function peekJwt(token: string): { exp: number | null; sessionId: string | null; sub: string | null } | null {
	if (!JWT_SHAPE.test(token)) return null;
	try {
		const p = JSON.parse(base64UrlDecode(token.split('.')[1])) as { exp?: unknown; session_id?: unknown; sub?: unknown };
		return {
			exp: typeof p.exp === 'number' && Number.isFinite(p.exp) ? p.exp : null,
			sessionId: typeof p.session_id === 'string' ? p.session_id.toLowerCase() : null,
			sub: typeof p.sub === 'string' ? p.sub : null
		};
	} catch {
		return null;
	}
}

export type SharedToken = { accessToken: string; exp: number | null; sessionId: string | null };

/**
 * Cookie ヘッダから共有セッション（sb-<ref>-auth-token・.0/.1 の分割を含む）の access_token を読む。
 * - 他プロジェクトの Cookie・Book 専用 Cookie（sb-autumn-book-auth-token）は読まない。
 * - 分割（.0 .1 …）は .0 から抜けなく続くときだけ結合する。同じ番号が 2 つあれば組み合わせが決まらないので読まない。
 * - 同じ名前の分割なし Cookie が複数ある（旧 Book が同名で host-only に置いた古い Cookie など）ときは、
 *   期限（exp）が最も遅いものを選ぶ。どれを選んでも認証サーバで確かめるので、ここは「試す候補」を決めるだけ。
 * 読めなければ null。
 */
export function readSharedAccessToken(cookieHeader: string | null | undefined, projectRef: string | null): SharedToken | null {
	if (!projectRef) return null;
	const wholes: string[] = [];
	const chunks = new Map<number, string>();
	let dupChunk = false;
	for (const c of parseCookieHeader(cookieHeader)) {
		if (c.name.startsWith(BOOK_COOKIE_PREFIX)) continue;
		const m = AUTH_COOKIE_RE.exec(c.name);
		if (!m || m[1] !== projectRef) continue;
		if (m[2] === undefined) {
			if (c.value) wholes.push(c.value);
		} else {
			const i = Number(m[2]);
			if (!Number.isInteger(i) || i > 50) continue;
			if (chunks.has(i)) dupChunk = true;
			chunks.set(i, c.value);
		}
	}
	const candidates: string[] = [];
	for (const w of wholes) {
		const t = accessTokenFromValue(w);
		if (t) candidates.push(t);
	}
	if (!candidates.length && chunks.size && !dupChunk) {
		const idx = [...chunks.keys()].sort((a, b) => a - b);
		if (idx.every((v, k) => v === k)) {
			const t = accessTokenFromValue(idx.map((i) => chunks.get(i) ?? '').join(''));
			if (t) candidates.push(t);
		}
	}
	let best: SharedToken | null = null;
	for (const t of candidates) {
		const p = peekJwt(t);
		if (!p) continue;
		const cur: SharedToken = { accessToken: t, exp: p.exp, sessionId: p.sessionId };
		if (!best || (cur.exp ?? 0) > (best.exp ?? 0)) best = cur;
	}
	return best;
}

/** access_token が期限切れ（余裕 30 秒）か。期限が読めなければ切れていない扱い（認証サーバが確かめる） */
export function isTokenExpired(exp: number | null, nowMs = Date.now(), marginSec = 30): boolean {
	if (exp == null) return false;
	return exp * 1000 <= nowMs + marginSec * 1000;
}

/**
 * 自動ログインしてよい「トップレベルのページ遷移」か。
 * - GET で、Sec-Fetch-Mode: navigate（fetch・画像・スクリプトなどのサブリソースは対象外）
 * - Sec-Fetch-Site が same-origin / same-site（PMS などから）/ none（アドレス欄・ブックマーク）。cross-site は対象外
 * - Sec-Fetch-Dest があれば document（iframe への埋め込みは対象外）
 * - 先読み（Sec-Purpose / Purpose: prefetch・prerender）は対象外（ユーザーが開いていないのにセッションを作らない）
 * - Sec-Fetch-* を送らない古いブラウザは対象外（通常のログイン画面）
 */
export function isTopLevelNavigation(method: string, headers: Headers): boolean {
	if (method !== 'GET') return false;
	if (headers.get('sec-fetch-mode') !== 'navigate') return false;
	const site = headers.get('sec-fetch-site');
	if (site !== 'same-origin' && site !== 'same-site' && site !== 'none') return false;
	const dest = headers.get('sec-fetch-dest');
	if (dest && dest !== 'document') return false;
	const purpose = `${headers.get('sec-purpose') ?? ''} ${headers.get('purpose') ?? ''} ${headers.get('x-purpose') ?? ''}`.toLowerCase();
	if (/prefetch|prerender|preview/.test(purpose)) return false;
	return true;
}

/**
 * 自動ログインのあとに戻す先。対象外のパスなら null。
 * - /admin 配下だけ。/admin/login はログイン画面そのものなので /admin へ
 * - /admin/login/…（パスワード再設定・パスキー等）と /admin/sso（デスクトップの口）は対象外
 * - 戻す先は同じ origin の /admin 配下に限る（safeNext を通す＝オープンリダイレクトにしない）
 */
export function sharedSsoReturnTarget(pathname: string, search: string): string | null {
	const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
	if (!isAdminPath(path)) return null;
	if (path === '/admin/login') return '/admin';
	if (path.startsWith('/admin/login/') || path === '/admin/sso' || path.startsWith('/admin/sso/')) return null;
	const target = safeNext(`${pathname}${search}`, '');
	if (!target) return null;
	const targetPath = target.split(/[?#]/)[0];
	return isAdminPath(targetPath) ? target : null;
}

/** Cookie に書いた指紋（16 桁の 16 進）か。そうでない値は無視する */
export function readFingerprintCookie(value: string | null | undefined): string | null {
	if (!value) return null;
	return FP_RE.test(value) || value === PAUSE_ANY ? value : null;
}

/** ログアウトの印が今の共有セッションに効いているか（印がセッション不明＝any なら、時間で解けるまで効く） */
export function isPaused(pauseValue: string | null, sessionFp: string | null): boolean {
	if (!pauseValue) return false;
	if (pauseValue === PAUSE_ANY) return true;
	return sessionFp !== null && pauseValue === sessionFp;
}

/** 値の指紋（SHA-256 の先頭 16 桁）。トークンやセッション id そのものは Cookie・ログに残さない */
export async function fingerprint(value: string): Promise<string> {
	const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`autumn-book-shared-sso:${value}`));
	return Array.from(new Uint8Array(buf).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}
