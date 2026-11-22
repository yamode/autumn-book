// 施設ナレッジの管理画面（/admin/knowledge）用のサーバー関数。設計は docs/facility-knowledge.md。
// RLS は private.can_edit_book_knowledge（施設権限のある Book の admin / staff、PMS・RMS のスタッフ）。
// 承認（verified_*）は book.admin_knowledge_verify でしか入らない。内容を直すと DB のトリガーが承認を外す。
// 呼び出し側は Supabase Auth セッションに紐づいたクライアント（auth.ts の createSupabaseServerClient(event)）を渡すこと。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	KEY_PATTERN,
	SEASON_LABEL,
	TOPIC_LABEL,
	VISIBILITY_LABEL,
	type Season,
	type StoryTopic,
	type Visibility
} from '$lib/facility-knowledge';

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';

export interface KnowledgeFact {
	id: string;
	key: string;
	value: string;
	visibility: Visibility;
	validFrom: string | null;
	validUntil: string | null;
	sourceNote: string;
	verifiedAt: string | null;
	verifiedBy: string | null;
	sortOrder: number;
	updatedAt: string;
}
export interface KnowledgeStory {
	id: string;
	topic: StoryTopic;
	title: string;
	body: string;
	seasons: Season[];
	visibility: Visibility;
	validFrom: string | null;
	validUntil: string | null;
	sourceNote: string;
	verifiedAt: string | null;
	verifiedBy: string | null;
	sortOrder: number;
	updatedAt: string;
}
export interface KnowledgeApprover {
	userId: string;
	note: string;
	createdAt: string;
}

/** 画面に出す日本語のエラー。DB のエラーをそのまま見せない */
export class KnowledgeError extends Error {
	constructor(message: string, readonly status = 400) {
		super(message);
	}
}

function dbError(e: { code?: string; message?: string } | null, fallback: string): KnowledgeError {
	if (e?.code === '23505') return new KnowledgeError('同じ項目・同じ期間のものがすでにあります。既存の行を直してください。', 409);
	if (e?.code === '42501' || /row-level security|permission denied/i.test(e?.message ?? '')) {
		return new KnowledgeError('この施設のナレッジを編集する権限がありません。', 403);
	}
	if (/forbidden/.test(e?.message ?? '')) return new KnowledgeError('承認する権限がありません（施設の管理者か、登録された広報担当だけが承認できます）。', 403);
	return new KnowledgeError(fallback, 500);
}

const FACT_COLS = 'id, key, value, visibility, valid_from, valid_until, source_note, verified_at, verified_by, sort_order, updated_at';
const STORY_COLS = 'id, topic, title, body, seasons, visibility, valid_from, valid_until, source_note, verified_at, verified_by, sort_order, updated_at';

function mapFact(r: Record<string, unknown>): KnowledgeFact {
	return {
		id: String(r.id),
		key: String(r.key),
		value: String(r.value ?? ''),
		visibility: r.visibility as Visibility,
		validFrom: (r.valid_from as string | null) ?? null,
		validUntil: (r.valid_until as string | null) ?? null,
		sourceNote: String(r.source_note ?? ''),
		verifiedAt: (r.verified_at as string | null) ?? null,
		verifiedBy: (r.verified_by as string | null) ?? null,
		sortOrder: Number(r.sort_order ?? 0),
		updatedAt: String(r.updated_at)
	};
}
function mapStory(r: Record<string, unknown>): KnowledgeStory {
	return {
		id: String(r.id),
		topic: r.topic as StoryTopic,
		title: String(r.title ?? ''),
		body: String(r.body ?? ''),
		seasons: Array.isArray(r.seasons) ? (r.seasons as Season[]) : [],
		visibility: r.visibility as Visibility,
		validFrom: (r.valid_from as string | null) ?? null,
		validUntil: (r.valid_until as string | null) ?? null,
		sourceNote: String(r.source_note ?? ''),
		verifiedAt: (r.verified_at as string | null) ?? null,
		verifiedBy: (r.verified_by as string | null) ?? null,
		sortOrder: Number(r.sort_order ?? 0),
		updatedAt: String(r.updated_at)
	};
}

export async function listFacts(client: SupabaseClient, facilityId: string): Promise<KnowledgeFact[]> {
	const { data, error } = await client.schema('book').from('facility_facts').select(FACT_COLS).eq('facility_id', facilityId)
		.order('key').order('valid_from', { nullsFirst: true });
	if (error) throw dbError(error, '施設の事実を読み込めませんでした。');
	return (data ?? []).map((r) => mapFact(r as Record<string, unknown>));
}

export async function listStories(client: SupabaseClient, facilityId: string): Promise<KnowledgeStory[]> {
	const { data, error } = await client.schema('book').from('facility_stories').select(STORY_COLS).eq('facility_id', facilityId)
		.order('topic').order('sort_order').order('created_at');
	if (error) throw dbError(error, '魅力の説明を読み込めませんでした。');
	return (data ?? []).map((r) => mapStory(r as Record<string, unknown>));
}

export async function listApprovers(client: SupabaseClient, facilityId: string): Promise<KnowledgeApprover[]> {
	const { data, error } = await client.schema('book').from('knowledge_approvers').select('user_id, note, created_at').eq('facility_id', facilityId)
		.order('created_at');
	if (error) throw dbError(error, '承認できる人の一覧を読み込めませんでした。');
	return (data ?? []).map((r) => ({ userId: String(r.user_id), note: String(r.note ?? ''), createdAt: String(r.created_at) }));
}

// ---------------------------------------------------------------------------
// フォームの読み取り（画面からの値をここで検める。DB の check と同じ条件）
// ---------------------------------------------------------------------------

const DATE = /^\d{4}-\d{2}-\d{2}$/;
function text(form: FormData, name: string): string {
	return String(form.get(name) ?? '').trim();
}
function optDate(form: FormData, name: string, label: string): string | null {
	const v = text(form, name);
	if (!v) return null;
	if (!DATE.test(v) || Number.isNaN(Date.parse(v))) throw new KnowledgeError(`${label}の日付が正しくありません。`);
	return v;
}
function visibility(form: FormData): Visibility {
	const v = text(form, 'visibility');
	if (!(v in VISIBILITY_LABEL)) throw new KnowledgeError('公開範囲を選んでください。');
	return v as Visibility;
}
function period(form: FormData) {
	const validFrom = optDate(form, 'validFrom', '開始');
	const validUntil = optDate(form, 'validUntil', '終了');
	if (validFrom && validUntil && validFrom > validUntil) throw new KnowledgeError('期間の開始が終了より後になっています。');
	return { validFrom, validUntil };
}
function limited(v: string, max: number, label: string, required = true): string {
	if (required && !v) throw new KnowledgeError(`${label}を入力してください。`);
	if (v.length > max) throw new KnowledgeError(`${label}は${max.toLocaleString()}文字以内にしてください。`);
	return v;
}

export interface FactInput {
	key: string;
	value: string;
	visibility: Visibility;
	validFrom: string | null;
	validUntil: string | null;
	sourceNote: string;
}
export function parseFactForm(form: FormData): FactInput {
	// 編集は key、追加は「一覧から選ぶ（keyPreset）」か「入力する（keyCustom）」
	const key = text(form, 'key') || text(form, 'keyPreset') || text(form, 'keyCustom');
	if (!key) throw new KnowledgeError('項目を選ぶか入力してください。');
	if (!KEY_PATTERN.test(key) || key.length > 64) {
		throw new KnowledgeError('項目のキーは英小文字・数字・_ を「.」でつないだ形にしてください（例: access.bus）。');
	}
	return {
		key,
		value: limited(text(form, 'value'), 2000, '内容'),
		visibility: visibility(form),
		...period(form),
		sourceNote: limited(text(form, 'sourceNote'), 500, '出所', false)
	};
}

export interface StoryInput {
	topic: StoryTopic;
	title: string;
	body: string;
	seasons: Season[];
	visibility: Visibility;
	validFrom: string | null;
	validUntil: string | null;
	sourceNote: string;
}
export function parseStoryForm(form: FormData): StoryInput {
	const topic = text(form, 'topic');
	if (!(topic in TOPIC_LABEL)) throw new KnowledgeError('分類を選んでください。');
	const seasons = form.getAll('seasons').map(String).filter((s): s is Season => s in SEASON_LABEL);
	return {
		topic: topic as StoryTopic,
		title: limited(text(form, 'title'), 100, '見出し'),
		body: limited(String(form.get('body') ?? '').trim(), 10000, '本文'),
		seasons: [...new Set(seasons)],
		visibility: visibility(form),
		...period(form),
		sourceNote: limited(text(form, 'sourceNote'), 500, '出所', false)
	};
}

// ---------------------------------------------------------------------------
// 書き込み
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f-]{36}$/i;
function assertId(id: string) {
	if (!UUID.test(id)) throw new KnowledgeError('対象が見つかりません。', 404);
}

export async function addFact(client: SupabaseClient, facilityId: string, userId: string, input: FactInput): Promise<string> {
	const { data, error } = await client.schema('book').from('facility_facts').insert({
		tenant_id: TENANT_ID,
		facility_id: facilityId,
		key: input.key,
		value: input.value,
		visibility: input.visibility,
		valid_from: input.validFrom,
		valid_until: input.validUntil,
		source_note: input.sourceNote || null,
		updated_by: userId
	}).select('id').single();
	if (error) throw dbError(error, '登録できませんでした。');
	return String(data.id);
}

export async function updateFact(client: SupabaseClient, facilityId: string, userId: string, id: string, input: FactInput): Promise<void> {
	assertId(id);
	const { data, error } = await client.schema('book').from('facility_facts').update({
		key: input.key,
		value: input.value,
		visibility: input.visibility,
		valid_from: input.validFrom,
		valid_until: input.validUntil,
		source_note: input.sourceNote || null,
		updated_by: userId
	}).eq('id', id).eq('facility_id', facilityId).select('id');
	if (error) throw dbError(error, '保存できませんでした。');
	if (!data?.length) throw new KnowledgeError('対象が見つかりません（ほかの人が消した可能性があります）。', 404);
}

export async function addStory(client: SupabaseClient, facilityId: string, userId: string, input: StoryInput): Promise<string> {
	const { data, error } = await client.schema('book').from('facility_stories').insert({
		tenant_id: TENANT_ID,
		facility_id: facilityId,
		topic: input.topic,
		title: input.title,
		body: input.body,
		seasons: input.seasons,
		visibility: input.visibility,
		valid_from: input.validFrom,
		valid_until: input.validUntil,
		source_note: input.sourceNote || null,
		updated_by: userId
	}).select('id').single();
	if (error) throw dbError(error, '登録できませんでした。');
	return String(data.id);
}

export async function updateStory(client: SupabaseClient, facilityId: string, userId: string, id: string, input: StoryInput): Promise<void> {
	assertId(id);
	const { data, error } = await client.schema('book').from('facility_stories').update({
		topic: input.topic,
		title: input.title,
		body: input.body,
		seasons: input.seasons,
		visibility: input.visibility,
		valid_from: input.validFrom,
		valid_until: input.validUntil,
		source_note: input.sourceNote || null,
		updated_by: userId
	}).eq('id', id).eq('facility_id', facilityId).select('id');
	if (error) throw dbError(error, '保存できませんでした。');
	if (!data?.length) throw new KnowledgeError('対象が見つかりません（ほかの人が消した可能性があります）。', 404);
}

export async function removeItem(client: SupabaseClient, facilityId: string, kind: 'fact' | 'story', id: string): Promise<void> {
	assertId(id);
	const table = kind === 'fact' ? 'facility_facts' : 'facility_stories';
	const { error } = await client.schema('book').from(table).delete().eq('id', id).eq('facility_id', facilityId);
	if (error) throw dbError(error, '削除できませんでした。');
}

/** 承認する／承認を外す（DB 側で権限を確かめ、監査ログに残す） */
export async function verifyItem(client: SupabaseClient, kind: 'fact' | 'story', id: string, approve: boolean): Promise<void> {
	assertId(id);
	const { error } = await client.schema('book').rpc('admin_knowledge_verify', { p_kind: kind, p_id: id, p_approve: approve });
	if (error) throw dbError(error, approve ? '承認できませんでした。' : '承認を外せませんでした。');
}

export async function addApprover(client: SupabaseClient, facilityId: string, actorId: string, userId: string, note: string): Promise<void> {
	assertId(userId);
	const { error } = await client.schema('book').from('knowledge_approvers').insert({
		tenant_id: TENANT_ID,
		facility_id: facilityId,
		user_id: userId,
		note: limited(note, 200, 'メモ', false) || null,
		created_by: actorId
	});
	if (error?.code === '23505') throw new KnowledgeError('この人はすでに登録されています。', 409);
	if (error) {
		if (error.code === '42501' || /row-level security/i.test(error.message)) {
			throw new KnowledgeError('承認できる人を登録できるのは、施設の管理者だけです。', 403);
		}
		throw dbError(error, '登録できませんでした。');
	}
}

export async function removeApprover(client: SupabaseClient, facilityId: string, userId: string): Promise<void> {
	assertId(userId);
	const { data, error } = await client.schema('book').from('knowledge_approvers').delete().eq('facility_id', facilityId).eq('user_id', userId).select('user_id');
	if (error) throw dbError(error, '外せませんでした。');
	if (!data?.length) throw new KnowledgeError('外せませんでした（施設の管理者だけが外せます）。', 403);
}

// ---------------------------------------------------------------------------
// 初期データ（取材の回答など）の取り込み。すべて未承認で入れ、すでにあるものは飛ばす
// ---------------------------------------------------------------------------

export interface KnowledgeSeed {
	label: string;
	source: string;
	facts: { key: string; value: string; valueJson?: unknown; visibility: Visibility; note?: string }[];
	stories: { topic: StoryTopic; title: string; body: string; seasons: Season[]; visibility: Visibility }[];
}

export async function importSeed(
	client: SupabaseClient,
	facilityId: string,
	userId: string,
	seed: KnowledgeSeed
): Promise<{ added: number; skipped: number }> {
	const [facts, stories] = await Promise.all([listFacts(client, facilityId), listStories(client, facilityId)]);
	const haveKeys = new Set(facts.filter((f) => !f.validFrom).map((f) => f.key));
	const haveTitles = new Set(stories.map((s) => s.title));
	const newFacts = seed.facts.filter((f) => !haveKeys.has(f.key));
	const newStories = seed.stories.filter((s) => !haveTitles.has(s.title));
	const sourceOf = (note?: string) => (note ? `${seed.source}／${note}` : seed.source).slice(0, 500);

	if (newFacts.length) {
		const { error } = await client.schema('book').from('facility_facts').insert(newFacts.map((f, i) => ({
			tenant_id: TENANT_ID,
			facility_id: facilityId,
			key: f.key,
			value: f.value,
			value_json: f.valueJson ?? null,
			visibility: f.visibility,
			source_note: sourceOf(f.note),
			sort_order: i,
			updated_by: userId
		})));
		if (error) throw dbError(error, '施設の事実を取り込めませんでした。');
	}
	if (newStories.length) {
		const { error } = await client.schema('book').from('facility_stories').insert(newStories.map((s, i) => ({
			tenant_id: TENANT_ID,
			facility_id: facilityId,
			topic: s.topic,
			title: s.title,
			body: s.body,
			seasons: s.seasons,
			visibility: s.visibility,
			source_note: sourceOf(),
			sort_order: i,
			updated_by: userId
		})));
		if (error) throw dbError(error, '魅力の説明を取り込めませんでした。');
	}
	const total = seed.facts.length + seed.stories.length;
	const added = newFacts.length + newStories.length;
	return { added, skipped: total - added };
}
