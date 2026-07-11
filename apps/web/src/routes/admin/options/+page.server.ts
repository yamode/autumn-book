import { fail } from '@sveltejs/kit';
import {
	listOptionItemsAdmin,
	addOptionItem,
	updateOptionItem,
	listBookingOptionsAdmin,
	upsertTranslation,
	translationStore,
	type OptionItemInput
} from '$lib/server/store';
import { todayStr } from '$lib/format';
import type { OptionItem } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

// フォーム → OptionItemInput（数値/真偽の正規化）
function parseInput(form: FormData): OptionItemInput {
	const stockType = String(form.get('stockType') ?? 'none') === 'per_day' ? 'per_day' : 'none';
	const cap = Number(form.get('dailyCapacity') ?? 0);
	return {
		code: String(form.get('code') ?? '').trim(),
		name: String(form.get('name') ?? '').trim(),
		description: String(form.get('description') ?? '').trim(),
		category: String(form.get('category') ?? 'other') as OptionItem['category'],
		priceType: String(form.get('priceType') ?? 'per_stay') as OptionItem['priceType'],
		unitPrice: Math.max(0, Math.floor(Number(form.get('unitPrice') ?? 0)) || 0),
		leadTimeHours: Math.max(0, Math.floor(Number(form.get('leadTimeHours') ?? 24)) || 0),
		stockType,
		dailyCapacity: stockType === 'per_day' && cap > 0 ? cap : undefined,
		requiresServiceDate: form.get('requiresServiceDate') === 'on',
		memberOnly: form.get('memberOnly') === 'on',
		sortOrder: Math.floor(Number(form.get('sortOrder') ?? 0)) || 0,
		isActive: form.get('isActive') === 'on'
	};
}

export const load: PageServerLoad = async ({ parent }) => {
	const { currentFacility } = await parent();
	const items = listOptionItemsAdmin(currentFacility.id);

	// 各商品の翻訳（en / zh-TW）
	const optionTranslations = Object.fromEntries(
		items.map((o) => {
			const trMap = translationStore.get(`option:${o.id}`);
			return [o.id, { en: trMap?.get('en') ?? null, 'zh-TW': trMap?.get('zh-TW') ?? null }];
		})
	);

	// 当日提供リスト（現地スタッフ向け）
	const today = todayStr();
	const todayOrders = listBookingOptionsAdmin(currentFacility.id, today);

	return { items, optionTranslations, today, todayOrders };
};

export const actions: Actions = {
	save: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const id = String(form.get('optionId') ?? '');
		const input = parseInput(form);
		if (!input.name) return fail(400, { message: '商品名を入力してください' });
		const updated = updateOptionItem(id, input);
		if (!updated) return fail(404, { message: '商品が見つかりません' });
		return { saved: id };
	},
	add: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const facilityId = String(form.get('facilityId'));
		const input = parseInput(form);
		if (!input.name) return fail(400, { message: '商品名を入力してください' });
		addOptionItem(facilityId, input);
		return { added: true };
	},
	saveTranslation: async ({ request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const optionId = String(form.get('optionId'));
		const locale = String(form.get('locale')) as 'en' | 'zh-TW';
		if (!['en', 'zh-TW'].includes(locale)) return fail(400, { message: '無効なロケールです' });
		const isPublished = form.get('isPublished') === 'on';
		const fields: Record<string, unknown> = {
			name: String(form.get('name') ?? ''),
			description: String(form.get('description') ?? '')
		};
		upsertTranslation('option', optionId, locale, fields, isPublished);
		return { translationSaved: optionId };
	}
};
