import { fail, redirect } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { MEMBER_LOGIN_METHODS, memberPasskeysAvailable } from '$lib/server/member-login';
import { RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';
import { safeNext } from '$lib/safe-next';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store' });
	const next = safeNext(event.url.searchParams.get('next'), '/account');
	if (event.locals.user?.role === 'member') redirect(303, next);
	const pending = event.locals.memberMfaPending;
	if (!MEMBER_LOGIN_METHODS || !pending) redirect(303, `/auth/login?next=${encodeURIComponent(next)}`);
	const passkeys = memberPasskeysAvailable(event.url);
	if (pending.unavailable) return { next, passkeys, unavailable: true, factors: [] };
	const { data, error } = await createSupabaseServerClient(event).auth.mfa.listFactors();
	return {
		next, passkeys, unavailable: Boolean(error || !data?.totp.length),
		factors: (data?.totp ?? []).map((factor) => ({ id: factor.id, name: factor.friendly_name ?? '' }))
	};
};

export const actions: Actions = {
	default: async (event) => {
		const pending = event.locals.memberMfaPending;
		if (!MEMBER_LOGIN_METHODS || !pending || pending.unavailable) return fail(403, { verified: false });
		const form = await event.request.formData();
		const factorId = String(form.get('factorId') ?? '');
		const code = String(form.get('code') ?? '').normalize('NFKC').trim();
		const { memberTotp } = RATE_RULES;
		if (!/^\d{6}$/.test(code) || (await rateCheck(event.platform, memberTotp, pending.id)).locked) {
			return fail(400, { verified: false });
		}
		const client = createSupabaseServerClient(event);
		const { data } = await client.auth.mfa.listFactors();
		if (!data?.totp.some((factor) => factor.id === factorId)) return fail(400, { verified: false });
		const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code });
		if (error) {
			await rateHit(event.platform, memberTotp, pending.id);
			return fail(400, { verified: false });
		}
		await rateReset(event.platform, memberTotp, pending.id);
		redirect(303, safeNext(event.url.searchParams.get('next'), '/account'));
	}
};
