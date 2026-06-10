import { favoritesByMember, facilities } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const favs = favoritesByMember.get(locals.user!.id) ?? new Set<string>();
	return {
		favorites: facilities.filter((f) => favs.has(f.id)),
		others: facilities.filter((f) => !favs.has(f.id) && f.isPublished)
	};
};

export const actions: Actions = {
	toggle: async ({ request, locals }) => {
		const form = await request.formData();
		const facilityId = String(form.get('facilityId'));
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
