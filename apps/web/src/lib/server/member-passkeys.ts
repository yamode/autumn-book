import {
	generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
	type AuthenticationResponseJSON, type RegistrationResponseJSON, type WebAuthnCredential
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type { RequestEvent } from '@sveltejs/kit';
import { adminRoleOf, isBanned, jwtSessionId } from '$lib/admin-passkey';
import { isCredentialId, passkeyDeviceName, type PasskeyRp } from '$lib/partner-passkey';
import { safeNext } from '$lib/safe-next';
import { createSupabaseServerClient } from '$lib/server/auth';
import { defaultMemberPasskeyName } from '$lib/server/member-passkey-name';
import { memberLoginState } from '$lib/server/member-login';
import { partnerServiceClient } from '$lib/server/partners/admin-client';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const USER_TIMEOUT = 120_000;
const ALGORITHMS = [-7, -257];
const db = () => {
	const svc = partnerServiceClient();
	if (!svc) throw new Error('passkey_unavailable');
	return svc.schema('book');
};
type Owner = { userId: string; sessionId: string };
type KeyRow = {
	id: string; user_id: string; credential_id: string; public_key: string; counter: number;
	transports: WebAuthnCredential['transports'] | null; device_name: string; created_at: string; last_used_at: string | null;
};

export async function listMemberPasskeys(userId: string) {
	const { data, error } = await db().from('member_passkeys').select('id, device_name, created_at, last_used_at')
		.eq('user_id', userId).order('created_at', { ascending: false });
	if (error) throw error;
	return data as Pick<KeyRow, 'id' | 'device_name' | 'created_at' | 'last_used_at'>[];
}

async function saveChallenge(rp: PasskeyRp, challenge: string, owner?: Owner) {
	const book = db();
	const now = new Date().toISOString();
	await book.from('member_passkey_challenges').delete().lt('expires_at', now);
	const { data, error } = await book.from('member_passkey_challenges').insert({
		user_id: owner?.userId ?? null, session_id: owner?.sessionId ?? null, origin: rp.origin, challenge
	}).select('id').single();
	if (error) throw error;
	return data.id as string;
}

async function takeChallenge(id: unknown, rp: PasskeyRp, owner?: Owner) {
	if (typeof id !== 'string' || !UUID.test(id)) return null;
	const query = db().from('member_passkey_challenges').delete()
		.eq('id', id).eq('origin', rp.origin).gt('expires_at', new Date().toISOString());
	const owned = owner ? query.eq('user_id', owner.userId).eq('session_id', owner.sessionId) : query.is('user_id', null);
	const { data, error } = await owned.select('challenge').maybeSingle();
	if (error) throw error;
	return (data?.challenge as string | undefined) ?? null;
}

export async function memberPasskeyRegistration(rp: PasskeyRp, owner: Owner, email: string, securityKey: boolean) {
	const { data, error } = await db().from('member_passkeys').select('credential_id, transports').eq('user_id', owner.userId);
	if (error) throw error;
	if (data.length >= 20) throw new Error('passkey_limit');
	const options = await generateRegistrationOptions({
		rpID: rp.rpID, rpName: 'YAMADO Book', userName: email, userDisplayName: `${email} (YAMADO Book)`,
		userID: new TextEncoder().encode(owner.userId), attestationType: 'none', timeout: USER_TIMEOUT,
		excludeCredentials: data.map((key) => ({ id: key.credential_id, transports: key.transports ?? undefined })),
		authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
		preferredAuthenticatorType: securityKey ? 'securityKey' : undefined,
		supportedAlgorithmIDs: ALGORITHMS
	});
	return { options, challengeId: await saveChallenge(rp, options.challenge, owner) };
}

export async function verifyMemberPasskeyRegistration(rp: PasskeyRp, owner: Owner, body: Record<string, unknown>, userAgent: string) {
	const challenge = await takeChallenge(body.challengeId, rp, owner);
	const response = body.response as RegistrationResponseJSON | undefined;
	if (!challenge || !response || !isCredentialId(response.id)) throw new Error('bad_passkey_registration');
	const result = await verifyRegistrationResponse({
		response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID,
		requireUserVerification: true, supportedAlgorithmIDs: ALGORITHMS
	});
	if (!result.verified) throw new Error('bad_passkey_registration');
	const { credential, aaguid, credentialDeviceType } = result.registrationInfo;
	const defaultName = defaultMemberPasskeyName({
		aaguid, deviceBound: credentialDeviceType === 'singleDevice',
		attachment: response.authenticatorAttachment, transports: credential.transports, userAgent
	});
	const { error } = await db().rpc('add_member_passkey', {
		p_user: owner.userId, p_credential: credential.id, p_public_key: isoBase64URL.fromBuffer(credential.publicKey),
		p_counter: credential.counter, p_transports: credential.transports ?? null,
		p_name: passkeyDeviceName(typeof body.name === 'string' ? body.name : '', defaultName)
	});
	if (error) throw error;
}

export async function removeMemberPasskey(userId: string, id: string) {
	if (!UUID.test(id)) return false;
	const { data, error } = await db().from('member_passkeys').delete().eq('id', id).eq('user_id', userId).select('id').maybeSingle();
	if (error) throw error;
	return Boolean(data);
}

export async function renameMemberPasskey(userId: string, id: string, name: string) {
	if (!UUID.test(id)) return false;
	const { data, error } = await db().from('member_passkeys').update({ device_name: name })
		.eq('id', id).eq('user_id', userId).select('id').maybeSingle();
	if (error) throw error;
	return Boolean(data);
}

export async function memberPasskeyAuthentication(rp: PasskeyRp) {
	const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: 'required', timeout: USER_TIMEOUT });
	return { options, challengeId: await saveChallenge(rp, options.challenge) };
}

export async function verifyMemberPasskeyLogin(event: RequestEvent, rp: PasskeyRp, body: Record<string, unknown>) {
	const challenge = await takeChallenge(body.challengeId, rp);
	const response = body.response as AuthenticationResponseJSON | undefined;
	if (!challenge || !response || !isCredentialId(response.id)) return null;
	const { data, error } = await db().from('member_passkeys')
		.select('id, user_id, credential_id, public_key, counter, transports').eq('credential_id', response.id).maybeSingle();
	if (error || !data) return null;
	const row = data as KeyRow;
	const verified = await verifyAuthenticationResponse({
		response, expectedChallenge: challenge, expectedOrigin: rp.origin, expectedRPID: rp.rpID, requireUserVerification: true,
		credential: { id: row.credential_id, publicKey: isoBase64URL.toBuffer(row.public_key), counter: row.counter, transports: row.transports ?? undefined },
	});
	if (!verified.verified || !(await memberLoginState(row.user_id, null)).active) return null;
	const update = await db().from('member_passkeys').update({
		counter: verified.authenticationInfo.newCounter, last_used_at: new Date().toISOString()
	}).eq('id', row.id).eq('counter', row.counter).select('id').maybeSingle();
	if (update.error || !update.data) return null;
	const svc = partnerServiceClient()!;
	const { data: authUser, error: userError } = await svc.auth.admin.getUserById(row.user_id);
	const user = authUser?.user;
	if (userError || !user?.email || adminRoleOf(user.app_metadata) || isBanned((user as { banned_until?: string | null }).banned_until)) return null;
	const { data: link, error: linkError } = await svc.auth.admin.generateLink({ type: 'magiclink', email: user.email });
	if (linkError || !link?.properties?.hashed_token || link.user.id !== user.id) return null;
	const client = createSupabaseServerClient(event);
	const { data: signedIn, error: signInError } = await client.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token });
	const sessionId = jwtSessionId(signedIn.session?.access_token);
	if (!signInError && sessionId && signedIn.user?.id === row.user_id) {
		const { error: markError } = await db().from('member_passkey_sessions').insert({ session_id: sessionId, user_id: row.user_id, passkey_id: row.id });
		if (!markError) return safeNext(typeof body.next === 'string' ? body.next : null, '/account');
	}
	if (signedIn.session) await client.auth.signOut({ scope: 'local' });
	return null;
}
