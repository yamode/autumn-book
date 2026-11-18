import { env } from '$env/dynamic/private';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { adminRoleOf, isBanned, jwtSessionId } from '$lib/admin-passkey';
import { passkeyRelyingParty } from '$lib/partner-passkey';
import { safeNext } from '$lib/safe-next';
import { RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';
import type { RequestEvent } from '@sveltejs/kit';
import type { User, SupabaseClient } from '@supabase/supabase-js';

export const MEMBER_LOGIN_METHODS = AUTH_MODE === 'supabase' && env.MEMBER_LOGIN_METHODS === 'true';
export const MEMBER_SECURITY_PATH = '/account/settings/login';
export const memberMfaPath = (next: string) => `/auth/mfa?next=${encodeURIComponent(safeNext(next, '/account'))}`;
export const memberPasskeyRp = (url: URL) => MEMBER_LOGIN_METHODS ? passkeyRelyingParty(url, env.PASSKEY_RP_ID) : null;
export const memberPasskeysAvailable = (url: URL) => Boolean(memberPasskeyRp(url) && partnerServiceClient());

type LoginState = { active: boolean; totp: boolean; passkey_at: string | null; sms?: boolean };
type Claims = { sub?: string; aal?: string; session_id?: string; amr?: { method: string; timestamp: number }[] };
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
		(claims.aal === 'aal2' ? method === 'totp' : method === 'password' || (method === 'otp' && !state.sms)) &&
		timestamp >= now - FRESH_SECONDS && timestamp <= now + 30
	);
	return {
		active: state.active,
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

export async function verifyMemberTotp(
	event: RequestEvent, client: SupabaseClient, userId: string, form: FormData
): Promise<'verified' | 'invalid' | 'locked' | 'unavailable'> {
	const code = String(form.get('code') ?? '').normalize('NFKC').trim();
	if (!/^\d{6}$/.test(code)) return 'invalid';
	const rule = RATE_RULES.memberTotp;
	if ((await rateCheck(event.platform, rule, userId)).locked) return 'locked';

	const factorId = form.get('factorId');
	const { data, error: listError } = await client.auth.mfa.listFactors();
	if (listError || !data?.totp.length) return 'unavailable';
	if (!data.totp.some((factor) => factor.id === factorId)) return 'invalid';

	const { error } = await client.auth.mfa.challengeAndVerify({ factorId: String(factorId), code });
	if (error) {
		await rateHit(event.platform, rule, userId);
		return 'invalid';
	}
	await rateReset(event.platform, rule, userId);
	return 'verified';
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

/** Exchange a proof already verified by Book for a session of the same member. */
export async function openVerifiedMemberSession(event: RequestEvent, userId: string) {
	const svc = partnerServiceClient();
	if (!svc) return null;
	const { data: authUser, error: userError } = await svc.auth.admin.getUserById(userId);
	const user = authUser?.user;
	if (userError || !user?.email || adminRoleOf(user.app_metadata)
		|| isBanned((user as { banned_until?: string | null }).banned_until)) return null;
	const { data: link, error: linkError } = await svc.auth.admin.generateLink({ type: 'magiclink', email: user.email });
	if (linkError || !link?.properties?.hashed_token || link.user.id !== userId) return null;
	const client = createSupabaseServerClient(event);
	const { data, error } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
	const sessionId = jwtSessionId(data.session?.access_token);
	if (!error && data.session && data.user?.id === userId && sessionId) {
		return { client, sessionId, user: data.user, accessToken: data.session.access_token };
	}
	if (data.session) await client.auth.signOut({ scope: 'local' });
	return null;
}
