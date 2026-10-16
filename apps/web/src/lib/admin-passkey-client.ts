// 管理画面（/admin）のパスキー（ブラウザ側）。@simplewebauthn/browser の薄い包み（取引先ページの partner-passkey-client.ts と同じ作り）。
// ライブラリはパスキーを使うときだけ読み込む（動的 import）。サーバとのやり取りは JSON（{ challengeId, options } → 応答）。
import { passkeyErrorMessage } from './admin-passkey';

type Json = Record<string, unknown> | null;
export type AdminPasskeyResult = { ok: true; data?: Json } | { ok: false; message: string; status?: number };

async function postJson(url: string, body: unknown): Promise<{ status: number; json: Json }> {
	const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
	return { status: res.status, json: (await res.json().catch(() => null)) as Json };
}

const lib = () => import('@simplewebauthn/browser');

/** このブラウザでパスキー（WebAuthn）を使えるか */
export async function passkeySupported(): Promise<boolean> {
	if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
	try {
		return (await lib()).browserSupportsWebAuthn();
	} catch {
		return false;
	}
}

const fail = (r: { status: number; json: Json }, fallback: string): AdminPasskeyResult => ({
	ok: false,
	status: r.status,
	message: String(r.json?.message ?? (r.status === 403 ? '先に二段階認証で確認してください。画面を開き直してください。' : fallback))
});

/** パスキーを登録する（/admin/security） */
export async function registerAdminPasskey(name: string): Promise<AdminPasskeyResult> {
	const opt = await postJson('/admin/security/passkey/options', {});
	if (!opt.json?.ok) return fail(opt, 'パスキーを登録できませんでした。');
	let response;
	try {
		const { startRegistration } = await lib();
		response = await startRegistration({ optionsJSON: opt.json.options as never });
	} catch (e) {
		return { ok: false, message: passkeyErrorMessage(e, 'register') };
	}
	const v = await postJson('/admin/security/passkey/verify', { challengeId: opt.json.challengeId, response, name });
	if (!v.json?.ok) return fail(v, 'パスキーを登録できませんでした。');
	return { ok: true, data: v.json };
}

/** 二段階認証の確認をパスキーで行う（/admin/mfa）。成功すれば data.next */
export async function stepUpWithAdminPasskey(next: string): Promise<AdminPasskeyResult> {
	const opt = await postJson('/admin/mfa/passkey/options', {});
	if (!opt.json?.ok) return fail(opt, 'パスキーで確認できませんでした。');
	let response;
	try {
		const { startAuthentication } = await lib();
		response = await startAuthentication({ optionsJSON: opt.json.options as never });
	} catch (e) {
		return { ok: false, message: passkeyErrorMessage(e, 'auth') };
	}
	const v = await postJson('/admin/mfa/passkey/verify', { challengeId: opt.json.challengeId, response, next });
	if (!v.json?.ok) return fail(v, 'パスキーで確認できませんでした。');
	return { ok: true, data: v.json };
}

/**
 * パスキーでログインする（/admin/login）。autofill=true は Conditional UI（メールアドレス欄の候補から選ぶ・選ばれるまで待つ）。
 * 成功すれば data.next。取りやめ（別の操作で中断）は message 空で返す。
 */
export async function loginWithAdminPasskey(opts: { autofill?: boolean } = {}): Promise<AdminPasskeyResult> {
	const { startAuthentication, browserSupportsWebAuthnAutofill } = await lib();
	if (opts.autofill && !(await browserSupportsWebAuthnAutofill().catch(() => false))) return { ok: false, message: '' };
	const opt = await postJson('/admin/login/passkey/options', {});
	if (!opt.json?.ok) return { ok: false, status: opt.status, message: opts.autofill ? '' : String(opt.json?.message ?? 'パスキーでログインできませんでした。') };
	let response;
	try {
		response = await startAuthentication({ optionsJSON: opt.json.options as never, useBrowserAutofill: Boolean(opts.autofill) });
	} catch (e) {
		// Conditional UI はボタンを押したとき・画面を離れたときに中断される（文言は出さない）
		if (opts.autofill) return { ok: false, message: '' };
		return { ok: false, message: passkeyErrorMessage(e, 'auth') };
	}
	const v = await postJson('/admin/login/passkey/verify', { challengeId: opt.json.challengeId, response });
	if (!v.json?.ok) return { ok: false, status: v.status, message: String(v.json?.message ?? 'パスキーでログインできませんでした。') };
	return { ok: true, data: v.json };
}
