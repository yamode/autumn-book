// 管理画面の二段階認証（Supabase Auth TOTP MFA）の判定ロジック（純関数・docs/auth-hardening.md §7.2・§7.4）。
// サーバ（hooks.server.ts・routes/admin/+layout.server.ts）とテストから使う。Supabase には触らない。
import { safeNext } from './safe-next';

/** hooks が locals.adminAal に載せる、管理者/スタッフのセッションの認証レベル。 */
export interface AdminAal {
	/** いまのセッションの認証レベル（JWT の aal クレーム）。'aal1' | 'aal2' | null */
	current: string | null;
	/** 確認済み（verified）の第2要素の数。1 以上なら aal2 まで上げられる＝上げなければならない */
	verifiedFactors: number;
}

/**
 * 管理画面のリクエストをどこへ向けるか。
 *   ok        … そのまま通す
 *   challenge … 第2要素の確認（/admin/mfa）へ。登録済みなのに aal1 のまま
 *   enroll    … 登録（/admin/security?enroll=1）へ。ADMIN_MFA_REQUIRED=true で未登録
 */
export type AdminMfaGate = 'ok' | 'challenge' | 'enroll';

export const ADMIN_MFA_PATH = '/admin/mfa';
export const ADMIN_SECURITY_PATH = '/admin/security';
export const ADMIN_LOGIN_PATH = '/admin/login';

/** パスが /admin 配下か（/administrator のような前方一致の取り違えを避ける）。 */
export function isAdminPath(pathname: string): boolean {
	return pathname === '/admin' || pathname.startsWith('/admin/');
}

/** 末尾のスラッシュを落とす（'/admin/mfa/' と '/admin/mfa' を同じに扱う）。 */
function trimSlash(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * 管理画面の二段階認証の関所。
 * - 第2要素を登録している人は、ADMIN_MFA_REQUIRED に関係なく aal2 まで上げないと /admin/mfa 以外を開けない
 *   （登録したのに確認を飛ばせるなら登録の意味がない）。
 * - 未登録の人は、required=true のときだけ /admin/security（登録画面そのもの）以外を開けない。
 *   /admin/security/users（他人のリセット）は登録画面に含めない。
 * - /admin/login は常に通す。ログアウトは /auth/logout（/admin の外）なので関所にかからない。
 * - adminAal が null（demo モード・管理者以外）は判定しない。
 */
export function decideAdminMfaGate(args: {
	pathname: string;
	role: string | null | undefined;
	aal: AdminAal | null;
	required: boolean;
}): AdminMfaGate {
	const path = trimSlash(args.pathname);
	if (!isAdminPath(path) || path === ADMIN_LOGIN_PATH) return 'ok';
	if (args.role !== 'admin' && args.role !== 'staff') return 'ok';
	if (!args.aal) return 'ok';

	if (args.aal.verifiedFactors > 0) {
		if (args.aal.current === 'aal2') return 'ok';
		return path === ADMIN_MFA_PATH ? 'ok' : 'challenge';
	}
	// 未登録
	if (!args.required) return 'ok';
	return path === ADMIN_SECURITY_PATH ? 'ok' : 'enroll';
}

/** 関所の結果から転送先を作る。challenge は元の画面へ戻れるよう next を付ける。 */
export function adminMfaRedirectTarget(gate: AdminMfaGate, pathname: string, search = ''): string | null {
	if (gate === 'challenge') {
		const next = safeAdminNext(pathname + search);
		return next === '/admin' ? ADMIN_MFA_PATH : `${ADMIN_MFA_PATH}?next=${encodeURIComponent(next)}`;
	}
	if (gate === 'enroll') return `${ADMIN_SECURITY_PATH}?enroll=1`;
	return null;
}

/**
 * 確認後の戻り先。/admin 配下の同一オリジンのパスだけを許す（オープンリダイレクト対策）。
 * それ以外・MFA 画面自身・ログイン画面は /admin に落とす。
 */
export function safeAdminNext(next: string | null | undefined): string {
	// 外部 URL・プロトコル相対（//evil）・バックスラッシュ・制御文字は safe-next.ts で弾く
	const safe = safeNext(next, '');
	if (!safe) return '/admin';
	const pathOnly = trimSlash(safe.split(/[?#]/)[0]);
	if (!isAdminPath(pathOnly)) return '/admin';
	if (pathOnly === ADMIN_MFA_PATH || pathOnly === ADMIN_LOGIN_PATH) return '/admin';
	return safe;
}

/** ADMIN_MFA_REQUIRED の解釈。'true' / '1' / 'on' / 'yes'（大文字小文字・前後空白を無視）だけを true とする。既定 false。 */
export function parseAdminMfaRequired(value: string | null | undefined): boolean {
	if (!value) return false;
	return ['true', '1', 'on', 'yes'].includes(value.trim().toLowerCase());
}

/**
 * 認証アプリの 6 桁コードを整える。全角数字・空白・ハイフンを許し、6 桁の半角数字にできなければ null。
 * （認証アプリは「123 456」のように区切って表示するものがある）
 */
export function normalizeTotpCode(input: string | null | undefined): string | null {
	if (!input) return null;
	const half = input.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
	const digits = half.replace(/[\s\-‐－ー]/g, '');
	return /^\d{6}$/.test(digits) ? digits : null;
}

/** Supabase Auth の MFA エラー（AuthError.code）を画面の文言にする。 */
export function adminMfaErrorText(err: { code?: string | null; message?: string | null } | null | undefined): string {
	const code = err?.code ?? '';
	const message = err?.message ?? '';
	switch (code) {
		case 'mfa_totp_enroll_not_enabled':
		case 'mfa_totp_verify_not_enabled':
			return '二段階認証（認証アプリ）がまだ有効になっていません。Supabase ダッシュボードの Authentication → Multi-Factor で TOTP を有効にしてください。';
		case 'mfa_verification_failed':
			return 'コードが違います。認証アプリに表示されている最新の 6 桁を入力してください（端末の時刻がずれていると合いません）。';
		case 'mfa_challenge_expired':
			return '確認の有効期限が切れました。もう一度コードを入力してください。';
		case 'mfa_factor_not_found':
			return '登録が見つかりません。画面を開き直してください。';
		case 'mfa_factor_name_conflict':
			return '同じ名前の登録があります。別の名前にしてください。';
		case 'too_many_enrolled_mfa_factors':
			return '登録できる数の上限です。使っていない登録を削除してください。';
		case 'insufficient_aal':
			return 'この操作の前に、二段階認証のコードで本人確認をしてください。';
		case 'mfa_verification_rejected':
		case 'over_request_rate_limit':
			return '試行回数が多すぎます。しばらく待ってからやり直してください。';
		case 'mfa_ip_address_mismatch':
			return '登録の途中で接続元が変わりました。最初からやり直してください。';
	}
	return message ? `二段階認証の処理に失敗しました（${message}）` : '二段階認証の処理に失敗しました。';
}
