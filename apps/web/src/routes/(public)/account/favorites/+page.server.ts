import { favoritesByMember, facilities } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbListFavorites, sbAddFavorite, sbRemoveFavorite, reverseFacilityUuid, toFacilityUuidStrict } from '$lib/server/supabase-data';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { locals } = event;

	if (MEMBER_SUPABASE) {
		const client = createSupabaseServerClient(event);
		const favUuids = await sbListFavorites(client);
		// お気に入りの実 UUID を store の施設 ID へ逆引きし、施設マスタ（store）を仕分ける
		const favIds = new Set(favUuids.map((u) => reverseFacilityUuid(u)).filter((v): v is string => !!v));
		return {
			favorites: facilities.filter((f) => favIds.has(f.id)),
			others: facilities.filter((f) => !favIds.has(f.id) && f.isPublished)
		};
	}

	const favs = favoritesByMember.get(locals.user!.id) ?? new Set<string>();
	return {
		favorites: facilities.filter((f) => favs.has(f.id)),
		others: facilities.filter((f) => !favs.has(f.id) && f.isPublished)
	};
};

export const actions: Actions = {
	toggle: async (event) => {
		const { request, locals } = event;
		const form = await request.formData();
		const facilityId = String(form.get('facilityId'));

		if (MEMBER_SUPABASE) {
			const client = createSupabaseServerClient(event);
			const favUuids = await sbListFavorites(client);
			const facilityUuid = toFacilityUuidStrict(facilityId);
			if (favUuids.includes(facilityUuid)) {
				await sbRemoveFavorite(client, locals.user!.id, facilityId);
			} else {
				await sbAddFavorite(client, locals.user!.id, facilityId);
			}
			return { ok: true };
		}

		let favs = favoritesByMember.get(locals.user!.id);
		if (!favs) {
			favs = new Set();
			favoritesByMember.set(locals.user!.id, favs);
		}
		if (favs.has(facilityId)) favs.delete(facilityId);
		else favs.add(facilityId);
		return { ok: true };
	}
};
