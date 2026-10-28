// デスクトップアプリ（autumn-pms desktop のタブ型シェル）からの管理画面シングルサインオン（POST /admin/sso）の純関数。
// サーバ（routes/admin/sso/+server.ts）とテスト（admin-desktop-sso.test.ts）から使う。
// 設計: autumn-pms/desktop/docs/tabbed-shell-design.md §2.2・§2.8、docs/auth-hardening.md §7.5
//
// 仕組み: シェルが PMS / RMS / Order の共有セッション（Domain=.yamado.app）から access_token だけを取り出して
// Bearer で渡す。Book はそれを Supabase で確かめ、Book 専用 Cookie に**独立した新しいセッション**を作る。
// （共有 Cookie をコピーしない＝リフレッシュトークンのローテーション競合を起こさない）
import { adminRoleOf, isBanned } from './admin-passkey';

export type DesktopSsoPrecheck =
	| { ok: true; token: string; device: string }
	| { ok: false; reason: 'has_origin' | 'no_desktop_header' | 'no_bearer'; status: 401 | 403 };

/** 端末名（x-autumn-desktop）の上限。アクセスログに残すだけ */
const DEVICE_MAX = 120;
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/**
 * 本人確認の前にヘッダだけで弾く（安価な順）。
 *  1. Origin / Referer がある＝ページの fetch（デスクトップのメインプロセスの fetch は付けない）→ 403
 *  2. x-autumn-desktop が無い（ブラウザの誤爆・偶発的な呼び出しの目印）→ 403
 *  3. Authorization: Bearer <JWT の形> でない → 401
 */
export function desktopSsoPrecheck(headers: Headers): DesktopSsoPrecheck {
	if (headers.get('origin') || headers.get('referer')) return { ok: false, reason: 'has_origin', status: 403 };
	const device = (headers.get('x-autumn-desktop') ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, DEVICE_MAX);
	if (!device) return { ok: false, reason: 'no_desktop_header', status: 403 };
	const m = /^Bearer\s+(\S+)$/.exec((headers.get('authorization') ?? '').trim());
	if (!m || m[1].length > 8192 || !JWT_SHAPE.test(m[1])) return { ok: false, reason: 'no_bearer', status: 401 };
	return { ok: true, token: m[1], device };
}

type UserLike = { email?: string | null; app_metadata?: unknown; banned_until?: string | null };

/** 検証済みのユーザーが管理画面に入れるか。だめなら理由（ログ用）。ログインの画面と同じ基準（admin / staff・停止されていない） */
export function desktopSsoUserProblem(user: UserLike | null | undefined, now = Date.now()): 'invalid_jwt' | 'not_staff' | 'banned' | 'no_email' | null {
	if (!user) return 'invalid_jwt';
	if (!adminRoleOf(user.app_metadata)) return 'not_staff';
	if (isBanned(user.banned_until ?? null, now)) return 'banned';
	if (!user.email) return 'no_email';
	return null;
}
