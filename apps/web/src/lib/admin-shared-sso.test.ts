// 実行: pnpm --filter @autumn-book/web test -- admin-shared-sso
import { describe, expect, it } from 'vitest';
import {
	fingerprint,
	isPaused,
	isTokenExpired,
	isTopLevelNavigation,
	PAUSE_ANY,
	parseCookieHeader,
	peekJwt,
	readFingerprintCookie,
	readSharedAccessToken,
	sharedSsoReturnTarget,
	supabaseProjectRef
} from './admin-shared-sso';

const REF = 'opkocyapzmsjzhbwlguh';
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: Record<string, unknown>) => `${b64url('{"alg":"ES256"}')}.${b64url(JSON.stringify(payload))}.c2ln`;
const NOW_SEC = 1_800_000_000;
const ACCESS = jwt({ sub: 'u1', exp: NOW_SEC + 3600, session_id: 'ABC-1' });
const SESSION = { access_token: ACCESS, refresh_token: 'rt-secret', expires_at: NOW_SEC + 3600, token_type: 'bearer' };
const ssrValue = (o: unknown) => `base64-${b64url(JSON.stringify(o))}`;

describe('プロジェクトの ref', () => {
	it('PUBLIC_SUPABASE_URL のホスト名の先頭から導く', () => {
		expect(supabaseProjectRef(`https://${REF}.supabase.co`)).toBe(REF);
		expect(supabaseProjectRef('')).toBeNull();
		expect(supabaseProjectRef('not a url')).toBeNull();
	});
});

describe('Cookie ヘッダの解析', () => {
	it('同じ名前が 2 つあっても両方残す', () => {
		expect(parseCookieHeader('a=1; b=2; a=3')).toEqual([
			{ name: 'a', value: '1' },
			{ name: 'b', value: '2' },
			{ name: 'a', value: '3' }
		]);
	});
	it('空・異常に長いヘッダは空', () => {
		expect(parseCookieHeader(null)).toEqual([]);
		expect(parseCookieHeader('x=' + 'a'.repeat(70_000))).toEqual([]);
	});
});

describe('共有セッションの access_token の読み取り', () => {
	it('base64- 接頭辞の分割なし Cookie から access_token だけを返す（refresh_token は返さない）', () => {
		const r = readSharedAccessToken(`sb-${REF}-auth-token=${ssrValue(SESSION)}`, REF);
		expect(r).toEqual({ accessToken: ACCESS, exp: NOW_SEC + 3600, sessionId: 'abc-1' });
		expect(JSON.stringify(r)).not.toContain('rt-secret');
	});
	it('.0 / .1 に分割された Cookie を結合する（順不同で届いても）', () => {
		const v = ssrValue(SESSION);
		const half = Math.floor(v.length / 2);
		const header = `other=1; sb-${REF}-auth-token.1=${v.slice(half)}; sb-${REF}-auth-token.0=${v.slice(0, half)}`;
		expect(readSharedAccessToken(header, REF)?.accessToken).toBe(ACCESS);
	});
	it('分割の途中が欠けている・同じ番号が 2 つあるときは読まない', () => {
		const v = ssrValue(SESSION);
		const half = Math.floor(v.length / 2);
		expect(readSharedAccessToken(`sb-${REF}-auth-token.1=${v.slice(half)}`, REF)).toBeNull();
		expect(
			readSharedAccessToken(`sb-${REF}-auth-token.0=${v.slice(0, half)}; sb-${REF}-auth-token.0=x; sb-${REF}-auth-token.1=${v.slice(half)}`, REF)
		).toBeNull();
	});
	it('旧形式（URL エンコードした JSON・配列）も読む', () => {
		expect(readSharedAccessToken(`sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify(SESSION))}`, REF)?.accessToken).toBe(ACCESS);
		expect(readSharedAccessToken(`sb-${REF}-auth-token=${encodeURIComponent(JSON.stringify([ACCESS, 'rt', null]))}`, REF)?.accessToken).toBe(ACCESS);
	});
	it('他プロジェクトの Cookie・Book 専用 Cookie は読まない', () => {
		expect(readSharedAccessToken(`sb-otherproject-auth-token=${ssrValue(SESSION)}`, REF)).toBeNull();
		expect(readSharedAccessToken(`sb-autumn-book-auth-token=${ssrValue(SESSION)}`, REF)).toBeNull();
		expect(readSharedAccessToken(`sb-autumn-book-auth-token.0=${ssrValue(SESSION)}`, 'autumn-book')).toBeNull();
		expect(readSharedAccessToken(`sb-${REF}-auth-token=${ssrValue(SESSION)}`, null)).toBeNull();
	});
	it('壊れた値・JWT の形でない access_token は読まない', () => {
		expect(readSharedAccessToken(`sb-${REF}-auth-token=base64-!!!`, REF)).toBeNull();
		expect(readSharedAccessToken(`sb-${REF}-auth-token=${ssrValue({ access_token: 'nope' })}`, REF)).toBeNull();
	});
	it('同じ名前が 2 つ届いたら期限の遅いほうを候補にする', () => {
		const old = jwt({ sub: 'u1', exp: NOW_SEC - 10_000, session_id: 'old' });
		const header = `sb-${REF}-auth-token=${ssrValue({ access_token: old })}; sb-${REF}-auth-token=${ssrValue(SESSION)}`;
		expect(readSharedAccessToken(header, REF)?.accessToken).toBe(ACCESS);
	});
});

describe('JWT の中身と期限', () => {
	it('exp・session_id・sub を読む（署名は確かめない）', () => {
		expect(peekJwt(ACCESS)).toEqual({ exp: NOW_SEC + 3600, sessionId: 'abc-1', sub: 'u1' });
		expect(peekJwt('a.b')).toBeNull();
	});
	it('期限切れ（余裕 30 秒）。期限が読めなければ切れていない扱い', () => {
		expect(isTokenExpired(NOW_SEC + 3600, NOW_SEC * 1000)).toBe(false);
		expect(isTokenExpired(NOW_SEC + 10, NOW_SEC * 1000)).toBe(true);
		expect(isTokenExpired(null, NOW_SEC * 1000)).toBe(false);
	});
});

describe('トップレベルのページ遷移の判定', () => {
	const nav = (o: Record<string, string>) => new Headers({ 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document', ...o });
	it('同じサイト（PMS から）・同じ origin・アドレス欄（none）の GET 遷移は対象', () => {
		expect(isTopLevelNavigation('GET', nav({ 'sec-fetch-site': 'same-site' }))).toBe(true);
		expect(isTopLevelNavigation('GET', nav({ 'sec-fetch-site': 'same-origin' }))).toBe(true);
		expect(isTopLevelNavigation('GET', nav({ 'sec-fetch-site': 'none' }))).toBe(true);
	});
	it('他サイトからの遷移・POST・サブリソース・iframe・先読み・ヘッダなしは対象外', () => {
		expect(isTopLevelNavigation('GET', nav({ 'sec-fetch-site': 'cross-site' }))).toBe(false);
		expect(isTopLevelNavigation('POST', nav({ 'sec-fetch-site': 'same-origin' }))).toBe(false);
		expect(isTopLevelNavigation('GET', new Headers({ 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'same-origin' }))).toBe(false);
		expect(isTopLevelNavigation('GET', new Headers({ 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image', 'sec-fetch-site': 'same-site' }))).toBe(false);
		expect(isTopLevelNavigation('GET', nav({ 'sec-fetch-site': 'same-origin', 'sec-fetch-dest': 'iframe' }))).toBe(false);
		expect(isTopLevelNavigation('GET', nav({ 'sec-fetch-site': 'same-origin', 'sec-purpose': 'prefetch' }))).toBe(false);
		expect(isTopLevelNavigation('GET', nav({ 'sec-fetch-site': 'same-origin', 'sec-purpose': 'prefetch;prerender' }))).toBe(false);
		expect(isTopLevelNavigation('GET', new Headers())).toBe(false);
	});
});

describe('自動ログインのあとに戻す先', () => {
	it('/admin 配下はそのまま（クエリ付き）・/admin/login は /admin', () => {
		expect(sharedSsoReturnTarget('/admin', '')).toBe('/admin');
		expect(sharedSsoReturnTarget('/admin/reservations', '?q=1')).toBe('/admin/reservations?q=1');
		expect(sharedSsoReturnTarget('/admin/login', '')).toBe('/admin');
		expect(sharedSsoReturnTarget('/admin/login/', '?x=1')).toBe('/admin');
	});
	it('/admin の外・ログインの下（再設定・パスキー）・/admin/sso は対象外', () => {
		expect(sharedSsoReturnTarget('/', '')).toBeNull();
		expect(sharedSsoReturnTarget('/administrator', '')).toBeNull();
		expect(sharedSsoReturnTarget('/admin/login/reset', '')).toBeNull();
		expect(sharedSsoReturnTarget('/admin/login/passkey', '')).toBeNull();
		expect(sharedSsoReturnTarget('/admin/sso', '')).toBeNull();
	});
	it('外へ出る形（//・バックスラッシュ・制御文字）は返さない', () => {
		expect(sharedSsoReturnTarget('//evil.example/admin', '')).toBeNull();
		expect(sharedSsoReturnTarget('/admin/\\evil', '')).toBeNull();
		expect(sharedSsoReturnTarget('/admin/x', '?a=\n')).toBeNull();
	});
});

describe('ログアウトの印・失敗の印', () => {
	it('指紋は 16 桁の 16 進で、元の値を含まない', async () => {
		const fp = await fingerprint(ACCESS);
		expect(fp).toMatch(/^[0-9a-f]{16}$/);
		expect(await fingerprint(ACCESS)).toBe(fp);
		expect(await fingerprint(ACCESS + 'x')).not.toBe(fp);
	});
	it('自分で書いた形の値だけ読む', () => {
		expect(readFingerprintCookie('0123456789abcdef')).toBe('0123456789abcdef');
		expect(readFingerprintCookie(PAUSE_ANY)).toBe(PAUSE_ANY);
		expect(readFingerprintCookie('<script>')).toBeNull();
		expect(readFingerprintCookie(undefined)).toBeNull();
	});
	it('印が同じ共有セッションに効く。別のセッション（PMS でログインし直した）なら効かない。any は常に効く', () => {
		expect(isPaused('0123456789abcdef', '0123456789abcdef')).toBe(true);
		expect(isPaused('0123456789abcdef', 'fedcba9876543210')).toBe(false);
		expect(isPaused(PAUSE_ANY, 'fedcba9876543210')).toBe(true);
		expect(isPaused(null, '0123456789abcdef')).toBe(false);
	});
});
