import { fail } from '@sveltejs/kit';
import { faqs, upsertTranslation, translationStore } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const { currentFacility } = await parent();
	const facilityFaqs = faqs
		.filter((q) => q.facilityId === currentFacility.id)
		.sort((a, b) => a.sortOrder - b.sortOrder);

	// 各 FAQ の翻訳データを読み込む
	const faqTranslations = Object.fromEntries(
		facilityFaqs.map((q) => {
			const key = `faq:${q.id}`;
			const trMap = translationStore.get(key);
			return [q.id, { en: trMap?.get('en') ?? null, 'zh-TW': trMap?.get('zh-TW') ?? null }];
		})
	);

	return { faqs: facilityFaqs, faqTranslations };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const faq = faqs.find((q) => q.id === String(form.get('faqId')));
		if (!faq) return fail(404, {});
		faq.category = String(form.get('category') ?? faq.category);
		faq.question = String(form.get('question') ?? faq.question);
		faq.answer = String(form.get('answer') ?? faq.answer);
		faq.isPublished = form.get('isPublished') === 'on';
		return { saved: faq.id };
	},
	add: async ({ request, locals, cookies }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const facilityId = String(form.get('facilityId'));
		const question = String(form.get('question') ?? '').trim();
		if (!question) return fail(400, { message: '質問を入力してください' });
		faqs.push({
			id: `q-${Date.now()}`,
			facilityId,
			category: String(form.get('category') ?? 'その他') || 'その他',
			question,
			answer: String(form.get('answer') ?? ''),
			isPublished: false,
			sortOrder: faqs.filter((q) => q.facilityId === facilityId).length + 1
		});
		return { added: true };
	},
	saveTranslation: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const faqId = String(form.get('faqId'));
		const locale = String(form.get('locale')) as 'en' | 'zh-TW';
		if (!['en', 'zh-TW'].includes(locale)) return fail(400, { message: '無効なロケールです' });
		const isPublished = form.get('isPublished') === 'on';
		const fields: Record<string, unknown> = {
			category: String(form.get('category') ?? ''),
			question: String(form.get('question') ?? ''),
			answer: String(form.get('answer') ?? '')
		};
		upsertTranslation('faq', faqId, locale, fields, isPublished);
		return { translationSaved: faqId };
	}
};
