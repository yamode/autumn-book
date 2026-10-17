// スマホ用の登録 QR（/admin/login/enroll）: 登録の options を返す（2026-10-17・lib/server/admin-passkeys.ts）。
// スマホはログインしていない。QR の中身（t）で持ち主を確かめ、その人のパスキーとして作る。
// POST JSON { t } → { ok:true, challengeId, options } / { ok:false, message }
// 試行の制限: 管理画面のログインの 1 IP のロック中は出さない。発行も 1 IP 10 分 30 回まで（ログインの options と共通）。
import { json } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { AdminPasskeyError, adminPasskeyEnrollOptions, adminPasskeyRp } from '$lib/server/admin-passkeys';
import { clientIp, ipKey, RATE_RULES, rateCheck, rateHit } from '$lib/server/login-rate-limit';

const HEADERS = { 'cache-control': 'no-store' };

export const POST = async (event) => {
	const rp = adminPasskeyRp(event);
	if (AUTH_MODE !== 'supabase' || !rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: HEADERS });
	const ip = clientIp(event.request);
	const key = `admin:${ipKey(ip)}`;
	const [byIp, byOpts] = await Promise.all([
		rateCheck(event.platform, RATE_RULES.adminIp, ipKey(ip)),
		rateCheck(event.platform, RATE_RULES.passkeyLoginOptionsIp, key)
	]);
	if (byIp.locked || byOpts.locked) {
		return json({ ok: false, message: 'しばらくの間制限しています。数分おいてからお試しください。' }, { status: 429, headers: HEADERS });
	}
	await rateHit(event.platform, RATE_RULES.passkeyLoginOptionsIp, key);
	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	try {
		return json({ ok: true, ...(await adminPasskeyEnrollOptions({ token: body.t, rp, ip })) }, { headers: HEADERS });
	} catch (e) {
		if (e instanceof AdminPasskeyError) return json({ ok: false, message: e.message }, { status: e.status, headers: HEADERS });
		throw e;
	}
};
