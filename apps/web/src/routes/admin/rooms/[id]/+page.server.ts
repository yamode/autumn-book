// 管理画面: 部屋タイプ紹介の編集（book.room_type_contents）。
// 保存は ADMIN_SUPABASE のときだけ。それ以外は黙って成功させず NOT_LIVE を返す（/admin/bath と同じ）。
import { error, fail } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbFacilityByUuid } from '$lib/server/supabase-data';
import { sbGetRoomContentAdmin, sbSaveRoomContent } from '$lib/server/content-admin';
import {
	LIVE,
	NOT_LIVE,
	currentFacilityOf,
	demoRoomContents,
	denyIfNotStaff,
	draftFromRequest,
	facilityUuidOf,
	messageOf,
	uploadPhotoAction
} from '$lib/server/admin-content-page';
import { facilityById } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	if (!LIVE) {
		const room = demoRoomContents(currentFacility.id).find((r) => r.id === event.params.id);
		if (!room) error(404, '部屋タイプが見つかりません（施設を切り替えた場合は一覧から選び直してください）');
		const f = facilityById(currentFacility.id);
		return { room, live: false, previewBase: f ? `/${f.brandSlug}/${f.slug}` : null };
	}
	const uuid = facilityUuidOf(currentFacility.id);
	const client = createSupabaseServerClient(event);
	let room;
	try {
		room = await sbGetRoomContentAdmin(client, uuid, event.params.id);
	} catch (e) {
		error(500, messageOf(e));
	}
	if (!room) error(404, '部屋タイプが見つかりません（施設を切り替えた場合は一覧から選び直してください）');
	// プレビューの URL は公開ビューの施設 slug から作る（読めなければリンクを出さない）
	const f = await sbFacilityByUuid(uuid).catch(() => undefined);
	return { room, live: true, previewBase: f ? `/${f.brandSlug}/${f.slug}` : null };
};

export const actions: Actions = {
	save: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) return fail(503, { error: NOT_LIVE });
		const draft = await draftFromRequest(event, 'room');
		try {
			await sbSaveRoomContent(
				createSupabaseServerClient(event),
				currentFacilityOf(event).uuid,
				event.params.id,
				draft
			);
			return { saved: true };
		} catch (e) {
			return fail(400, { error: messageOf(e) });
		}
	},
	upload: (event) => uploadPhotoAction(event, 'rooms')
};
