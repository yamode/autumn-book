// 管理画面: 部屋タイプ紹介の一覧（book.room_type_contents × pms.room_types）。
// 編集は /admin/rooms/[id]。部屋タイプの新設・定員・室数は PMS 側で行う。
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbListRoomContentsAdmin, type AdminRoomContent } from '$lib/server/content-admin';
import { LIVE, NOT_LIVE, demoRoomContents, facilityUuidOf, messageOf } from '$lib/server/admin-content-page';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	if (!LIVE) {
		return { rooms: demoRoomContents(currentFacility.id), live: false, loadError: NOT_LIVE };
	}
	let rooms: AdminRoomContent[] = [];
	let loadError: string | null = null;
	try {
		rooms = await sbListRoomContentsAdmin(createSupabaseServerClient(event), facilityUuidOf(currentFacility.id));
	} catch (e) {
		loadError = messageOf(e);
	}
	return { rooms, live: true, loadError };
};
