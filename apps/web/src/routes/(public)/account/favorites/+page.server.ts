import { facilities, rooms as demoRooms, favoriteRoomsByMember } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbFacilityRooms, sbListFavoriteRooms, sbToggleFavoriteRoom } from '$lib/server/supabase-data';
import type { Actions, PageServerLoad } from './$types';

export interface FavRoom {
	roomId: string;
	name: string;
	roomNumber: string;
	roomTypeName: string;
	favorited: boolean;
}
export interface FavFacility {
	id: string;
	name: string;
	brandSlug: string;
	slug: string;
	prefecture: string;
	photo: string;
	rooms: FavRoom[];
	favCount: number;
}

export const load: PageServerLoad = async (event) => {
	const { locals } = event;
	const pubFacilities = facilities.filter((f) => f.isPublished);

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const favSet = new Set(await sbListFavoriteRooms(client));
		const result: FavFacility[] = [];
		for (const f of pubFacilities) {
			const list = await sbFacilityRooms(client, f.id).catch(() => []);
			const rooms = list.map((r) => ({
				roomId: r.roomId,
				name: r.name,
				roomNumber: r.roomNumber,
				roomTypeName: r.roomTypeName,
				favorited: favSet.has(r.roomId)
			}));
			result.push(toFacility(f, rooms));
		}
		return { facilities: result };
	}

	const favSet = favoriteRoomsByMember.get(locals.user!.id) ?? new Set<string>();
	const result: FavFacility[] = pubFacilities.map((f) => {
		const rooms = demoRooms
			.filter((r) => r.facilityId === f.id)
			.map((r) => ({
				roomId: r.id,
				name: r.name,
				roomNumber: r.roomNumber,
				roomTypeName: r.roomType,
				favorited: favSet.has(r.id)
			}));
		return toFacility(f, rooms);
	});
	return { facilities: result };
};

// 施設メタ + 部屋配列 → 画面用オブジェクト
function toFacility(
	f: (typeof facilities)[number],
	rooms: FavRoom[]
): FavFacility {
	return {
		id: f.id,
		name: f.name,
		brandSlug: f.brandSlug,
		slug: f.slug,
		prefecture: f.prefecture,
		photo: f.photos[0]?.url ?? '',
		rooms,
		favCount: rooms.filter((r) => r.favorited).length
	};
}

export const actions: Actions = {
	toggle: async (event) => {
		const { request, locals } = event;
		const form = await request.formData();
		const roomId = String(form.get('roomId'));

		if (MEMBER_SUPABASE) {
			await sbToggleFavoriteRoom(createSupabaseServerClient(event), roomId);
			return { ok: true };
		}

		let favs = favoriteRoomsByMember.get(locals.user!.id);
		if (!favs) {
			favs = new Set();
			favoriteRoomsByMember.set(locals.user!.id, favs);
		}
		if (favs.has(roomId)) favs.delete(roomId);
		else favs.add(roomId);
		return { ok: true };
	}
};
