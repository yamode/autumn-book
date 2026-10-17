// 二段階認証・パスキー（/admin/security）「スマホに追加する QR を出す」（2026-10-17）。
// PC に Bluetooth が無いとブラウザの「別のデバイス（スマホ）に保存」が出ないため、1回限りの登録 QR（10 分）を出す。
// 関所（hooks.server.ts）により、第2要素を登録済みの人は確認済み（aal2）のときだけここまで来られる。
// POST JSON {} → { ok:true, url, svg, expiresAt } / { ok:false, message }
import { json } from '@sveltejs/kit';
import qrcode from 'qrcode-generator';
import { AUTH_MODE, getSupabaseUser } from '$lib/server/auth';
import { AdminPasskeyError, adminPasskeyRp, issueAdminPasskeyEnrollLink } from '$lib/server/admin-passkeys';
import { clientIp } from '$lib/server/login-rate-limit';

const HEADERS = { 'cache-control': 'no-store' };

export const POST = async (event) => {
	const { locals } = event;
	if (AUTH_MODE !== 'supabase' || !locals.adminAal || !locals.user || (locals.user.role !== 'admin' && locals.user.role !== 'staff')) {
		return json({ ok: false, message: 'ログインの有効期限が切れました。もう一度ログインしてください。' }, { status: 401, headers: HEADERS });
	}
	const rp = adminPasskeyRp(event);
	if (!rp) return json({ ok: false, message: 'このページのアドレスではパスキーを使えません。' }, { status: 404, headers: HEADERS });
	const got = await getSupabaseUser(event);
	if (!got || got.user.id !== locals.user.id) {
		return json({ ok: false, message: 'ログインの有効期限が切れました。もう一度ログインしてください。' }, { status: 401, headers: HEADERS });
	}
	try {
		const r = await issueAdminPasskeyEnrollLink({ userId: locals.user.id, origin: rp.origin, ip: clientIp(event.request) });
		const q = qrcode(0, 'M');
		q.addData(r.url);
		q.make();
		// 自己生成の SVG（画面で {@html} する）
		return json({ ok: true, url: r.url, expiresAt: r.expiresAt, svg: q.createSvgTag({ cellSize: 4, margin: 2 }) }, { headers: HEADERS });
	} catch (e) {
		if (e instanceof AdminPasskeyError) return json({ ok: false, message: e.message }, { status: e.status, headers: HEADERS });
		throw e;
	}
};
