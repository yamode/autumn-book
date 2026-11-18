import { env } from '$env/dynamic/private';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { adminRoleOf, jwtSessionId } from '$lib/admin-passkey';
import { passkeyRelyingParty } from '$lib/partner-passkey';
import { safeNext } from '$lib/safe-next';
import type { RequestEvent } from '@sveltejs/kit';
import type { User, SupabaseClient } from '@supabase/supabase-js';

export const MEMBER_LOGIN_METHODS = AUTH_MODE === 'supabase' && env.MEMBER_LOGIN_METHODS === 'true';
export const MEMBER_SECURITY_PATH = '/account/settings/login';
export const memberMfaPath = (next: string) => `/auth/mfa?next=${encodeURIComponent(safeNext(next, '/account'))}`;
export const memberPasskeyRp = (url: URL) => MEMBER_LOGIN_METHODS ? passkeyRelyingParty(url, env.PASSKEY_RP_ID) : null;
export const memberPasskeysAvailable = (url: URL) => Boolean(memberPasskeyRp(url) && partnerServiceClient());

type LoginState = { active: boolean; totp: boolean; passkey_at: string | null };
type Claims = { sub?: string; email?: string; aal?: string; session_id?: string; amr?: { method: string; timestamp: number }[] };
const FRESH_SECONDS = 10 * 60;

export async function memberLoginState(user: string, sessionId: string | null): Promise<LoginState> {
	const svc = partnerServiceClient();
	if (!svc) throw new Error('member_login_unavailable');
	const { data, error } = await svc.schema('book').rpc('member_login_state', { p_user: user, p_session: sessionId });
	if (error || !data) throw new Error('member_login_unavailable');
	return data as LoginState;
}

export async function memberSessionSecurity(client: SupabaseClient, userId: string) {
	const { data, error } = await client.auth.getClaims();
	const claims = data?.claims as Claims | undefined;
	if (error || !claims?.session_id || claims.sub !== userId) throw new Error('member_session_unavailable');
	const state = await memberLoginState(userId, claims.session_id);
	const now = Math.floor(Date.now() / 1000);
	const recentPasskey = state.passkey_at && Date.parse(state.passkey_at) / 1000 >= now - FRESH_SECONDS;
	const recentMethod = (claims.amr ?? []).some(({ method, timestamp }) =>
		(claims.aal === 'aal2' ? method === 'totp' : ['otp', 'password'].includes(method)) &&
		timestamp >= now - FRESH_SECONDS && timestamp <= now + 30
	);
	return {
		active: state.active,
		email: claims.email ?? null,
		sessionId: claims.session_id,
		hasTotp: state.totp,
		passkey: Boolean(state.passkey_at),
		aal2: claims.aal === 'aal2',
		requiresMfa: state.totp && claims.aal !== 'aal2' && !state.passkey_at,
		recent: state.active && Boolean(recentPasskey || recentMethod)
	};
}

export async function memberSecurityContext(event: RequestEvent) {
	if (!MEMBER_LOGIN_METHODS || event.locals.user?.role !== 'member') return null;
	const client = createSupabaseServerClient(event);
	const security = await memberSessionSecurity(client, event.locals.user.id);
	if (!security.active || security.requiresMfa) return null;
	return { client, userId: event.locals.user.id, ...security };
}

/** Validate the existing Book member and determine whether a second step is needed. */
export async function memberLoginDestination(user: User, accessToken: string, next: string) {
	if (adminRoleOf(user.app_metadata)) return null;
	const sessionId = jwtSessionId(accessToken);
	if (!sessionId) return null;
	const state = await memberLoginState(user.id, sessionId);
	if (!state.active) return null;
	return state.totp && !state.passkey_at ? memberMfaPath(next) : safeNext(next, '/account');
}
