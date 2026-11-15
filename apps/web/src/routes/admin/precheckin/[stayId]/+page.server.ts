// 事前チェックインの回答の中身（修正差分・到着・ご要望・食事）。
// 連絡先の修正は Book に保存されているだけで、PMS には反映されていない（スタッフが確認して PMS で直す。P5 で反映ボタン）。
import { error, redirect } from '@sveltejs/kit';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { bookAdmin, mapRpcError } from '$lib/server/admin-app-data';
import { FACILITY_UUID, toFacilityUuidStrict } from '$lib/server/supabase-data';
import { facilities } from '$lib/server/store';
import { adminPrecheckinDetail, type PrecheckinDetail } from '$lib/server/precheckin';
import { adminSmsDetail, type SmsDetail } from '$lib/server/precheckin-sms';
import { normalizePrecheckinContext, type PcContext } from '$lib/precheckin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) error(404, 'この環境では表示できません');
	const stayId = event.params.stayId;
	if (!/^[0-9a-f-]{36}$/.test(stayId)) error(404, '見つかりません');
	// 宿への通知メールのリンク（?facility=<core.facilities.id>）: その施設に切り替えてから開き直す（/admin/switch と同じ Cookie）
	const facQ = event.url.searchParams.get('facility');
	if (facQ) {
		const bookId = facilities.some((f) => f.id === facQ)
			? facQ
			: Object.entries(FACILITY_UUID).find(([, uuid]) => uuid === facQ.toLowerCase())?.[0];
		if (bookId) event.cookies.set('ab_fac', bookId, { path: '/admin', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 });
		redirect(303, event.url.pathname);
	}
	const { currentFacility } = await event.parent();
	const empty: SmsDetail = { dispatches: [], inbound: [] };
	try {
		const client = bookAdmin(event);
		const facility = toFacilityUuidStrict(currentFacility.id);
		const [d, sms] = await Promise.all([
			adminPrecheckinDetail(client, facility, stayId),
			// SMS の送信履歴と返信（P4 の DB が未適用なら空）
			adminSmsDetail(client, facility, stayId).catch(() => empty)
		]);
		// 部屋・泊・食事は、フォームと同じ形に整える（時間枠は使わないので空）
		const shaped = normalizePrecheckinContext({ ok: true, rooms: d.rooms, slots: {} });
		const rooms: PcContext['rooms'] = 'error' in shaped ? [] : shaped.rooms;
		return { detail: d as PrecheckinDetail, rooms, sms, error: null as string | null };
	} catch (e) {
		return { detail: null as PrecheckinDetail | null, rooms: [] as PcContext['rooms'], sms: empty, error: mapRpcError(e) };
	}
};
