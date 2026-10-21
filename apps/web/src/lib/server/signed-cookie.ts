// 署名付き Cookie（HMAC-SHA256・Cloudflare Workers の WebCrypto で動く形）。2026-10-21 監査で追加。
//
// 中身をそのまま JSON で置いていた Cookie（予約完了の直近予約・デモのセッション）は、利用者が書き換えれば
// 任意の内容を画面に出せた（偽の「予約が確定しました」画面など）。値の末尾に署名を付け、読むときに検証する。
//
// 鍵: COOKIE_SIGNING_SECRET があればそれ。無ければ SUPABASE_SERVICE_ROLE_KEY から用途ラベル付きで導出する
//    （一方向の HMAC なので Cookie から service_role キーは復元できない）。どちらも無い環境（vite dev のデモ等）は
//    固定の開発用鍵で署名する＝デモ用であって守りではない。
// 形式: <値>.<署名 base64url>
import { env as privateEnv } from '$env/dynamic/private';
import { base64url } from './partners/crypto';
import { timingSafeEqualText } from '$lib/partner-mfa';

const enc = new TextEncoder();
let keyPromise: Promise<CryptoKey> | null = null;
let keySource = '';

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

async function signingKey(): Promise<CryptoKey> {
	const explicit = privateEnv.COOKIE_SIGNING_SECRET?.trim() ?? '';
	const service = privateEnv.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
	const source = explicit ? `e:${explicit}` : service ? `s:${service}` : 'dev';
	if (keyPromise && keySource === source) return keyPromise;
	keySource = source;
	keyPromise = (async () => {
		if (explicit) return hmacKey(explicit);
		const base = service || 'autumn-book-dev-cookie-key';
		// 用途ラベルで鍵を分ける（service_role キーそのものを HMAC 鍵に使わない）
		const derived = await crypto.subtle.sign('HMAC', await hmacKey(base), enc.encode('autumn-book/cookie-sign/v1'));
		return crypto.subtle.importKey('raw', derived, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	})();
	return keyPromise;
}

async function mac(name: string, value: string): Promise<string> {
	// Cookie 名も署名に含める（別の Cookie の値を貼り替えて使わせない）
	const sig = await crypto.subtle.sign('HMAC', await signingKey(), enc.encode(`${name}\n${value}`));
	return base64url(new Uint8Array(sig));
}

/** 値に署名を付けた文字列（Cookie にそのまま入れる） */
export async function signCookieValue(name: string, value: string): Promise<string> {
	return `${value}.${await mac(name, value)}`;
}

/** 署名を検証して元の値を返す。署名が無い・合わないときは null */
export async function verifyCookieValue(name: string, signed: string | undefined | null): Promise<string | null> {
	if (!signed) return null;
	const i = signed.lastIndexOf('.');
	if (i <= 0) return null;
	const value = signed.slice(0, i);
	const sig = signed.slice(i + 1);
	return timingSafeEqualText(sig, await mac(name, value)) ? value : null;
}
