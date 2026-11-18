import { fail, redirect } from '@sveltejs/kit';
import { MEMBER_LOGIN_METHODS, MEMBER_SECURITY_PATH, memberMfaPath, memberPasskeysAvailable, memberSecurityContext } from '$lib/server/member-login';
import { listMemberPasskeys, removeMemberPasskey } from '$lib/server/member-passkeys';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';
import type { Actions, PageServerLoad } from './$types';

const TOTP_NAME = 'YAMADO Book';
type Issue = 'recent' | 'password' | 'unavailable' | 'code' | 'retainKey';
const rejected = (issue: Issue, status = 400) => fail(status, { issue });

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	if (!MEMBER_LOGIN_METHODS) redirect(303, '/account/settings');
	if (event.locals.memberMfaPending) redirect(303, memberMfaPath(MEMBER_SECURITY_PATH));
	if (event.locals.user?.role !== 'member') redirect(303, `/auth/login?next=${encodeURIComponent(MEMBER_SECURITY_PATH)}`);
	const security = await memberSecurityContext(event).catch(() => null);
	if (!security) return { unavailable: true, recent: false, passkeysAvailable: false, keys: [], factors: [] };
	try {
		const [keys, { data, error }] = await Promise.all([listMemberPasskeys(security.userId), security.client.auth.mfa.listFactors()]);
		if (error) throw error;
		return {
			unavailable: false, recent: security.recent, passkeysAvailable: memberPasskeysAvailable(event.url), keys,
			factors: (data?.totp ?? []).map((factor) => ({ id: factor.id, name: factor.friendly_name ?? TOTP_NAME }))
		};
	} catch {
		return { unavailable: true, recent: false, passkeysAvailable: false, keys: [], factors: [] };
	}
};

export const actions: Actions = {
	password: async (event) => {
		const security = await memberSecurityContext(event).catch(() => null);
		if (!security?.recent) return rejected('recent', 403);
		const form = await event.request.formData();
		const password = String(form.get('password') ?? '');
		// Supabase passwords are hashed with bcrypt. Do not accept input that would be truncated.
		const bytes = new TextEncoder().encode(password).length;
		if (password.length < 12 || bytes > 72 || password !== form.get('confirm')) return rejected('password');
		const { error } = await security.client.auth.updateUser({ password });
		if (error) return rejected('password');
		return { saved: 'password' as const };
	},
	removePasskey: async (event) => {
		const security = await memberSecurityContext(event).catch(() => null);
		if (!security?.recent) return rejected('recent', 403);
		const id = String((await event.request.formData()).get('id') ?? '');
		if (security.hasTotp && !security.aal2 && (await listMemberPasskeys(security.userId)).length === 1) return rejected('retainKey');
		if (!(await removeMemberPasskey(security.userId, id).catch(() => false))) return rejected('unavailable');
		return { saved: 'key' as const };
	},
	enroll: async (event) => {
		const security = await memberSecurityContext(event).catch(() => null);
		if (!security?.recent) return rejected('recent', 403);
		if (security.hasTotp) return rejected('unavailable');
		const { data: listed, error: listError } = await security.client.auth.mfa.listFactors();
		if (listError) return rejected('unavailable');
		for (const factor of listed.all) {
			if (factor.factor_type === 'totp' && factor.status === 'unverified' && factor.friendly_name === TOTP_NAME) {
				await security.client.auth.mfa.unenroll({ factorId: factor.id });
			}
		}
		const { data, error } = await security.client.auth.mfa.enroll({ factorType: 'totp', issuer: TOTP_NAME, friendlyName: TOTP_NAME });
		if (error || !data) return rejected('unavailable');
		return { enroll: { id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret } };
	},
	verifyTotp: async (event) => {
		const security = await memberSecurityContext(event).catch(() => null);
		if (!security?.recent) return rejected('recent', 403);
		const form = await event.request.formData();
		const code = String(form.get('code') ?? '').normalize('NFKC').trim();
		const id = String(form.get('id') ?? '');
		if (!/^\d{6}$/.test(code)) return rejected('code');
		const rule = RATE_RULES.memberTotp;
		if ((await rateCheck(event.platform, rule, security.userId)).locked) return rejected('code', 429);
		const { data } = await security.client.auth.mfa.listFactors();
		if (!data?.all.some((factor) => factor.id === id && factor.factor_type === 'totp' && factor.status === 'unverified' && factor.friendly_name === TOTP_NAME)) return rejected('unavailable');
		const { error } = await security.client.auth.mfa.challengeAndVerify({ factorId: id, code });
		if (error) {
			await rateHit(event.platform, rule, security.userId);
			return rejected('code');
		}
		await rateReset(event.platform, rule, security.userId);
		return { saved: 'totp' as const };
	},
	removeTotp: async (event) => {
		const security = await memberSecurityContext(event).catch(() => null);
		if (!security?.recent) return rejected('recent', 403);
		const id = String((await event.request.formData()).get('id') ?? '');
		const { data } = await security.client.auth.mfa.listFactors();
		if (!data?.totp.some((factor) => factor.id === id)) return rejected('unavailable');
		if (!security.aal2 && !security.passkey) return rejected('recent', 403);
		// パスキーで再確認できた本人は、紛失した認証アプリを取り外せる。
		const result = security.aal2
			? await security.client.auth.mfa.unenroll({ factorId: id })
			: await partnerServiceClient()?.auth.admin.mfa.deleteFactor({ id, userId: security.userId });
		if (!result || result.error) return rejected('unavailable');
		return { saved: 'totp' as const };
	}
};
