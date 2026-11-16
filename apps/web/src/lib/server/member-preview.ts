import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { RequestEvent } from '@sveltejs/kit';
import { isRankCode, type RankCode } from '$lib/plan-access';
import { PRIMARY_ORIGIN } from './public-origin';
import { base64url, fromBase64url, randomToken } from './partners/crypto';

const COOKIE = '__Host-ab_member_preview';
const LAUNCH_SECONDS = 300;
const SESSION_SECONDS = 3600;
const encoder = new TextEncoder();
export const previewOrigin = () => (dev && env.MEMBER_PREVIEW_ORIGIN) || 'https://autumn-book-member-preview.pages.dev';
export const previewAdminOrigin = () => (dev && env.MEMBER_PREVIEW_ADMIN_ORIGIN) || PRIMARY_ORIGIN;
export const isPreviewHost = () => env.MEMBER_PREVIEW_HOST === 'true';
export const previewConfigured = () => (env.MEMBER_PREVIEW_SECRET?.trim().length ?? 0) >= 32;
export const previewRanks = ['standard', 'silver', 'gold', 'platinum'] as const;

type Preview = { rank: RankCode; id: string; expires: number };
type Purpose = 'launch' | 'session';

async function key() {
	const secret = env.MEMBER_PREVIEW_SECRET?.trim() ?? '';
	if (secret.length < 32) return null;
	return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const now = () => Math.floor(Date.now() / 1000);

async function sign(purpose: Purpose, preview: Preview) {
	const hmac = await key();
	if (!hmac) throw new Error('member_preview_not_configured');
	const value = [purpose, preview.rank, preview.id, preview.expires].join('.');
	const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(value));
	return `${value}.${base64url(new Uint8Array(mac))}`;
}

async function verify(purpose: Purpose, token: string | undefined): Promise<Preview | null> {
	const match = token?.match(/^(launch|session)\.([a-z]+)\.([\w-]{22})\.(\d{10})\.([\w-]{43})$/);
	if (!match) return null;
	const [, scope, rank, id, exp, mac] = match;
	const expires = Number(exp);
	if (scope !== purpose || !isRankCode(rank) || expires <= now()) return null;
	const hmac = await key();
	if (!hmac) return null;
	const valid = await crypto.subtle.verify('HMAC', hmac, Uint8Array.from(fromBase64url(mac)), encoder.encode(match[0].slice(0, -44)));
	return valid ? { rank, id, expires } : null;
}

export const launchPreviewToken = (rank: RankCode) => sign('launch', { rank, id: randomToken(16), expires: now() + LAUNCH_SECONDS });

export const isPreviewExchange = (event: RequestEvent) =>
	isPreviewHost() && (dev || event.url.origin === previewOrigin()) && event.url.pathname === '/member-preview/start' &&
	event.request.method === 'POST' && event.request.headers.get('origin') === previewAdminOrigin();

export async function acceptPreview(event: RequestEvent): Promise<Response> {
	const form = await event.request.formData();
	const preview = await verify('launch', String(form.get('token') ?? ''));
	if (!preview) return new Response('プレビューの期限が切れました。管理画面を開き直してください。', { status: 403 });
	return redirectWithPreviewCookie('/account', { ...preview, expires: now() + SESSION_SECONDS });
}

async function redirectWithPreviewCookie(location: string, preview?: Preview) {
	const value = preview ? await sign('session', preview) : '';
	const maxAge = preview ? Math.max(0, preview.expires - now()) : 0;
	// 起動・終了は hooks の応答なので、SvelteKit のページ処理を経由せず Cookie を返す。
	return new Response(null, { status: 303, headers: {
		location, 'set-cookie': `${COOKIE}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`
	} });
}

export const memberPreviewSession = (event: RequestEvent) => verify('session', event.cookies.get(COOKIE));

export async function updatePreview(event: RequestEvent, preview: Preview): Promise<Response> {
	const form = await event.request.formData();
	if (form.get('intent') === 'exit') {
		return redirectWithPreviewCookie(`${previewAdminOrigin()}/admin/member-preview`);
	}
	const rank = form.get('rank');
	if (!isRankCode(rank)) return new Response('会員ランクを選択してください。', { status: 400 });
	return redirectWithPreviewCookie('/account', { ...preview, rank });
}
