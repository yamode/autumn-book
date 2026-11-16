import { fail } from '@sveltejs/kit';
import { facilities, rooms as demoRooms, favoriteRoomsByMember } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbFacilityRooms, sbListFavoriteRooms, sbToggleFavoriteRoom } from '$lib/server/supabase-data';
import { canUseFavoriteRooms } from '$lib/member-benefits';
import { viewerOf } from '$lib/server/secret-plans';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export interface FavRoom {
	roomId: string;
	name: string;
	roomNumber: string;
	roomTypeName: string;
	favorited: boolean;
}
export interface FavType {
	name: string;
	rooms: FavRoom[];
	favCount: number;
}
export interface FavFacility {
	id: string;
	name: string;
	brandSlug: string;
	slug: string;
	prefecture: string;
	photo: string;
	types: FavType[];
	favCount: number;
}

export const load: PageServerLoad = async (event) => {
	const { locals } = event;
	if (!canUseFavoriteRooms(await viewerOf(locals))) return { canUseFavorites: false, facilities: [] };
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
		return { canUseFavorites: true, facilities: result };
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
	return { canUseFavorites: true, facilities: result };
};

// 施設メタ + 部屋配列 → 画面用オブジェクト（客室タイプごとにグルーピング）
function toFacility(
	f: (typeof facilities)[number],
	rooms: FavRoom[]
): FavFacility {
	// 出現順を保ったままタイプ別にまとめる
	const order: string[] = [];
	const byType = new Map<string, FavRoom[]>();
	for (const r of rooms) {
		const key = r.roomTypeName || 'その他';
		if (!byType.has(key)) {
			byType.set(key, []);
			order.push(key);
		}
		byType.get(key)!.push(r);
	}
	const types: FavType[] = order.map((name) => {
		const list = byType.get(name)!;
		return { name, rooms: list, favCount: list.filter((r) => r.favorited).length };
	});
	return {
		id: f.id,
		name: f.name,
		brandSlug: f.brandSlug,
		slug: f.slug,
		prefecture: f.prefecture,
		photo: f.photos[0]?.url ?? '',
		types,
		favCount: rooms.filter((r) => r.favorited).length
	};
}

export const actions: Actions = {
	toggle: async (event) => {
		const { request, locals } = event;
		if (!canUseFavoriteRooms(await viewerOf(locals))) {
			return fail(403, { message: m.membership_err_room_grade() });
		}
		const form = await request.formData();
		const roomId = String(form.get('roomId') ?? '');

		if (MEMBER_SUPABASE) {
			if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(roomId)) {
				return fail(400, { message: m.favorites_save_error() });
			}
			try {
				await sbToggleFavoriteRoom(createSupabaseServerClient(event), roomId);
			} catch (error) {
				if (error && typeof error === 'object' && 'message' in error && error.message === 'favorite_room_rank_required') {
					return fail(403, { message: m.membership_err_room_grade() });
				}
				return fail(400, { message: m.favorites_save_error() });
			}
			return { ok: true };
		}

		if (!demoRooms.some((room) => room.id === roomId && facilities.some((f) => f.isPublished && f.id === room.facilityId))) {
			return fail(400, { message: m.favorites_save_error() });
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
