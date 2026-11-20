import { fail } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { AUTH_MODE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import type { Actions, PageServerLoad } from './$types';

// 客室ごとの入口QR（A6 POP「内線電話・館内情報」）の印刷（2026-11-20）。
// QR は /r/start?f=<slug>&k=<部屋の鍵>。部屋の鍵は book.room_entry_keys（推測できない値・部屋ごと）。
// 読んだ端末は、滞在コードなしでも「フロントを呼ぶ」が使える（受電端末に部屋番号が出る）。
// 予約情報・貸切風呂・Wi-Fi は従来どおり 6 桁の滞在コードが要る。
type RoomPop = { roomId: string; roomNumber: string; name: string; qrUrl: string };

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	const slug = facilities.find((f) => f.id === currentFacility.id)?.slug ?? '';
	const base = { facilityName: currentFacility.name, slug, rooms: [] as RoomPop[] };
	if (DATA_SOURCE !== 'supabase' || AUTH_MODE !== 'supabase') return { ...base, error: '実データへの接続が必要です。' };
	try {
		const client = createSupabaseServerClient(event);
		const facilityId = FACILITY_UUID[currentFacility.id] ?? currentFacility.id;
		const { data, error } = await client.schema('book').rpc('admin_room_entry_keys', { p_facility_id: facilityId });
		if (error) throw new Error(error.message);
		const rooms = ((data ?? []) as { room_id: string; room_number: string; display_name: string; key: string }[]).map((r) => ({
			roomId: r.room_id,
			roomNumber: r.room_number,
			name: r.display_name,
			qrUrl: `${event.url.origin}/r/start?f=${encodeURIComponent(slug)}&k=${r.key}`
		}));
		return { ...base, rooms, error: null };
	} catch (e) {
		return { ...base, error: e instanceof Error ? e.message : '部屋の QR を用意できませんでした。' };
	}
};

export const actions: Actions = {
	// 1 部屋だけ鍵を発行し直す（QR を撮られた等。古い QR は使えなくなるので、その部屋の POP を刷り直す）
	reissue: async (event) => {
		const roomId = String((await event.request.formData()).get('room') ?? '');
		if (!/^[0-9a-f-]{36}$/i.test(roomId)) return fail(400, { reissueError: '部屋が分かりません。' });
		if (DATA_SOURCE !== 'supabase' || AUTH_MODE !== 'supabase') return fail(400, { reissueError: '実データへの接続が必要です。' });
		const client = createSupabaseServerClient(event);
		const { error } = await client.schema('book').rpc('admin_reissue_room_entry_key', { p_room_id: roomId });
		if (error) return fail(400, { reissueError: error.message });
		return { reissued: roomId };
	}
};
