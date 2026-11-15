import { env } from '$env/dynamic/private';
import { MEMBER_SUPABASE } from '$lib/server/auth';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { isRankCode, type PlanViewer } from '$lib/plan-access';
import { json } from '@sveltejs/kit';

export const MCP_PATH = '/mcp';
export const OAUTH_PATH = '/booking-mcp/oauth';
export const TOKEN_PATH = `${OAUTH_PATH}/token`;
export const RESOURCE_METADATA_PATH = '/.well-known/oauth-protected-resource/mcp';
export const SCOPE = 'booking:read';
export const CLIENT_ID = 'autumn-book-claude';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const ACCESS_SECONDS = 3600;
const GRANT_SECONDS = 30 * 86400;
const PKCE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const privateHeaders = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' };

export function bookingMcpEnabled(url: URL): boolean {
	return MEMBER_SUPABASE && env.BOOKING_MCP_ORIGIN === url.origin;
}

/** Machine clients cannot carry the browser's Book preview or login cookies. */
export function isBookingMcpMachineUrl(url: URL): boolean {
	return bookingMcpEnabled(url) && [MCP_PATH, TOKEN_PATH, RESOURCE_METADATA_PATH, `/.well-known/oauth-authorization-server${OAUTH_PATH}`].includes(url.pathname);
}

function client() {
	const sb = partnerServiceClient();
	if (!sb) throw new Error('Booking MCP storage is unavailable');
	return sb.schema('book');
}

/** Verify the actual Book record on every request, including after account withdrawal. */
export async function activeBookMember(userId: string): Promise<PlanViewer | null> {
	const { data, error } = await client().from('members').select('rank_code')
		.eq('user_id', userId).is('withdrawn_at', null).maybeSingle();
	if (error) throw error;
	return data ? { isMember: true, rank: isRankCode(data.rank_code) ? data.rank_code : 'standard' } : null;
}

function base64url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function hash(value: string): Promise<string> {
	return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

const newToken = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const after = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

export function authorizationRequest(url: URL) {
	const p = url.searchParams;
	const challenge = p.get('code_challenge');
	const state = p.get('state');
	if (url.search.length > 4096 || new Set(p.keys()).size !== p.size ||
		p.get('client_id') !== CLIENT_ID || p.get('redirect_uri') !== CALLBACK ||
		p.get('response_type') !== 'code' || p.get('code_challenge_method') !== 'S256' ||
		!challenge || !TOKEN.test(challenge) || (state?.length ?? 0) > 1024 ||
		!validResource(p, url) || (p.has('scope') && p.get('scope') !== SCOPE)) return null;
	return { challenge, state, callback: new URL(CALLBACK) };
}

function validResource(params: URLSearchParams, url: URL): boolean {
	return !params.has('resource') || params.get('resource') === `${url.origin}${MCP_PATH}`;
}

export async function issueAuthorizationCode(userId: string, challenge: string): Promise<string> {
	const code = newToken();
	const { error } = await client().from('booking_mcp_grants').upsert({
		user_id: userId, client_id: CLIENT_ID,
		authorization_code_hash: await hash(code), code_challenge: challenge, code_expires_at: after(300),
		access_token_hash: null, access_expires_at: null, refresh_token_hash: null, grant_expires_at: after(GRANT_SECONDS)
	});
	if (error) throw error;
	return code;
}

function tokenError(error: string, status = 400) {
	return json({ error }, { status, headers: privateHeaders });
}

export async function exchangeToken(request: Request, url: URL): Promise<Response> {
	if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
		return tokenError('invalid_request');
	}
	const reader = request.body?.getReader();
	if (!reader) return tokenError('invalid_request');
	const decoder = new TextDecoder();
	let body = '';
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > 4096) {
			await reader.cancel();
			return tokenError('invalid_request', 413);
		}
		body += decoder.decode(value, { stream: true });
	}
	const p = new URLSearchParams(body + decoder.decode());
	if (new Set(p.keys()).size !== p.size || !validResource(p, url)) return tokenError('invalid_request');
	if (p.get('client_id') !== CLIENT_ID) return tokenError('invalid_client');
	if (p.has('scope') && p.get('scope') !== SCOPE) return tokenError('invalid_scope');

	const grant = p.get('grant_type');
	if (grant !== 'authorization_code' && grant !== 'refresh_token') return tokenError('unsupported_grant_type');
	const code = p.get(grant === 'authorization_code' ? 'code' : 'refresh_token');
	if (!code || !TOKEN.test(code)) return tokenError('invalid_grant');
	const access = newToken();
	const refresh = newToken();
	const now = after(0);
	// Compare and consume the old credential in the same UPDATE. Concurrent exchanges win once.
	let update = client().from('booking_mcp_grants').update({
		authorization_code_hash: null, code_challenge: null, code_expires_at: null,
		access_token_hash: await hash(access), access_expires_at: after(ACCESS_SECONDS), refresh_token_hash: await hash(refresh)
	}).eq('client_id', CLIENT_ID).gt('grant_expires_at', now);
	if (grant === 'authorization_code') {
		const verifier = p.get('code_verifier');
		if (p.get('redirect_uri') !== CALLBACK || !verifier || !PKCE_VERIFIER.test(verifier)) return tokenError('invalid_grant');
		update = update.eq('authorization_code_hash', await hash(code)).eq('code_challenge', await hash(verifier)).gt('code_expires_at', now);
	} else {
		update = update.eq('refresh_token_hash', await hash(code));
	}
	const result = await update.select('user_id').maybeSingle();
	if (result.error) throw result.error;
	if (!result.data || !await activeBookMember(result.data.user_id)) return tokenError('invalid_grant');
	return json({
		access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: SCOPE
	}, { headers: { ...privateHeaders, pragma: 'no-cache' } });
}

export async function bookingAccess(request: Request): Promise<{ userId: string; viewer: PlanViewer } | null> {
	const token = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get('authorization') ?? '')?.[1];
	if (!token) return null;
	const now = after(0);
	const { data, error } = await client().from('booking_mcp_grants').select('user_id')
		.eq('client_id', CLIENT_ID).eq('access_token_hash', await hash(token))
		.gt('access_expires_at', now).gt('grant_expires_at', now).maybeSingle();
	if (error) throw error;
	if (!data) return null;
	const viewer = await activeBookMember(data.user_id);
	return viewer ? { userId: data.user_id, viewer } : null;
}

export async function revokeBookingAccess(userId: string): Promise<void> {
	const { error } = await client().from('booking_mcp_grants').delete().eq('user_id', userId).eq('client_id', CLIENT_ID);
	if (error) throw error;
}

export async function hasBookingAccess(userId: string): Promise<boolean> {
	const { data, error } = await client().from('booking_mcp_grants').select('user_id')
		.eq('user_id', userId).eq('client_id', CLIENT_ID).gt('grant_expires_at', after(0)).maybeSingle();
	if (error) throw error;
	return Boolean(data);
}
