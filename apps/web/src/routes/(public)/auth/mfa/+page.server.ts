import { fail, redirect } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { MEMBER_LOGIN_METHODS, memberPasskeysAvailable, verifyMemberTotp } from '$lib/server/member-login';
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
		const client = createSupabaseServerClient(event);
		if (await verifyMemberTotp(event, client, pending.id, form) !== 'verified') return fail(400, { verified: false });
		redirect(303, safeNext(event.url.searchParams.get('next'), '/account'));
	}
};
