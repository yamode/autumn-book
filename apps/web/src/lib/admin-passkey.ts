// 管理画面（/admin）のパスキーの純関数。サーバ（lib/server/admin-passkeys.ts）・画面・テストから使う。
// RP（使えるドメイン）・名前・credential_id の形・ブラウザのエラー文言は取引先ページのパスキー（partner-passkey.ts）と共通。
export { isCredentialId, passkeyDeviceName, passkeyErrorMessage, passkeyRelyingParty, type PasskeyRp } from './partner-passkey';

/** パスキーで確認したセッションを aal2 と同じに扱う長さ（時間）。過ぎたら /admin/mfa でもう一度確認する */
export const ADMIN_PASSKEY_SESSION_HOURS = 12;

/** 1 人が登録できるパスキーの数 */
export const ADMIN_PASSKEY_MAX = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Supabase Auth のアクセストークン（JWT）から session_id を取り出す（署名は確かめない）。
 * 呼ぶ側は、同じトークンを getUser() / verifyOtp() で Supabase に確かめてから使うこと。形が違えば null。
 */
export function jwtSessionId(accessToken: string | null | undefined): string | null {
	const part = String(accessToken ?? '').split('.')[1];
	if (!part) return null;
	try {
		const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
		const json = JSON.parse(decodeURIComponent(escape(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))))) as { session_id?: unknown };
		const id = typeof json.session_id === 'string' ? json.session_id : '';
		return UUID.test(id) ? id.toLowerCase() : null;
	} catch {
		return null;
	}
}

/** 管理画面のアカウントの権限（app_metadata.role）。admin / staff 以外は null */
export function adminRoleOf(appMetadata: unknown): 'admin' | 'staff' | null {
	const role = (appMetadata as { role?: unknown } | null)?.role;
	return role === 'admin' || role === 'staff' ? role : null;
}

/** Supabase Auth の利用停止（banned_until が今より後）か */
export function isBanned(bannedUntil: string | null | undefined, now = Date.now()): boolean {
	if (!bannedUntil) return false;
	const t = Date.parse(bannedUntil);
	return Number.isFinite(t) && t > now;
}
