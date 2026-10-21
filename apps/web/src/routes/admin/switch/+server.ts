import { redirect } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import type { RequestHandler } from './$types';

/**
 * 戻り先を「その画面の一覧」（/admin/<section>）に丸める。
 * 詳細ページ（/admin/rooms/<id> 等）の ID は切替前の施設のものなので、そのまま戻すと 404 になる。
 * /admin 以外（外部 URL 等）へは戻さない。
 */
function sectionRoot(back: string | null): string {
	// 取引先の詳細は施設によらない（取引先は Book で1つ・施設はタブ）。切り替えても詳細に戻す（複数施設化 S3・2026-10-09）
	const partner = /^\/admin\/partners\/[0-9a-f-]{36}$/i.exec(back ?? '');
	if (partner) return partner[0];
	const m = /^\/admin(\/[a-z0-9-]+)?/.exec(back ?? '');
	return m ? m[0] : '/admin';
}

/**
 * ?f= を Book の施設 ID（f-nishiwaga 等）にそろえる。
 * PMS のトップの「Book」ボタンは、PMS で開いている施設の UUID（core.facilities.id）を渡してくる（2026-10-22）。
 * 知らない値は無視する（以前は何でも Cookie に入れていた）。
 */
function bookFacilityId(raw: string | null): string | null {
	if (!raw) return null;
	if (facilities.some((f) => f.id === raw)) return raw;
	const byUuid = Object.entries(FACILITY_UUID).find(([, uuid]) => uuid === raw.toLowerCase());
	return byUuid ? byUuid[0] : null;
}

export const GET: RequestHandler = async ({ url, cookies }) => {
	const f = bookFacilityId(url.searchParams.get('f'));
	// ブラウザを閉じても選んだ施設を覚えておく（閉じると先頭の施設に戻り、別施設を編集する事故になるため）
	if (f) cookies.set('ab_fac', f, { path: '/admin', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
	redirect(303, sectionRoot(url.searchParams.get('back')));
};
