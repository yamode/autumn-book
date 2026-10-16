// 二段階認証・パスキー（/admin/security）「パスキーを追加」: 登録の応答を確かめて保存する。
// 保存したら、このセッションはパスキーで確認済みになる（認証アプリの登録と同じく、そのまま使い続けられる）。
// POST JSON { challengeId, response, name } → { ok:true, passkey } / { ok:false, message }
import { json } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { AdminPasskeyError, adminPasskeyRp, verifyAdminPasskeyRegistration } from '$lib/server/admin-passkeys';
import { clientIp } from '$lib/server/login-rate-limit';

const HEADERS = { 'cache-control': 'no-store' };

export const POST = async (event) => {
	const { locals } = event;
	if (AUTH_MODE !== 'supabase' || !locals.adminAal || !locals.user || (locals.user.role !== 'admin' && locals.user.role !== 'staff')) {
		return json({ ok: false, message: 'ログインの有効期限が切れました。もう一度ログインしてください。' }, { status: 401, headers: HEADERS });
	}
	const rp = adminPasskeyRp(event);
	if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: HEADERS });
	const body = (await event.request.json().catch(() => ({}))) as Record<string, unknown>;
	try {
		const passkey = await verifyAdminPasskeyRegistration(event, {
			userId: locals.user.id,
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
