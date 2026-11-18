// 管理画面: 客室・プランの翻訳（book.content_translations・2026-11-18）。
// 公式サイトを英語・繁体字で開いたときに出す文言を、日本語の紹介の項目ごとに入力して保存する。
// 読み書きはログイン中スタッフの権限（RLS: has_facility_access）。公開サイトは公開済みの行だけ読む（supabase-data の withContentTranslations）。
// fields の形は supabase-data の mergeContentTranslation と同じ:
//   name / headline / description: 文字列（空は日本語のまま）
//   highlightTags / amenities: 配列ごと置き換え
//   specs / sections: 日本語と同じ並びの配列（訳の無い項目は日本語を入れる・写真や注記の URL は日本語のものを引き継ぐ）
//   photoCaptions: 写真の並び順どおりの説明文（空は日本語のまま）
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeSections, normalizeSpecs, type ContentSection } from '$lib/content-blocks';

import type { TranslationEntity, TranslationLocale, TranslationRow, TranslationSet, TranslationSource } from '$lib/content-translation';
export type { TranslationEntity, TranslationLocale, TranslationSet, TranslationSource } from '$lib/content-translation';

const TABLE: Record<TranslationEntity, { table: string; key: string }> = {
	plan: { table: 'plan_contents', key: 'rate_plan_id' },
	room_type: { table: 'room_type_contents', key: 'room_type_id' }
};

const strings = (raw: unknown): string[] => (Array.isArray(raw) ? raw.map((v) => (typeof v === 'string' ? v : '')).filter((v) => v !== '') : []);

/** 日本語の紹介と tenant_id を読む。name は呼び出し側が持っている名前（プランは見出し、客室は PMS の部屋タイプ名） */
export async function sbLoadTranslationSource(
	client: SupabaseClient,
	entity: TranslationEntity,
	entityId: string,
	facilityUuid: string,
	name: string
): Promise<{ source: TranslationSource; tenantId: string } | null> {
	const { table, key } = TABLE[entity];
	const cols = entity === 'plan' ? 'tenant_id, headline, description, highlight_tags, specs, sections, photos' : 'tenant_id, headline, description, amenities, specs, sections, photos';
	const { data, error } = await client.schema('book').from(table).select(cols).eq(key, entityId).eq('facility_id', facilityUuid).maybeSingle();
	if (error) throw error;
	if (!data) return null;
	const row = data as unknown as Record<string, unknown>;
	const photos = Array.isArray(row.photos) ? (row.photos as Record<string, unknown>[]) : [];
	return {
		tenantId: String(row.tenant_id),
		source: {
			name,
			headline: String(row.headline ?? ''),
			description: String(row.description ?? ''),
			tags: strings(row.highlight_tags),
			amenities: strings(row.amenities),
			specs: normalizeSpecs(row.specs),
			sections: normalizeSections(row.sections),
			photoCaptions: photos.map((p) => String(p?.caption ?? ''))
		}
	};
}

/** 保存済みの翻訳（公開・非公開どちらも） */
export async function sbLoadTranslations(client: SupabaseClient, entity: TranslationEntity, entityId: string): Promise<TranslationSet> {
	const { data, error } = await client
		.schema('book')
		.from('content_translations')
		.select('locale, fields, is_published, updated_at')
		.eq('entity_type', entity)
		.eq('entity_id', entityId);
	if (error) throw error;
	const out: TranslationSet = { en: null, 'zh-TW': null };
	for (const r of (data ?? []) as { locale: string; fields: Record<string, unknown> | null; is_published: boolean; updated_at: string | null }[]) {
		if (r.locale === 'en' || r.locale === 'zh-TW') out[r.locale] = { fields: r.fields ?? {}, isPublished: !!r.is_published, updatedAt: r.updated_at };
	}
	return out;
}

const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

/** フォームの入力 → fields。日本語の並びに合わせて組み立てる（訳の無い項目は日本語のまま） */
export function translationFieldsFromForm(form: FormData, source: TranslationSource, entity: TranslationEntity): Record<string, unknown> {
	const fields: Record<string, unknown> = {};
	const name = field(form, 'name');
	const headline = field(form, 'headline');
	// プランは公式サイトで見出しをプラン名として出すので、見出しの訳を名前にも使う
	if (entity === 'plan') {
		if (headline) fields.name = fields.headline = headline;
	} else {
		if (name) fields.name = name;
		if (headline) fields.headline = headline;
	}
	const description = String(form.get('description') ?? '').replace(/\r\n/g, '\n').trim();
	if (description) fields.description = description;

	const list = (key: string) =>
		String(form.get(key) ?? '')
			.split(/\r?\n/)
			.map((s) => s.trim())
			.filter(Boolean);
	if (entity === 'plan') {
		const tags = list('tags');
		if (tags.length) fields.highlightTags = tags;
	} else {
		const amenities = list('amenities');
		if (amenities.length) fields.amenities = amenities;
	}

	let anySpec = false;
	const specs = source.specs.map((s, i) => {
		const label = field(form, `spec_label_${i}`);
		const value = String(form.get(`spec_value_${i}`) ?? '').replace(/\r\n/g, '\n').trim();
		if (label || value) anySpec = true;
		return { label: label || s.label, value: value || s.value };
	});
	if (anySpec) fields.specs = specs;

	let anySection = false;
	const sections = source.sections.map((s, i) => {
		const group = field(form, `sec_group_${i}`);
		const title = field(form, `sec_title_${i}`);
		const text = String(form.get(`sec_text_${i}`) ?? '').replace(/\r\n/g, '\n').trim();
		const note = String(form.get(`sec_note_${i}`) ?? '').replace(/\r\n/g, '\n').trim();
		if (group || title || text || note) anySection = true;
		const out: ContentSection = { ...s, group: group || s.group, title: title || s.title, text: text || s.text };
		if (s.note !== undefined || note) out.note = note || s.note;
		return out;
	});
	if (anySection) fields.sections = sections;

	const captions = source.photoCaptions.map((_, i) => field(form, `caption_${i}`));
	if (captions.some(Boolean)) fields.photoCaptions = captions;
	return fields;
}

/** 1 言語ぶんを保存する（行が無ければ作る） */
export async function sbSaveTranslation(
	client: SupabaseClient,
	input: {
		entity: TranslationEntity;
		entityId: string;
		facilityUuid: string;
		tenantId: string;
		locale: TranslationLocale;
		fields: Record<string, unknown>;
		isPublished: boolean;
	}
): Promise<void> {
	const { error } = await client
		.schema('book')
		.from('content_translations')
		.upsert(
			{
				tenant_id: input.tenantId,
				facility_id: input.facilityUuid,
				entity_type: input.entity,
				entity_id: input.entityId,
				locale: input.locale,
				fields: input.fields,
				is_published: input.isPublished,
				updated_at: new Date().toISOString()
			},
			{ onConflict: 'entity_type,entity_id,locale' }
		);
	if (error) throw error;
}

export function isTranslationLocale(v: unknown): v is TranslationLocale {
	return v === 'en' || v === 'zh-TW';
}
