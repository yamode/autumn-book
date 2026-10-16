// 二段階認証の確認（/admin/mfa）「パスキーで確認する」: options を返す。
// POST JSON {} → { ok:true, challengeId, options } / { ok:false, message }
import { json } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { AdminPasskeyError, adminPasskeyRp, adminPasskeyStepUpOptions } from '$lib/server/admin-passkeys';
import { clientIp } from '$lib/server/login-rate-limit';

const HEADERS = { 'cache-control': 'no-store' };

export const POST = async (event) => {
	const { locals } = event;
	if (AUTH_MODE !== 'supabase' || !locals.adminAal || !locals.user || (locals.user.role !== 'admin' && locals.user.role !== 'staff')) {
		return json({ ok: false, message: 'ログインの有効期限が切れました。もう一度ログインしてください。' }, { status: 401, headers: HEADERS });
	}
	const rp = adminPasskeyRp(event);
	if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: HEADERS });
	try {
		return json({ ok: true, ...(await adminPasskeyStepUpOptions({ userId: locals.user.id, rp, ip: clientIp(event.request) })) }, { headers: HEADERS });
	} catch (e) {
		if (e instanceof AdminPasskeyError) return json({ ok: false, message: e.message }, { status: e.status, headers: HEADERS });
		throw e;
	}
};
