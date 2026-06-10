import { error, fail } from '@sveltejs/kit';
import { planById, facilityById, roomTypeById } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const plan = planById(params.id);
	if (!plan) error(404, 'プランが見つかりません');
	const facility = facilityById(plan.facilityId)!;
	return {
		plan,
		facility,
		rooms: plan.roomTypeIds.map((id) => roomTypeById(id)!.name)
	};
};

export const actions: Actions = {
	save: async ({ params, request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const plan = planById(params.id);
		if (!plan) return fail(404, {});
		const form = await request.formData();
		const headline = String(form.get('headline') ?? '').trim();
		if (!headline) return fail(400, { message: 'キャッチコピーを入力してください' });
		plan.headline = headline;
		plan.description = String(form.get('description') ?? '');
		plan.highlightTags = String(form.get('tags') ?? '')
			.split(/[、,]/)
			.map((s) => s.trim())
			.filter(Boolean);
		plan.sortOrder = Number(form.get('sortOrder') ?? plan.sortOrder);
		plan.isPublished = form.get('isPublished') === 'on';
		return { saved: true };
	}
};
