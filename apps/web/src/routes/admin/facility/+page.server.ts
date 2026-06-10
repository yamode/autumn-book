import { fail } from '@sveltejs/kit';
import { facilityById, upsertTranslation, translationStore } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { currentFacility } = await parent();
	const facility = facilityById(currentFacility.id)!;

	// 既存翻訳データを読み込んで管理画面に渡す
	const key = `facility:${facility.id}`;
	const trMap = translationStore.get(key);
	const translations = {
		en: trMap?.get('en') ?? null,
		'zh-TW': trMap?.get('zh-TW') ?? null
	};

	return { facility, translations };
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
	},
	saveTranslation: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const facilityId = String(form.get('facilityId'));
		const locale = String(form.get('locale')) as 'en' | 'zh-TW';
		if (!['en', 'zh-TW'].includes(locale)) return fail(400, { message: '無効なロケールです' });
		const isPublished = form.get('isPublished') === 'on';
		const fields: Record<string, unknown> = {
			catchCopy: String(form.get('catchCopy') ?? ''),
			description: String(form.get('description') ?? ''),
			amenities: String(form.get('amenities') ?? '')
				.split(/[,]/)
				.map((s) => s.trim())
				.filter(Boolean)
		};
		upsertTranslation('facility', facilityId, locale, fields, isPublished);
		return { translationSaved: true };
	}
};
