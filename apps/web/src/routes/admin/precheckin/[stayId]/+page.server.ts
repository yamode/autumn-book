// 事前チェックインの回答の中身（修正差分・到着・ご要望・食事）。
// 連絡先の修正は Book に保存されているだけで、PMS には反映されていない（スタッフが確認して PMS で直す。P5 で反映ボタン）。
import { error } from '@sveltejs/kit';
import { ADMIN_SUPABASE } from '$lib/server/auth';
import { bookAdmin, mapRpcError } from '$lib/server/admin-app-data';
import { toFacilityUuidStrict } from '$lib/server/supabase-data';
import { adminPrecheckinDetail, type PrecheckinDetail } from '$lib/server/precheckin';
import { adminSmsDetail, type SmsDetail } from '$lib/server/precheckin-sms';
import { normalizePrecheckinContext, type PcContext } from '$lib/precheckin';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!ADMIN_SUPABASE) error(404, 'この環境では表示できません');
	const stayId = event.params.stayId;
	if (!/^[0-9a-f-]{36}$/.test(stayId)) error(404, '見つかりません');
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
