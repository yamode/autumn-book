import { error, fail } from '@sveltejs/kit';
import { planById, facilityById, roomTypeById, upsertTranslation, translationStore } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const plan = planById(params.id);
	if (!plan) error(404, 'プランが見つかりません');
	const facility = facilityById(plan.facilityId)!;

	const key = `plan:${plan.id}`;
	const trMap = translationStore.get(key);
	const translations = {
		en: trMap?.get('en') ?? null,
		'zh-TW': trMap?.get('zh-TW') ?? null
	};

	return {
		plan,
		facility,
		rooms: plan.roomTypeIds.map((id) => roomTypeById(id)!.name),
		translations
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
	},
	// 決済設定（現地払い/事前決済=即時決済/PayPay/事前割引≤20%）
	// 本実装では booking.rate_plans.metadata.prepay へ書く（rms と共有・要連携）
	savePayment: async ({ params, request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { paymentError: '編集権限がありません' });
		const plan = planById(params.id);
		if (!plan) return fail(404, {});
		const form = await request.formData();
		const onsite = form.get('onsite') === 'on';
		const prepay = form.get('prepay') === 'on';
		const methods: ('card' | 'paypay')[] = [];
		if (form.get('m_card') === 'on') methods.push('card');
		if (form.get('m_paypay') === 'on') methods.push('paypay');
		const discount = Number(form.get('discount') ?? 0) / 100;

		if (!onsite && !prepay) return fail(400, { paymentError: '支払い方法を最低1つは有効にしてください' });
		if (prepay && methods.length === 0) return fail(400, { paymentError: '事前決済を有効にする場合は決済手段（カード/PayPay）を選択してください' });
		if (discount < 0 || discount > 0.2) return fail(400, { paymentError: '事前決済割引は0〜20%の範囲で設定してください' });

		plan.payment = { onsite, prepay, prepayMethods: prepay ? methods : [], prepayDiscountRate: prepay ? discount : 0 };
		return { paymentSaved: true };
	},

	saveTranslation: async ({ params, request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const plan = planById(params.id);
		if (!plan) return fail(404, {});
		const form = await request.formData();
		const locale = String(form.get('locale')) as 'en' | 'zh-TW';
		if (!['en', 'zh-TW'].includes(locale)) return fail(400, { message: '無効なロケールです' });
		const isPublished = form.get('isPublished') === 'on';
		const fields: Record<string, unknown> = {
			headline: String(form.get('headline') ?? ''),
			description: String(form.get('description') ?? ''),
			highlightTags: String(form.get('tags') ?? '')
				.split(/[,]/)
				.map((s) => s.trim())
				.filter(Boolean)
		};
		upsertTranslation('plan', plan.id, locale, fields, isPublished);
		return { translationSaved: true };
	}
};
