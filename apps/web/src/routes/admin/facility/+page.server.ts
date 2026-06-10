import { fail } from '@sveltejs/kit';
import { facilityById } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { currentFacility } = await parent();
	return { facility: facilityById(currentFacility.id)! };
};

export const actions: Actions = {
	save: async ({ request, locals, cookies }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const facility = facilityById(String(form.get('facilityId')));
		if (!facility) return fail(404, {});
		facility.catchCopy = String(form.get('catchCopy') ?? facility.catchCopy);
		facility.description = String(form.get('description') ?? facility.description);
		facility.checkinTime = String(form.get('checkinTime') ?? facility.checkinTime);
		facility.checkoutTime = String(form.get('checkoutTime') ?? facility.checkoutTime);
		facility.amenities = String(form.get('amenities') ?? '')
			.split(/[、,]/)
			.map((s) => s.trim())
			.filter(Boolean);
		facility.isPublished = form.get('isPublished') === 'on';
		return { saved: true };
	},
	caption: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const facility = facilityById(String(form.get('facilityId')));
		const idx = Number(form.get('index'));
		if (!facility || !facility.photos[idx]) return fail(404, {});
		facility.photos[idx].caption = String(form.get('caption') ?? '');
		return { saved: true };
	}
};
