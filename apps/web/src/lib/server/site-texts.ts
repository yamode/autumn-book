// サイトの文言の上書き（book.site_texts・2026-11-23）。公開ページは匿名で読み、管理画面はスタッフのログインで書く。
// DATA_SOURCE=supabase でないとき（デモ）は上書き無し＝元の文言。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';
import { MEMBER_BENEFIT_TEXT_KEYS, type SiteTexts } from '$lib/member-benefit-texts';

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
export const SITE_TEXT_LOCALES = ['ja', 'en', 'zh-TW'] as const;
export type SiteTextLocale = (typeof SITE_TEXT_LOCALES)[number];

// 公開ページは同じ文言を何度も読むので、短く覚えておく（保存したらその場で消す）
const cache = new Map<string, { at: number; texts: SiteTexts }>();
const TTL_MS = 60_000;

/** その言語の会員特典の上書き（読めなければ空＝元の文言） */
export async function loadMemberBenefitTexts(locale: string): Promise<SiteTexts> {
	if (DATA_SOURCE !== 'supabase') return {};
	const hit = cache.get(locale);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.texts;
	try {
		const { data, error } = await supa().from('site_texts').select('key, value')
			.eq('tenant_id', TENANT_ID).eq('locale', locale).in('key', MEMBER_BENEFIT_TEXT_KEYS);
		if (error) throw error;
		const texts: SiteTexts = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
		cache.set(locale, { at: Date.now(), texts });
		return texts;
	} catch {
		return hit?.texts ?? {};
	}
}

/** 管理画面用: 全言語の上書き（locale → key → 文言） */
export async function listMemberBenefitTextsAdmin(client: SupabaseClient): Promise<Record<SiteTextLocale, SiteTexts>> {
	const out: Record<SiteTextLocale, SiteTexts> = { ja: {}, en: {}, 'zh-TW': {} };
	const { data, error } = await client.schema('book').from('site_texts').select('key, locale, value')
		.eq('tenant_id', TENANT_ID).in('key', MEMBER_BENEFIT_TEXT_KEYS);
	if (error) throw error;
	for (const r of data ?? []) if ((SITE_TEXT_LOCALES as readonly string[]).includes(r.locale)) out[r.locale as SiteTextLocale][r.key] = r.value;
	return out;
}

/** 管理画面用: 1項目の3言語をまとめて保存。空、または元の文言と同じなら上書きを消す（元の文言に戻る） */
export async function saveMemberBenefitText(
	client: SupabaseClient,
	key: string,
	values: Record<SiteTextLocale, string>,
	defaults: Record<SiteTextLocale, string>,
	userId: string
): Promise<void> {
	if (!MEMBER_BENEFIT_TEXT_KEYS.includes(key)) throw new Error('bad_key');
	const table = () => client.schema('book').from('site_texts');
	for (const locale of SITE_TEXT_LOCALES) {
		const v = (values[locale] ?? '').trim();
		if (!v || v === defaults[locale].trim()) {
			const { error } = await table().delete().eq('tenant_id', TENANT_ID).eq('key', key).eq('locale', locale);
			if (error) throw error;
		} else {
			const { error } = await table().upsert(
				{ tenant_id: TENANT_ID, key, locale, value: v.slice(0, 4000), updated_at: new Date().toISOString(), updated_by: userId },
				{ onConflict: 'tenant_id,key,locale' }
			);
			if (error) throw error;
		}
	}
	cache.clear();
}
