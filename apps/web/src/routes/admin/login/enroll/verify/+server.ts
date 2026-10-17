// スマホ用の登録 QR（/admin/login/enroll）: 登録の応答を確かめて保存する（2026-10-17）。
// QR はここで使い切る。スマホのセッションは作らない（このあと「パスキーでログイン」で入る）。
// POST JSON { t, challengeId, response, name } → { ok:true, passkey } / { ok:false, message }
import { json } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { AdminPasskeyError, adminPasskeyRp, verifyAdminPasskeyEnroll } from '$lib/server/admin-passkeys';
import { clientIp } from '$lib/server/login-rate-limit';

const HEADERS = { 'cache-control': 'no-store' };

export const POST = async (event) => {
	const rp = adminPasskeyRp(event);
	if (AUTH_MODE !== 'supabase' || !rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: HEADERS });
	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	try {
		const passkey = await verifyAdminPasskeyEnroll(event, {
			token: body.t,
			challengeId: body.challengeId,
			response: body.response,
			deviceName: body.name,
			rp,
			ip: clientIp(event.request)
		});
		return json({ ok: true, passkey }, { headers: HEADERS });
	} catch (e) {
		if (e instanceof AdminPasskeyError) return json({ ok: false, message: e.message }, { status: e.status, headers: HEADERS });
		throw e;
	}
};
