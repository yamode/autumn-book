// 客室案内のサンクスページ（チェックアウト後に QR を読んだときの表示）に出す販促バナー。
// DB: book.inroom_banners（autumn-shared 20261004033839）。ゲスト面は anon で「公開中かつ掲載期間内」だけ読める（RLS）。
// 管理画面はログイン中スタッフの権限で RPC（admin_save_inroom_banner／admin_delete_inroom_banner）。
// 管理画面が実データに繋がっていない（AUTH_MODE=demo）ときと DATA_SOURCE=demo は、プロセス内の配列で完結する。
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Locale } from '$lib/types';
import { DATA_SOURCE, supa } from './supabase';
import { FACILITY_UUID } from './supabase-data';
import { getFacilityById, stayTokens } from './store';

export type BannerLang = Locale | null; // null = すべての言語

export interface InroomBanner {
	id: string;
	facilityId: string;
	title: string; // 管理用の名前（画像の代替テキストにも使う）
	imageUrl: string;
	linkUrl: string | null;
	body: string | null; // 画像の下に出す一言（任意）
	lang: BannerLang;
	sortOrder: number;
	isPublished: boolean;
	startDate: string | null; // YYYY-MM-DD（JST・両端含む）
	endDate: string | null;
}

export type BannerInput = Omit<InroomBanner, 'id'> & { id?: string };

/** サンクスページの施設（URL の f=slug から引く）。施設は2つだけなので固定表で持つ */
const SLUG_TO_FACILITY: Record<string, string> = { nishiwaga: 'f-nishiwaga', oga: 'f-oga' };
const uuidOf = (facilityId: string) => FACILITY_UUID[facilityId] ?? facilityId;
const demoIdOfUuid = (uuid: string) =>
	Object.entries(FACILITY_UUID).find(([, v]) => v === uuid)?.[0] ?? uuid;

export function facilityIdFromSlug(slug: string | null | undefined): string | null {
	return slug ? (SLUG_TO_FACILITY[slug] ?? null) : null;
}

export interface EndedFacility {
	id: string; // demo の施設 ID（f-oga 等）
	slug: string;
	name: string;
}

export function endedFacilityBySlug(slug: string | null | undefined, locale: Locale): EndedFacility | null {
	const id = facilityIdFromSlug(slug);
	if (!id || !slug) return null;
	return { id, slug, name: getFacilityById(id, locale)?.name ?? '' };
}

/**
 * 滞在が終わった（チェックアウト時刻を過ぎた・失効した）トークンの施設。有効中・存在しないトークンは null。
 * stay_info は期限切れと不明を区別しないため、サンクス表示に出すかどうかはこれで決める。
 */
export async function stayEndedFacility(token: string, locale: Locale): Promise<EndedFacility | null> {
	if (DATA_SOURCE !== 'supabase') {
		const t = stayTokens.find((x) => x.token === token.trim());
		if (!t || !(t.revokedAt || Date.now() >= new Date(t.validTo).getTime())) return null;
		const f = getFacilityById(t.facilityId, locale);
		return f ? { id: f.id, slug: f.slug, name: f.name } : null;
	}
	try {
		const { data, error } = await supa().rpc('stay_ended_facility', { p_token: token });
		if (error || !data) return null;
		const id = demoIdOfUuid((data as { id: string }).id);
		const f = getFacilityById(id, locale);
		return { id, slug: (data as { slug: string }).slug, name: f?.name ?? (data as { name: string }).name };
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------- demo（プロセス内）

const demoBanners: InroomBanner[] = [];

function todayJst(): string {
	return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** ゲスト面で出してよいか（公開中・掲載期間内・言語が合う） */
function isShowable(b: InroomBanner, locale: Locale, today = todayJst()): boolean {
	if (!b.isPublished) return false;
	if (b.startDate && b.startDate > today) return false;
	if (b.endDate && b.endDate < today) return false;
	return b.lang === null || b.lang === locale;
}

const bySort = (a: InroomBanner, b: InroomBanner) => a.sortOrder - b.sortOrder;

interface BannerRow {
	id: string;
	facility_id: string;
	title: string;
	image_url: string;
	link_url: string | null;
	body: string | null;
	lang: string | null;
	sort_order: number;
	is_published: boolean;
	start_date: string | null;
	end_date: string | null;
}

function fromRow(r: BannerRow): InroomBanner {
	return {
		id: r.id,
		facilityId: demoIdOfUuid(r.facility_id),
		title: r.title,
		imageUrl: r.image_url,
		linkUrl: r.link_url,
		body: r.body,
		lang: (r.lang as BannerLang) ?? null,
		sortOrder: r.sort_order,
		isPublished: r.is_published,
		startDate: r.start_date,
		endDate: r.end_date
	};
}

// ---------------------------------------------------------------- ゲスト面

/** サンクスページに出すバナー（公開中・掲載期間内・言語が合うもの・並び順）。取れなければ空 */
export async function loadThanksBanners(facilityId: string, locale: Locale): Promise<InroomBanner[]> {
	if (DATA_SOURCE !== 'supabase') {
		return demoBanners.filter((b) => b.facilityId === facilityId && isShowable(b, locale)).sort(bySort);
	}
	try {
		// 公開中・掲載期間内の絞り込みは RLS（inroom_banners_public_read）が持つ。言語は isShowable で絞る
		const { data, error } = await supa()
			.from('inroom_banners')
			.select('id, facility_id, title, image_url, link_url, body, lang, sort_order, is_published, start_date, end_date')
			.eq('facility_id', uuidOf(facilityId))
			.order('sort_order');
		if (error || !data) return [];
		return (data as BannerRow[]).map(fromRow).filter((b) => isShowable(b, locale));
	} catch {
		return [];
	}
}

// ---------------------------------------------------------------- 管理画面

export function listBannersDemo(facilityId: string): InroomBanner[] {
	return demoBanners.filter((b) => b.facilityId === facilityId).sort(bySort);
}

export function saveBannerDemo(input: BannerInput): string {
	if (input.id) {
		const i = demoBanners.findIndex((b) => b.id === input.id && b.facilityId === input.facilityId);
		if (i < 0) throw new Error('バナーが見つかりません');
		demoBanners[i] = { ...input, id: input.id };
		return input.id;
	}
	const id = `bnr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	demoBanners.push({ ...input, id });
	return id;
}

export function deleteBannerDemo(id: string): void {
	const i = demoBanners.findIndex((b) => b.id === id);
	if (i >= 0) demoBanners.splice(i, 1);
}

export async function sbListBanners(client: SupabaseClient, facilityId: string): Promise<InroomBanner[]> {
	const { data, error } = await client
		.schema('book')
		.from('inroom_banners')
		.select('id, facility_id, title, image_url, link_url, body, lang, sort_order, is_published, start_date, end_date')
		.eq('facility_id', uuidOf(facilityId))
		.order('sort_order')
		.order('created_at');
	if (error) throw new Error('バナーを読み込めませんでした（' + error.message + '）');
	return (data as BannerRow[]).map(fromRow);
}

const SAVE_ERRORS: Record<string, string> = {
	invalid_title: '名前を入れてください（80文字まで）',
	invalid_image_url: '画像を選ぶか、https:// で始まる画像のURLを入れてください',
	invalid_link_url: 'リンク先は https:// で始まる形式で入力してください',
	invalid_body: '一言は200文字までです',
	invalid_period: '掲載期間の開始日が終了日より後になっています',
	forbidden: 'この施設のバナーを編集する権限がありません',
	not_found: 'バナーが見つかりません'
};

function rpcError(message: string, fallback: string): Error {
	const key = Object.keys(SAVE_ERRORS).find((k) => message.includes(k));
	return new Error(key ? SAVE_ERRORS[key] : `${fallback}（${message}）`);
}

export async function sbSaveBanner(client: SupabaseClient, input: BannerInput): Promise<string> {
	const { data, error } = await client.schema('book').rpc('admin_save_inroom_banner', {
		p_id: input.id ?? null,
		p_facility_id: uuidOf(input.facilityId),
		p_title: input.title,
		p_image_url: input.imageUrl,
		p_link_url: input.linkUrl,
		p_body: input.body,
		p_lang: input.lang,
		p_sort_order: input.sortOrder,
		p_is_published: input.isPublished,
		p_start_date: input.startDate,
		p_end_date: input.endDate
	});
	if (error) throw rpcError(error.message, 'バナーを保存できませんでした');
	return data as string;
}

export async function sbDeleteBanner(client: SupabaseClient, id: string): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_delete_inroom_banner', { p_id: id });
	if (error) throw rpcError(error.message, 'バナーを削除できませんでした');
}
