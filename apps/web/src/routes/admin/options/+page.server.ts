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
import { denyDemoStoreWrite } from '$lib/server/admin-demo-guard';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID, sbListBookingOptionsAdmin } from '$lib/server/supabase-data';
import { OPTION_RANKS } from '$lib/member-benefits';

// 本番（ADMIN_SUPABASE）はスタッフのログインで book.option_items を直接読み書きする（RLS: has_facility_access・2026-11-23）。
// それ以外（デモ）は従来どおりメモリのストア。翻訳は本番では book.content_translations（entity_type='option'）に保存する。
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
type OptionTr = { fields: { name?: string; description?: string }; isPublished: boolean } | null;
type AdminOptionItem = OptionItem & { isActive: boolean };
const OPTION_COLUMNS = 'id, code, name, description, category, price_type, unit_price, lead_time_hours, stock_type, daily_capacity, requires_service_date, member_only, sort_order, is_active, allowed_ranks';
type OptionDbRow = {
	id: string; code: string; name: string; description: string | null; category: string; price_type: string;
	unit_price: number; lead_time_hours: number; stock_type: string; daily_capacity: number | null;
	requires_service_date: boolean; member_only: boolean; sort_order: number; is_active: boolean; allowed_ranks: string[] | null;
};
const fromRow = (r: OptionDbRow): AdminOptionItem => ({
	id: r.id, code: r.code, name: r.name, description: r.description ?? '', category: r.category as OptionItem['category'],
	priceType: r.price_type as OptionItem['priceType'], unitPrice: r.unit_price, leadTimeHours: r.lead_time_hours,
	stockType: r.stock_type === 'per_day' ? 'per_day' : 'none', dailyCapacity: r.daily_capacity ?? undefined,
	requiresServiceDate: r.requires_service_date, memberOnly: r.member_only, photos: [], sortOrder: r.sort_order,
	isActive: r.is_active, allowedRanks: r.allowed_ranks ?? []
});
const toRow = (i: OptionItemInput) => ({
	code: i.code, name: i.name, description: i.description, category: i.category, price_type: i.priceType,
	unit_price: i.unitPrice, lead_time_hours: i.leadTimeHours, stock_type: i.stockType,
	daily_capacity: i.stockType === 'per_day' ? (i.dailyCapacity ?? null) : null,
	requires_service_date: i.requiresServiceDate, member_only: i.memberOnly, sort_order: i.sortOrder,
	is_active: i.isActive, allowed_ranks: i.allowedRanks ?? []
});

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
		isActive: form.get('isActive') === 'on',
		// 使える会員ランク（チェックした分だけ。全部外す＝誰も使えない）
		allowedRanks: form.getAll('allowedRanks').map(String).filter((r) => (OPTION_RANKS as readonly string[]).includes(r))
	};
}

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	if (ADMIN_SUPABASE) {
		const facilityUuid = FACILITY_UUID[currentFacility.id];
		const client = createSupabaseServerClient(event);
		const today = todayStr();
		if (!facilityUuid) return { items: [] as AdminOptionItem[], optionTranslations: {}, today, todayOrders: [], live: true, loadError: 'この施設では使えません。' };
		const [itemsRes, todayOrders] = await Promise.all([
			client.schema('book').from('option_items').select(OPTION_COLUMNS).eq('facility_id', facilityUuid).order('sort_order').order('name'),
			sbListBookingOptionsAdmin(client, facilityUuid, today).catch(() => [])
		]);
		const items = ((itemsRes.data ?? []) as OptionDbRow[]).map(fromRow);
		// 各商品の翻訳（en / zh-TW）。公開ページ（sbListOptionItems）は公開中の訳だけを重ねる
		const optionTranslations: Record<string, { en: OptionTr; 'zh-TW': OptionTr }> = Object.fromEntries(items.map((i) => [i.id, { en: null, 'zh-TW': null }]));
		if (items.length) {
			const { data: trs } = await client.schema('book').from('content_translations').select('entity_id, locale, fields, is_published')
				.eq('entity_type', 'option').in('entity_id', items.map((i) => i.id));
			for (const r of trs ?? []) {
				const loc = r.locale as 'en' | 'zh-TW';
				if (optionTranslations[r.entity_id] && (loc === 'en' || loc === 'zh-TW')) {
					optionTranslations[r.entity_id][loc] = { fields: (r.fields ?? {}) as { name?: string; description?: string }, isPublished: !!r.is_published };
				}
			}
		}
		return {
			items,
			optionTranslations,
			today,
			todayOrders,
			live: true,
			loadError: itemsRes.error ? 'オプションを読み込めませんでした。時間をおいて再読み込みしてください。' : null
		};
	}
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

	return { items, optionTranslations, today, todayOrders, live: false, loadError: null as string | null };
};

export const actions: Actions = {
	save: async (event) => {
		const { request, locals } = event;
		if (ADMIN_SUPABASE) {
			if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
			const form = await request.formData();
			const input = parseInput(form);
			if (!input.name) return fail(400, { message: '商品名を入力してください' });
			const id = String(form.get('optionId') ?? '');
			const { data, error } = await createSupabaseServerClient(event).schema('book').from('option_items')
				.update({ ...toRow(input), code: input.code || undefined, updated_at: new Date().toISOString() }).eq('id', id).select('id').maybeSingle();
			if (error || !data) return fail(400, { message: '保存できませんでした。' + (error?.message?.includes('duplicate') ? 'コードが他の商品と重なっています。' : '') });
			return { saved: id };
		}
		const blocked = denyDemoStoreWrite();
		if (blocked) return blocked;
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const id = String(form.get('optionId') ?? '');
		const input = parseInput(form);
		if (!input.name) return fail(400, { message: '商品名を入力してください' });
		const updated = updateOptionItem(id, input);
		if (!updated) return fail(404, { message: '商品が見つかりません' });
		return { saved: id };
	},
	add: async (event) => {
		const { request, locals } = event;
		if (ADMIN_SUPABASE) {
			if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
			const form = await request.formData();
			const input = parseInput(form);
			if (!input.name) return fail(400, { message: '商品名を入力してください' });
			const facilityUuid = FACILITY_UUID[String(form.get('facilityId') ?? '')];
			if (!facilityUuid) return fail(400, { message: '施設が正しくありません' });
			const client = createSupabaseServerClient(event);
			const { data: fac } = await client.schema('core').from('facilities').select('tenant_id').eq('id', facilityUuid).maybeSingle();
			if (!fac) return fail(400, { message: '施設を読み込めませんでした' });
			const { error } = await client.schema('book').from('option_items').insert({
				...toRow(input), code: input.code || `opt-${Date.now().toString(36)}`, tenant_id: fac.tenant_id, facility_id: facilityUuid
			});
			if (error) return fail(400, { message: '追加できませんでした。' + (error.message.includes('duplicate') ? 'コードが他の商品と重なっています。' : '') });
			return { added: true };
		}
		const blocked = denyDemoStoreWrite();
		if (blocked) return blocked;
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const facilityId = String(form.get('facilityId'));
		const input = parseInput(form);
		if (!input.name) return fail(400, { message: '商品名を入力してください' });
		addOptionItem(facilityId, input);
		return { added: true };
	},
	saveTranslation: async (event) => {
		const { request, locals } = event;
		if (ADMIN_SUPABASE) {
			if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
			const form = await request.formData();
			const optionId = String(form.get('optionId') ?? '');
			const locale = String(form.get('locale'));
			if (locale !== 'en' && locale !== 'zh-TW') return fail(400, { message: '無効なロケールです' });
			const client = createSupabaseServerClient(event);
			const { data: item } = await client.schema('book').from('option_items').select('facility_id').eq('id', optionId).maybeSingle();
			if (!item) return fail(404, { message: '商品が見つかりません' });
			const { error } = await client.schema('book').from('content_translations').upsert({
				tenant_id: TENANT_ID,
				facility_id: item.facility_id,
				entity_type: 'option',
				entity_id: optionId,
				locale,
				fields: { name: String(form.get('name') ?? '').trim(), description: String(form.get('description') ?? '').trim() },
				is_published: form.get('isPublished') === 'on',
				updated_at: new Date().toISOString()
			}, { onConflict: 'entity_type,entity_id,locale' });
			if (error) return fail(400, { message: '翻訳を保存できませんでした。' });
			return { translationSaved: optionId };
		}
		const blocked = denyDemoStoreWrite();
		if (blocked) return blocked;
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
