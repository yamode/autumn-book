import { json } from '@sveltejs/kit';
import { memberPasskeyRp, memberSecurityContext } from '$lib/server/member-login';
import { memberPasskeyRegistration, verifyMemberPasskeyRegistration } from '$lib/server/member-passkeys';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };

export const POST: RequestHandler = async (event) => {
	const rp = memberPasskeyRp(event.url);
	if (!rp || event.request.headers.get('origin') !== rp.origin) return json({ ok: false }, { status: 403, headers });
	try {
		const security = await memberSecurityContext(event);
		if (!security?.recent) return json({ ok: false }, { status: 403, headers });
		const body = await event.request.json() as Record<string, unknown>;
		if (body.action === 'options') {
			const { data, error } = await security.client.auth.getUser();
			if (error || !data.user?.email || data.user.id !== security.userId) return json({ ok: false }, { status: 403, headers });
			return json({ ok: true, ...await memberPasskeyRegistration(rp, security, data.user.email, body.securityKey === true) }, { headers });
		}
		if (body.action === 'verify') {
			await verifyMemberPasskeyRegistration(rp, security, body);
			return json({ ok: true }, { headers });
		}
	} catch {
		// 認証情報や端末の応答を記録しない。
	}
	return json({ ok: false }, { status: 400, headers });
};
