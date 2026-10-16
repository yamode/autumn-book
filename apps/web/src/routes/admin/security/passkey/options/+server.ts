// 二段階認証・パスキー（/admin/security）「パスキーを追加」: 登録の options を返す。
// 関所（hooks.server.ts）により、第2要素を登録済みの人は確認済み（aal2）のときだけここまで来られる。
// POST JSON {} → { ok:true, challengeId, options } / { ok:false, message }
import { json } from '@sveltejs/kit';
import { AUTH_MODE, getSupabaseUser } from '$lib/server/auth';
import { AdminPasskeyError, adminPasskeyRegistrationOptions, adminPasskeyRp } from '$lib/server/admin-passkeys';
import { clientIp } from '$lib/server/login-rate-limit';

const HEADERS = { 'cache-control': 'no-store' };

export const POST = async (event) => {
	const { locals } = event;
	if (AUTH_MODE !== 'supabase' || !locals.adminAal || !locals.user || (locals.user.role !== 'admin' && locals.user.role !== 'staff')) {
		return json({ ok: false, message: 'ログインの有効期限が切れました。もう一度ログインしてください。' }, { status: 401, headers: HEADERS });
	}
	const rp = adminPasskeyRp(event);
	if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: HEADERS });
	// パスキーの候補に出す名前（メールアドレス）。hooks と同じく Supabase で検証した本人から取る
	const got = await getSupabaseUser(event);
	if (!got || got.user.id !== locals.user.id) {
		return json({ ok: false, message: 'ログインの有効期限が切れました。もう一度ログインしてください。' }, { status: 401, headers: HEADERS });
	}
	try {
		const r = await adminPasskeyRegistrationOptions({
			userId: locals.user.id,
			email: got.user.email ?? locals.user.name,
			name: locals.user.name,
			rp,
			ip: clientIp(event.request)
		});
		return json({ ok: true, ...r }, { headers: HEADERS });
	} catch (e) {
		if (e instanceof AdminPasskeyError) return json({ ok: false, message: e.message }, { status: e.status, headers: HEADERS });
		throw e;
	}
};
