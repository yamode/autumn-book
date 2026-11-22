// 写真の権利・原本の場所（docs/facility-knowledge.md 段階6・§3.4）。/admin/knowledge/photos 用のサーバー関数。
// 写真そのものはプラン・部屋タイプ・お知らせの表紙に URL で入っている。ここでは URL ごとに
// book.photo_rights（スタッフだけが読める）へ撮影者・権利・使える範囲・人の写り込み・Dropbox の原本の場所を入れる。
// RLS は private.can_edit_book_knowledge。呼び出し側はログイン中のスタッフのクライアントを渡すこと。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	PHOTO_RIGHTS,
	PHOTO_USAGES,
	SEASON_LABEL,
	type PhotoPeople,
	type PhotoRights,
	type PhotoUsage,
	type Season
} from '$lib/facility-knowledge';
import { KnowledgeError } from './index';

export interface PhotoRightsRow {
	url: string;
	season: Season | null;
	photographer: string;
	rights: PhotoRights;
	usageScope: PhotoUsage[];
	hasPeople: boolean | null;
	peopleConsent: boolean | null;
	originalPath: string;
	note: string;
	updatedAt: string | null;
}

export interface PhotoItem extends PhotoRightsRow {
	caption: string;
	/** 使われている場所（「プラン：〇〇」など） */
	usedIn: string[];
	/** 権利の欄がまだ1度も保存されていない */
	unsaved: boolean;
}

type PhotoJson = { url?: unknown; caption?: unknown };

function photoList(value: unknown): { url: string; caption: string }[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((p: PhotoJson) => ({ url: typeof p?.url === 'string' ? p.url : '', caption: typeof p?.caption === 'string' ? p.caption : '' }))
		.filter((p) => /^https:\/\//.test(p.url));
}

const blankRights = (url: string): PhotoRightsRow => ({
	url,
	season: null,
	photographer: '',
	rights: 'unknown',
	usageScope: [],
	hasPeople: null,
	peopleConsent: null,
	originalPath: '',
	note: '',
	updatedAt: null
});

/** 施設で使われている写真を集めて、権利の欄と重ねる（URL の重複はまとめる） */
export async function listPhotos(client: SupabaseClient, facilityId: string): Promise<PhotoItem[]> {
	const book = client.schema('book');
	const [plans, rooms, news, rights] = await Promise.all([
		book.from('plan_contents').select('headline, slug, photos, sort_order').eq('facility_id', facilityId).order('sort_order'),
		book.from('room_type_contents').select('headline, slug, photos').eq('facility_id', facilityId),
		book.from('news_posts').select('title, cover_image_url').contains('facility_ids', [facilityId]).not('cover_image_url', 'is', null),
		book.from('photo_rights').select('*').eq('facility_id', facilityId)
	]);
	const failed = plans.error || rooms.error || news.error || rights.error;
	if (failed) throw new KnowledgeError('写真を読み込めませんでした。時間をおいて再読み込みしてください。', 500);

	const items = new Map<string, { caption: string; usedIn: string[] }>();
	const add = (url: string, caption: string, where: string) => {
		const item = items.get(url) ?? { caption: '', usedIn: [] };
		if (!item.caption && caption) item.caption = caption;
		if (!item.usedIn.includes(where)) item.usedIn.push(where);
		items.set(url, item);
	};
	for (const r of rooms.data ?? []) for (const p of photoList(r.photos)) add(p.url, p.caption, `部屋：${r.headline || r.slug}`);
	for (const r of plans.data ?? []) for (const p of photoList(r.photos)) add(p.url, p.caption, `プラン：${r.headline || r.slug}`);
	for (const r of news.data ?? []) if (/^https:\/\//.test(r.cover_image_url ?? '')) add(r.cover_image_url, '', `お知らせ：${r.title}`);

	const saved = new Map((rights.data ?? []).map((r) => [r.url as string, mapRights(r)]));
	return [...items.entries()].map(([url, item]) => {
		const r = saved.get(url);
		return { ...(r ?? blankRights(url)), caption: item.caption, usedIn: item.usedIn, unsaved: !r };
	});
}

function mapRights(r: Record<string, unknown>): PhotoRightsRow {
	return {
		url: String(r.url),
		season: (r.season as Season | null) ?? null,
		photographer: (r.photographer as string | null) ?? '',
		rights: (r.rights as PhotoRights) ?? 'unknown',
		usageScope: ((r.usage_scope as string[] | null) ?? []).filter((u): u is PhotoUsage => (PHOTO_USAGES as readonly string[]).includes(u)),
		hasPeople: (r.has_people as boolean | null) ?? null,
		peopleConsent: (r.people_consent as boolean | null) ?? null,
		originalPath: (r.original_path as string | null) ?? '',
		note: (r.note as string | null) ?? '',
		updatedAt: (r.updated_at as string | null) ?? null
	};
}

/** 保存する列（DB の列名）。入っていない列は変えない */
export type RightsPatch = Partial<{
	season: Season | null;
	photographer: string | null;
	rights: PhotoRights;
	usage_scope: PhotoUsage[];
	usage_add: PhotoUsage[];
	usage_remove: PhotoUsage[];
	has_people: boolean | null;
	people_consent: boolean | null;
	original_path: string | null;
	note: string | null;
}>;

const KEEP = 'keep';

function text(form: FormData, name: string, max: number, label: string): string | null | undefined {
	if (!form.has(name)) return undefined;
	const v = String(form.get(name) ?? '').trim();
	if (form.get(`${name}Keep`) === '1' && !v) return undefined; // まとめて変えるときは、空欄なら変えない
	if (v.length > max) throw new KnowledgeError(`${label}は${max}文字以内で入力してください。`);
	return v || null;
}

/** 人の写り込みの選択肢 → has_people / people_consent */
export function peopleValue(v: string): { has_people: boolean | null; people_consent: boolean | null } | undefined {
	const map: Record<PhotoPeople, { has_people: boolean | null; people_consent: boolean | null }> = {
		unchecked: { has_people: null, people_consent: null },
		none: { has_people: false, people_consent: null },
		consented: { has_people: true, people_consent: true },
		no_consent: { has_people: true, people_consent: false }
	};
	return map[v as PhotoPeople];
}


/**
 * フォーム → 保存する列。1枚の編集ではすべての欄が届く。まとめての編集では「変えない（keep）」の欄を飛ばす。
 * 使える範囲は、1枚なら usage（チェックの一覧）、まとめてなら usage_web=allow|deny|keep のように1つずつ。
 */
export function parseRightsForm(form: FormData): RightsPatch {
	const patch: RightsPatch = {};
	const season = form.get('season');
	if (season !== null && season !== KEEP) {
		const s = String(season);
		if (s && !(s in SEASON_LABEL)) throw new KnowledgeError('季節が正しくありません。');
		patch.season = (s || null) as Season | null;
	}
	const rights = form.get('rights');
	if (rights !== null && rights !== KEEP) {
		if (!(PHOTO_RIGHTS as readonly string[]).includes(String(rights))) throw new KnowledgeError('権利が正しくありません。');
		patch.rights = String(rights) as PhotoRights;
	}
	if (form.get('usageMode') === 'set') {
		const usage = form.getAll('usage').map(String);
		if (usage.some((u) => !(PHOTO_USAGES as readonly string[]).includes(u))) throw new KnowledgeError('使える範囲が正しくありません。');
		patch.usage_scope = PHOTO_USAGES.filter((u) => usage.includes(u));
	} else {
		const add: PhotoUsage[] = [], remove: PhotoUsage[] = [];
		for (const u of PHOTO_USAGES) {
			const v = form.get(`usage_${u}`);
			if (v === 'allow') add.push(u);
			else if (v === 'deny') remove.push(u);
		}
		if (add.length) patch.usage_add = add;
		if (remove.length) patch.usage_remove = remove;
	}
	const people = form.get('people');
	if (people !== null && people !== KEEP) {
		const p = peopleValue(String(people));
		if (!p) throw new KnowledgeError('人の写り込みが正しくありません。');
		Object.assign(patch, p);
	}
	const photographer = text(form, 'photographer', 100, '撮影者');
	if (photographer !== undefined) patch.photographer = photographer;
	const originalPath = text(form, 'originalPath', 500, '原本の場所');
	if (originalPath !== undefined) patch.original_path = originalPath;
	const note = text(form, 'note', 500, 'メモ');
	if (note !== undefined) patch.note = note;
	return patch;
}

/** 選んだ写真（URL）に同じ変更を入れる。まだ行が無い写真は作る（入れなかった欄は既定値＝不明・未確認） */
export async function saveRights(client: SupabaseClient, facilityId: string, urls: string[], patch: RightsPatch): Promise<number> {
	const list = [...new Set(urls.filter((u) => /^https:\/\//.test(u) && u.length <= 1000))];
	if (!list.length) throw new KnowledgeError('写真を選んでください。');
	if (list.length > 500) throw new KnowledgeError('一度に変えられるのは500枚までです。');
	const { usage_add, usage_remove, ...columns } = patch;
	if (!Object.keys(columns).length && !usage_add && !usage_remove) throw new KnowledgeError('変える項目がありません。');
	const book = client.schema('book');
	// 使える範囲を1つずつ足し引きするときは、今の値を読んで写真ごとに計算する
	let current = new Map<string, PhotoUsage[]>();
	if (usage_add || usage_remove) {
		const { data, error } = await book.from('photo_rights').select('url, usage_scope').eq('facility_id', facilityId).in('url', list);
		if (error) throw new KnowledgeError('保存できませんでした。時間をおいてもう一度お試しください。', 500);
		current = new Map((data ?? []).map((r) => [r.url as string, (r.usage_scope as PhotoUsage[]) ?? []]));
	}
	const rows = list.map((url) => {
		const row: Record<string, unknown> = { facility_id: facilityId, url, ...columns };
		if (usage_add || usage_remove) {
			const now = new Set(current.get(url) ?? []);
			for (const u of usage_add ?? []) now.add(u);
			for (const u of usage_remove ?? []) now.delete(u);
			row.usage_scope = PHOTO_USAGES.filter((u) => now.has(u));
		}
		return row;
	});
	// tenant_id は DB のトリガーが施設から入れる（列は not null なので仮の値を渡さず、トリガーに任せる）
	for (let i = 0; i < rows.length; i += 100) {
		const { error } = await book.from('photo_rights').upsert(rows.slice(i, i + 100), { onConflict: 'facility_id,url' });
		if (error) {
			if (/row-level security/.test(error.message)) throw new KnowledgeError('この施設の写真を編集する権限がありません。', 403);
			throw new KnowledgeError('保存できませんでした。時間をおいてもう一度お試しください。', 500);
		}
	}
	return list.length;
}
