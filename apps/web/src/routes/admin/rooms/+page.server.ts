import { fail } from '@sveltejs/kit';
import { roomTypes } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { currentFacility } = await parent();
	return { rooms: roomTypes.filter((r) => r.facilityId === currentFacility.id) };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const room = roomTypes.find((r) => r.id === String(form.get('roomId')));
		if (!room) return fail(404, {});
		room.headline = String(form.get('headline') ?? room.headline);
		room.description = String(form.get('description') ?? room.description);
		room.amenities = String(form.get('amenities') ?? '')
			.split(/[、,]/)
			.map((s) => s.trim())
			.filter(Boolean);
		return { saved: room.id };
	}
};
