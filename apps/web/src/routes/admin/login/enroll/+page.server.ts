import { AUTH_MODE } from '$lib/server/auth';
import { adminPasskeyAvailable, adminPasskeyEnrollOwner } from '$lib/server/admin-passkeys';
import type { PageServerLoad } from './$types';

// スマホ用の登録 QR の着地点（2026-10-17）。/admin/login の下なので、ログインしていないスマホでも開ける（関所の外）。
// QR の中身（t）が有効なら、だれのパスキーを登録するかを出す。使い切りは登録を終えたとき（開いただけでは使わない）
export const load: PageServerLoad = async (event) => {
	event.setHeaders({ 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
	const t = event.url.searchParams.get('t') ?? '';
	const available = AUTH_MODE === 'supabase' && adminPasskeyAvailable(event);
	const owner = available ? await adminPasskeyEnrollOwner(t).catch(() => null) : null;
	return { t: owner ? t : '', available, owner };
};
