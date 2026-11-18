import { env } from '$env/dynamic/private';
import { sendSmsWith } from '$lib/precheckin-sms';
import { MEMBER_LOGIN_METHODS, MEMBER_SECURITY_PATH, memberLoginDestination, openVerifiedMemberSession } from '$lib/server/member-login';
import { clientIp, ipKey, RATE_RULES, rateCheck, rateHit } from '$lib/server/login-rate-limit';
import { nttFetch } from '$lib/server/ntt-fetch';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { nttConfig } from '$lib/server/precheckin-sms';
import { PRIMARY_ORIGIN } from '$lib/server/public-origin';
import { signCookieValue, verifyCookieValue } from '$lib/server/signed-cookie';
import type { RequestEvent } from '@sveltejs/kit';

type Owner = { userId: string; sessionId: string };
export type MemberOtpPreference = 'email' | 'sms';
type SmsSettings = { phone: string | null; verified: boolean; preference: MemberOtpPreference };
const PREFERENCE = '__Host-ab_member_otp';
const SMS_LOGIN = { name: 'ab_member_sms_login', path: '/auth/login' };
const SMS_ENROLL = { name: 'ab_member_sms_enroll', path: MEMBER_SECURITY_PATH };
const EXPIRY_SECONDS = 300;
const CODE = /^\d{6}$/;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();

export function memberSmsAvailable(url: URL): boolean {
	return MEMBER_LOGIN_METHODS && env.MEMBER_SMS_LOGIN === 'true' && url.origin === PRIMARY_ORIGIN
		&& (env.MEMBER_SMS_OTP_SECRET?.trim().length ?? 0) >= 32 && Boolean(nttConfig() && partnerServiceClient());
}

function db() {
	const client = partnerServiceClient();
	if (!client) throw new Error('member_sms_unavailable');
	return client.schema('book');
}

export async function memberSmsSettings(userId: string): Promise<SmsSettings> {
	const { data, error } = await db().rpc('member_sms_settings', { p_user: userId });
	if (error || !data) throw new Error('member_sms_unavailable');
	return data as SmsSettings;
}

export async function memberSmsDefault(event: RequestEvent): Promise<boolean> {
	if (!memberSmsAvailable(event.url)) return false;
	try {
		const userId = await verifyCookieValue(PREFERENCE, event.cookies.get(PREFERENCE));
		if (!userId || !UUID.test(userId)) return false;
		const settings = await memberSmsSettings(userId);
		return settings.verified && settings.preference === 'sms';
	} catch {
		return false;
	}
}

export async function rememberMemberSmsDefault(event: RequestEvent, userId: string) {
	if (!memberSmsAvailable(event.url)) return;
	try {
		const value = await signCookieValue(PREFERENCE, userId);
		event.cookies.set(PREFERENCE, value, { path: '/', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 180 * 86400 });
	} catch {
		// The default is a browser hint. A settings lookup failure must not stop login.
		event.cookies.delete(PREFERENCE, { path: '/' });
	}
}

export async function setMemberOtpPreference(event: RequestEvent, userId: string, preference: MemberOtpPreference) {
	const { data, error } = await db().rpc('set_member_sms_preference', { p_user: userId, p_preference: preference });
	if (error || data !== true) return false;
	await rememberMemberSmsDefault(event, userId);
	return true;
}

async function smsHash(id: string, code: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', encoder.encode(env.MEMBER_SMS_OTP_SECRET!.trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const bytes = await crypto.subtle.sign('HMAC', key, encoder.encode(`book-member-sms/v1\n${id}\n${code}`));
	return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function generateCode() {
	const bytes = new Uint32Array(1);
	do crypto.getRandomValues(bytes); while (bytes[0] >= 4_294_000_000);
	return String(bytes[0] % 1_000_000).padStart(6, '0');
}

export async function memberSmsSendAllowed(event: RequestEvent) {
	const ip = ipKey(clientIp(event.request));
	const limits = [[RATE_RULES.memberSmsIp, ip], [RATE_RULES.memberSmsGlobal, 'all']] as const;
	if ((await Promise.all(limits.map(([rule, key]) => rateCheck(event.platform, rule, key)))).some((result) => result.locked)) return false;
	await Promise.all(limits.map(([rule, key]) => rateHit(event.platform, rule, key)));
	return true;
}

export async function startMemberSms(event: RequestEvent, phone: string, owner?: Owner) {
	const cfg = nttConfig();
	if (!cfg || !memberSmsAvailable(event.url)) return false;
	const id = crypto.randomUUID();
	const code = generateCode();
	const scope = owner ? SMS_ENROLL : SMS_LOGIN;
	const { data, error } = await db().rpc('start_member_sms', {
		p_id: id, p_phone: phone, p_user: owner?.userId ?? null, p_session: owner?.sessionId ?? null, p_hash: await smsHash(id, code)
	});
	if (error) throw new Error('member_sms_unavailable');
	let sent = false;
	if (data === true) {
		const text = `YAMADO 確認コード: ${code}\n\n@${new URL(PRIMARY_ORIGIN).hostname} #${code}`;
		const send = sendSmsWith(cfg, { to: phone, text, validityMinutes: 5 }, nttFetch);
		const ctx = event.platform?.context;
		if (!owner && ctx?.waitUntil) ctx.waitUntil(send);
		else sent = (await send).sent;
	}
	// Anonymous callers get the same response even when a number has never been verified.
	if (owner && !sent) return false;
	event.cookies.set(scope.name, await signCookieValue(scope.name, id), {
		path: scope.path, httpOnly: true, secure: true, sameSite: 'strict', maxAge: EXPIRY_SECONDS
	});
	return true;
}

export function hasMemberSmsEnrollment(event: RequestEvent) {
	return Boolean(event.cookies.get(SMS_ENROLL.name));
}

async function consumeMemberSms(event: RequestEvent, token: FormDataEntryValue | null, owner?: Owner) {
	if (!memberSmsAvailable(event.url)) return null;
	const code = String(token ?? '').normalize('NFKC').trim();
	if (!CODE.test(code)) return null;
	const scope = owner ? SMS_ENROLL : SMS_LOGIN;
	const id = await verifyCookieValue(scope.name, event.cookies.get(scope.name));
	if (!id || !UUID.test(id)) return null;
	const { data, error } = await db().rpc('consume_member_sms', {
		p_id: id, p_hash: await smsHash(id, code), p_user: owner?.userId ?? null, p_session: owner?.sessionId ?? null
	});
	if (error || typeof data !== 'string' || !UUID.test(data)) return null;
	event.cookies.delete(scope.name, { path: scope.path });
	return { id, userId: data };
}

export async function verifyMemberSmsEnrollment(event: RequestEvent, token: FormDataEntryValue | null, owner: Owner) {
	return (await consumeMemberSms(event, token, owner))?.userId === owner.userId;
}

export async function loginMemberBySms(event: RequestEvent, token: FormDataEntryValue | null) {
	const proof = await consumeMemberSms(event, token);
	if (!proof) return null;
	const session = await openVerifiedMemberSession(event, proof.userId);
	if (!session) return null;
	try {
		const { data, error } = await db().rpc('mark_member_sms_session', {
			p_id: proof.id, p_session: session.sessionId, p_user: proof.userId
		});
		if (!error && data === true) {
			const destination = await memberLoginDestination(session.user, session.accessToken, event.url.searchParams.get('next') ?? '');
			if (destination) {
				await rememberMemberSmsDefault(event, proof.userId);
				return destination;
			}
		}
	} catch {
		// Revoke the incomplete session before returning to the code form.
	}
	await session.client.auth.signOut({ scope: 'local' });
	return null;
}
