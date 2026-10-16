// 二段階認証の確認（/admin/mfa）「パスキーで確認する」: 応答を確かめ、このセッションを確認済み（aal2 と同じ）にする。
// POST JSON { challengeId, response, next } → { ok:true, next } / { ok:false, message }
import { json } from '@sveltejs/kit';
import { AUTH_MODE } from '$lib/server/auth';
import { safeAdminNext } from '$lib/admin-mfa';
import { AdminPasskeyError, adminPasskeyRp, verifyAdminPasskeyStepUp } from '$lib/server/admin-passkeys';

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
		await verifyAdminPasskeyStepUp(event, { userId: locals.user.id, challengeId: body.challengeId, response: body.response, rp });
	} catch (e) {
		if (e instanceof AdminPasskeyError) return json({ ok: false, message: e.message }, { status: e.status, headers: HEADERS });
		throw e;
	}
	return json({ ok: true, next: safeAdminNext(typeof body.next === 'string' ? body.next : null) }, { headers: HEADERS });
};
