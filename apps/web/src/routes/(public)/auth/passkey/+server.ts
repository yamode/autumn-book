import { json } from '@sveltejs/kit';
import { memberPasskeyRp } from '$lib/server/member-login';
import { memberPasskeyAuthentication, verifyMemberPasskeyLogin } from '$lib/server/member-passkeys';
import { clientIp, ipKey, RATE_RULES, rateCheck, rateHit } from '$lib/server/login-rate-limit';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };

export const POST: RequestHandler = async (event) => {
	const rp = memberPasskeyRp(event.url);
	if (!rp || event.request.headers.get('origin') !== rp.origin) return json({ ok: false }, { status: 403, headers });
	const key = ipKey(clientIp(event.request));
	const rule = RATE_RULES.memberPasskey;
	if ((await rateCheck(event.platform, rule, key)).locked) return json({ ok: false }, { status: 429, headers });
	await rateHit(event.platform, rule, key);
	try {
		const body = await event.request.json() as Record<string, unknown>;
		if (body.action === 'options') return json({ ok: true, ...await memberPasskeyAuthentication(rp) }, { headers });
		if (body.action === 'verify') {
			const next = await verifyMemberPasskeyLogin(event, rp, body);
			if (next) return json({ ok: true, next }, { headers });
		}
	} catch {
		// 認証情報や端末の応答を記録しない。
	}
	return json({ ok: false }, { status: 400, headers });
};
