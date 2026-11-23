import { fail } from '@sveltejs/kit';
import { facilityById, upsertTranslation, translationStore } from '$lib/server/store';
import type { Actions, PageServerLoad } from './$types';
import { denyDemoStoreWrite } from '$lib/server/admin-demo-guard';
import { ADMIN_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { FACILITY_UUID, sbFacilityByUuid } from '$lib/server/supabase-data';
import type { Facility } from '$lib/types';

// 本番（ADMIN_SUPABASE）はスタッフのログインのまま book.facility_contents を読み書きし（RLS: has_facility_access）、
// 翻訳は book.content_translations（entity_type='facility'・fields は catchCopy / description / amenities）に保存する（2026-11-23）。
// 写真は本番ではまだ DB に無い（表示は仮の写真）ので編集しない。公開・非公開の切り替えも本番では出さない（サイトから施設が消えるため）。
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
type FacilityTr = { fields: Record<string, unknown>; isPublished: boolean } | null;
const splitAmenities = (v: FormDataEntryValue | null) => String(v ?? '').split(/[、,]/).map((s) => s.trim()).filter(Boolean);

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	if (ADMIN_SUPABASE) {
		const uuid = FACILITY_UUID[currentFacility.id];
		const client = createSupabaseServerClient(event);
		const [base, contentRes, trRes] = await Promise.all([
			uuid ? sbFacilityByUuid(uuid) : Promise.resolve(undefined),
			uuid ? client.schema('book').from('facility_contents').select('catch_copy, description, checkin_time, checkout_time, amenities, access, is_published').eq('facility_id', uuid).maybeSingle() : Promise.resolve({ data: null }),
			uuid ? client.schema('book').from('content_translations').select('locale, fields, is_published').eq('entity_type', 'facility').eq('entity_id', uuid) : Promise.resolve({ data: [] })
		]);
		const c = contentRes.data as { catch_copy: string | null; description: string | null; checkin_time: string | null; checkout_time: string | null; amenities: unknown; access: unknown; is_published: boolean } | null;
		if (!base || !c) return { facility: { ...currentFacility, photos: [] } as unknown as Facility, translations: { en: null, 'zh-TW': null }, live: true, loadError: '施設の情報を読み込めませんでした。' };
		const facility: Facility = {
			...base,
			id: currentFacility.id,
			catchCopy: c.catch_copy ?? '',
			description: c.description ?? '',
			checkinTime: c.checkin_time ?? '15:00',
			checkoutTime: c.checkout_time ?? '11:00',
			amenities: Array.isArray(c.amenities) ? (c.amenities as string[]) : [],
			isPublished: c.is_published,
			photos: []
		};
		const translations: { en: FacilityTr; 'zh-TW': FacilityTr } = { en: null, 'zh-TW': null };
		for (const r of (trRes.data ?? []) as { locale: string; fields: Record<string, unknown> | null; is_published: boolean }[]) {
			if (r.locale === 'en' || r.locale === 'zh-TW') translations[r.locale] = { fields: r.fields ?? {}, isPublished: !!r.is_published };
		}
		return { facility, translations, live: true, loadError: null as string | null };
	}
	const facility = facilityById(currentFacility.id)!;

	// 既存翻訳データを読み込んで管理画面に渡す
	const key = `facility:${facility.id}`;
	const trMap = translationStore.get(key);
	const translations = {
		en: trMap?.get('en') ?? null,
		'zh-TW': trMap?.get('zh-TW') ?? null
	};

	return { facility, translations, live: false, loadError: null as string | null };
};

export const actions: Actions = {
	save: async (event) => {
		const { request, locals } = event;
		if (ADMIN_SUPABASE) {
			if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
			const form = await request.formData();
			const uuid = FACILITY_UUID[String(form.get('facilityId') ?? '')];
			if (!uuid) return fail(404, { message: '施設が見つかりません' });
			const time = (v: FormDataEntryValue | null, fallback: string) => (/^\d{1,2}:\d{2}$/.test(String(v ?? '').trim()) ? String(v).trim() : fallback);
			const { data, error } = await createSupabaseServerClient(event).schema('book').from('facility_contents').update({
				catch_copy: String(form.get('catchCopy') ?? '').trim(),
				description: String(form.get('description') ?? ''),
				checkin_time: time(form.get('checkinTime'), '15:00'),
				checkout_time: time(form.get('checkoutTime'), '11:00'),
				amenities: splitAmenities(form.get('amenities')),
				updated_at: new Date().toISOString()
			}).eq('facility_id', uuid).select('facility_id').maybeSingle();
			if (error || !data) return fail(400, { message: '保存できませんでした。' });
			return { saved: true };
		}
		const blocked = denyDemoStoreWrite();
		if (blocked) return blocked;
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
		const blocked = denyDemoStoreWrite();
		if (blocked) return blocked;
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const form = await request.formData();
		const facility = facilityById(String(form.get('facilityId')));
		const idx = Number(form.get('index'));
		if (!facility || !facility.photos[idx]) return fail(404, {});
		facility.photos[idx].caption = String(form.get('caption') ?? '');
		return { saved: true };
	},
	saveTranslation: async (event) => {
		const { request, locals } = event;
		if (ADMIN_SUPABASE) {
			if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
			const form = await request.formData();
			const uuid = FACILITY_UUID[String(form.get('facilityId') ?? '')];
			const locale = String(form.get('locale'));
			if (!uuid) return fail(404, { message: '施設が見つかりません' });
			if (locale !== 'en' && locale !== 'zh-TW') return fail(400, { message: '無効なロケールです' });
			const { error } = await createSupabaseServerClient(event).schema('book').from('content_translations').upsert({
				tenant_id: TENANT_ID,
				facility_id: uuid,
				entity_type: 'facility',
				entity_id: uuid,
				locale,
				fields: {
					catchCopy: String(form.get('catchCopy') ?? '').trim(),
					description: String(form.get('description') ?? ''),
					amenities: String(form.get('amenities') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
				},
				is_published: form.get('isPublished') === 'on',
				updated_at: new Date().toISOString()
			}, { onConflict: 'entity_type,entity_id,locale' });
			if (error) return fail(400, { message: '翻訳を保存できませんでした。' });
			return { translationSaved: true };
		}
		const blocked = denyDemoStoreWrite();
		if (blocked) return blocked;
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
