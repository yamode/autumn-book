// 管理画面のログイン画面「パスキーでログイン」: 応答を確かめてログインする（パスワード不要・生体認証/PIN 必須）。
// POST JSON { challengeId, response } → { ok:true, next:'/admin' } / { ok:false, message }
// ログインしたセッションははじめからパスキーで確認済み（二段階認証のコード入力は要らない）。
// 失敗はパスワードのログインと同じ「1 IP 10 回/10 分で 15 分止める」に数える。理由は画面に出さずログに残す。
import { json } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { AdminPasskeyError, adminPasskeyRp, loginWithAdminPasskey } from '$lib/server/admin-passkeys';
import { clientIp, ipKey, RATE_RULES, rateCheck, rateHit, rateReset } from '$lib/server/login-rate-limit';

const HEADERS = { 'cache-control': 'no-store' };
const FAILED = 'パスキーでログインできませんでした。メールアドレスとパスワードでお入りください。';

export const POST = async (event) => {
	const rp = adminPasskeyRp(event);
	if (AUTH_MODE !== 'supabase' || !rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: HEADERS });
	const ip = clientIp(event.request);
	const key = ipKey(ip);
	if ((await rateCheck(event.platform, RATE_RULES.adminIp, key)).locked) return json({ ok: false, message: FAILED }, { status: 429, headers: HEADERS });

	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	try {
		const r = await loginWithAdminPasskey(event, { challengeId: body.challengeId, response: body.response, rp, ip });
		if (!r.ok) {
			console.warn('[admin-passkey] ログインに失敗:', r.reason);
			await rateHit(event.platform, RATE_RULES.adminIp, key);
			return json({ ok: false, message: FAILED }, { status: 400, headers: HEADERS });
		}
	} catch (e) {
		if (e instanceof AdminPasskeyError) return json({ ok: false, message: e.message }, { status: e.status, headers: HEADERS });
		throw e;
	}
	await rateReset(event.platform, RATE_RULES.adminIp, key);
	return json({ ok: true, next: '/admin' }, { headers: HEADERS });
};
