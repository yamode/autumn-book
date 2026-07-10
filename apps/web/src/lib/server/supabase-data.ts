// Supabase データアダプタ — book スキーマ（autumn-shared#28 適用後に有効化）
// store.ts（デモ）と同じ意味論の非同期 API を提供する。
// カットオーバー手順:
//   1. autumn-shared#28 を main にマージ（PROD 自動適用）
//   2. rms 側で daily_rates / availability にデータが入っていること、
//      book.facility_contents / plan_contents に公開行を投入済みであることを確認
//   3. .env の DATA_SOURCE=supabase に変更し、各 +page.server.ts の import を
//      store.ts からこのモジュールへ段階的に切替（検索系 → 予約系 → 会員系の順）
//   4. 客室電子インフォメーション（inroom・P8a）: ゲスト面 RPC（stay_info /
//      claim_stay_by_code / list_house_guides）は anon で即動作するため DATA_SOURCE=supabase で有効。
//      管理面（issue/revoke/list_stay_tokens・house_guide_upsert/delete）は authenticated 前提のため
//      Supabase Auth 本接続（AUTH_MODE=supabase）後に有効。それまで admin は demo（store.ts）を使う。
// 会員系（my_reservations / register_member / point_balance）は Supabase Auth
// セッション（P5: @supabase/ssr）が前提のため、cookie 連携実装後に接続する。
//
// コンテンツ翻訳（i18n フェーズ2）の扱い:
//   - `book.content_translations` テーブル（autumn-shared PR #28 以降に追加）を使用。
//   - unique(entity_type, entity_id, locale) で一致する行を entity_id 群で1クエリ取得。
//   - store.ts の applyTranslation と同じ §2.2 規約でマージ:
//       merged = { ...baseRow, ...translation.fields }
//     （空文字は欠落扱い・amenities/access 等の jsonb は丸ごと置換・is_published=false は無視）
//   - locale 引数は各 load 関数に追加し、getLocale() を渡す（store.ts と対称）。
//   - 実装例（listFacilities）:
//       const { data: tr } = await supa()
//         .from('content_translations')
//         .select('entity_id, locale, fields, is_published')
//         .in('entity_id', data.map(r => r.facility_id))
//         .eq('locale', locale)
//         .eq('is_published', true);
//       return data.map(row => {
//         const t = tr?.find(t => t.entity_id === row.facility_id);
//         if (!t) return row;
//         const merged = { ...row };
//         for (const [k, v] of Object.entries(t.fields)) {
//           if (v !== '' && v !== null && v !== undefined) merged[k as keyof typeof merged] = v as never;
//         }
//         return merged;
//       });
import { supa } from './supabase';
import type {
	CalendarDay,
	GuestInfo,
	NewsPost,
	OtayoriPost,
	OtayoriAdminItem,
	ForumBoard,
	ForumThread,
	ForumThreadListItem,
	ForumPostView,
	HouseGuide,
	StayToken,
	StayInfo,
	Locale
} from '$lib/types';
import type { Quote } from '@autumn-book/core';
import type { SupabaseClient } from '@supabase/supabase-js';

// store.ts のデモ facility ID（'f-nishiwaga' 等）と実 Supabase の core.facilities.id（UUID）の対応表。
// news 管理画面（施設スイッチャーは店舗一覧を store.ts の facilities から取得するデモ由来のUI）を
// 実データに繋ぐために使用する。新しい施設を追加した場合はここにも追記が必要。
export const FACILITY_UUID: Record<string, string> = {
	'f-nishiwaga': '10000000-0000-0000-0000-000000000001',
	'f-oga': '10000000-0000-0000-0000-000000000002'
};
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ---------------------------------------------------------------- 公開コンテンツ

export interface FacilityRow {
	facility_id: string;
	brand_id: string;
	brand_slug: string;
	slug: string;
	name: string;
	phone: string;
	catch_copy: string | null;
	description: string | null;
	lat: number | null;
	lng: number | null;
	prefecture: string | null;
	address_public: string | null;
	checkin_time: string | null;
	checkout_time: string | null;
	amenities: string[];
	access: Record<string, unknown>;
}

export async function listFacilities(): Promise<FacilityRow[]> {
	const { data, error } = await supa().from('v_facilities').select('*');
	if (error) throw error;
	return data as FacilityRow[];
}

export async function listFacilityPhotos(facilityId: string) {
	const { data, error } = await supa()
		.from('facility_photos')
		.select('url, caption, category, sort_order')
		.eq('facility_id', facilityId)
		.order('sort_order');
	if (error) throw error;
	return data;
}

export async function listRoomTypes(facilityId: string) {
	const { data, error } = await supa().from('v_room_types').select('*').eq('facility_id', facilityId);
	if (error) throw error;
	return data;
}

export async function listPlans(facilityId: string) {
	const { data, error } = await supa()
		.from('v_plans')
		.select('*')
		.eq('facility_id', facilityId)
		.order('sort_order');
	if (error) throw error;
	return data;
}

export async function listNews(facilityId: string, limit?: number) {
	let q = supa()
		.from('news_posts')
		.select('id, title, body, published_at')
		.eq('facility_id', facilityId)
		.order('published_at', { ascending: false });
	if (limit) q = q.limit(limit);
	const { data, error } = await q;
	if (error) throw error;
	return data;
}

// 公開済み記事の単体取得（施設HP側の記事詳細ページ用）。RLSにより is_published=true のみ取得可。
export async function getNewsPost(facilityId: string, id: string) {
	const { data, error } = await supa()
		.from('news_posts')
		.select('id, title, body, published_at')
		.eq('facility_id', facilityId)
		.eq('id', id)
		.maybeSingle();
	if (error) throw error;
	return data;
}

// --------------------------------------------------------- お知らせ管理（authenticated・要facility_access）
// admin/news 用。下書きを含む全件の閲覧・追加・編集はRLS上 authenticated + has_facility_access が必須のため、
// 呼び出し側（+page.server.ts）で Supabase Auth セッションに紐づいたクライアント
// （auth.ts の createSupabaseServerClient(event)）を渡すこと。supa()（anonキー）を渡すと
// news_posts_staff_all ポリシーに阻まれ 0件 / permission denied になる。

export async function listNewsAdmin(client: SupabaseClient, facilityId: string): Promise<NewsPost[]> {
	const { data, error } = await client
		.schema('book')
		.from('news_posts')
		.select('id, facility_id, title, body, published_at, is_published, created_at')
		.eq('facility_id', facilityId)
		.order('published_at', { ascending: false });
	if (error) throw error;
	return (data ?? []).map(mapNewsRow);
}

export async function addNewsAdmin(
	client: SupabaseClient,
	facilityId: string,
	input: { title: string; body: string; publishedAt: string }
): Promise<NewsPost> {
	const { data, error } = await client
		.schema('book')
		.from('news_posts')
		.insert({
			tenant_id: TENANT_ID,
			facility_id: facilityId,
			title: input.title,
			body: input.body,
			published_at: input.publishedAt,
			is_published: false
		})
		.select('id, facility_id, title, body, published_at, is_published, created_at')
		.single();
	if (error) throw error;
	return mapNewsRow(data);
}

export async function updateNewsAdmin(
	client: SupabaseClient,
	postId: string,
	input: { title: string; body: string; publishedAt: string; isPublished: boolean }
): Promise<NewsPost> {
	const { data, error } = await client
		.schema('book')
		.from('news_posts')
		.update({
			title: input.title,
			body: input.body,
			published_at: input.publishedAt,
			is_published: input.isPublished
		})
		.eq('id', postId)
		.select('id, facility_id, title, body, published_at, is_published, created_at')
		.single();
	if (error) throw error;
	return mapNewsRow(data);
}

function mapNewsRow(row: {
	id: string;
	facility_id: string;
	title: string;
	body: string | null;
	published_at: string;
	is_published: boolean;
	created_at: string;
}): NewsPost {
	return {
		id: row.id,
		facilityId: row.facility_id,
		title: row.title,
		body: row.body ?? '',
		publishedAt: row.published_at,
		isPublished: row.is_published,
		createdAt: row.created_at
	};
}

export async function listFaqs(facilityId: string) {
	const { data, error } = await supa()
		.from('faqs')
		.select('id, category, question, answer, sort_order')
		.eq('facility_id', facilityId)
		.order('sort_order');
	if (error) throw error;
	return data;
}

// ---------------------------------------------------------------- 検索系 RPC（設計書 §5.2）

export async function searchAvailability(checkin: string, nights: number, adults: number) {
	const { data, error } = await supa().rpc('search_availability', {
		p_checkin: checkin,
		p_nights: nights,
		p_adults: adults
	});
	if (error) throw error;
	return data as { facility_id: string; min_total: number; min_per_person: number; remaining: number }[];
}

export async function referenceMinPrice(adults = 2) {
	const { data, error } = await supa().rpc('reference_min_price', { p_adults: adults });
	if (error) throw error;
	return data as { facility_id: string; min_per_person: number }[];
}

export async function getPlanCalendar(ratePlanId: string, month: string, adults = 2): Promise<CalendarDay[]> {
	const { data, error } = await supa().rpc('get_plan_calendar', {
		p_rate_plan_id: ratePlanId,
		p_month: `${month}-01`,
		p_adults: adults
	});
	if (error) throw error;
	return (data as { d: string; price: number | null; remaining: number; min_stay: number }[]).map((r) => ({
		date: r.d,
		price: r.price,
		remaining: r.remaining,
		mark: r.remaining === 0 || r.price === null ? '×' : r.remaining === 1 ? '△' : r.remaining <= 3 ? '○' : '◎'
	}));
}

export async function quote(
	ratePlanId: string,
	roomTypeId: string,
	checkin: string,
	nights: number,
	adults: number
): Promise<Quote> {
	const { data, error } = await supa().rpc('quote', {
		p_rate_plan_id: ratePlanId,
		p_room_type_id: roomTypeId,
		p_checkin: checkin,
		p_nights: nights,
		p_adults: adults
	});
	if (error) throw error;
	return mapQuote(data);
}

function mapQuote(q: {
	lines: { date: string; unit_price: number; adults: number; subtotal: number }[];
	total: number;
	per_person: number;
	tax_included: number;
}): Quote {
	return {
		lines: q.lines.map((l) => ({ date: l.date, unitPrice: l.unit_price, adults: l.adults, subtotal: l.subtotal })),
		total: q.total,
		perPerson: q.per_person,
		taxIncluded: q.tax_included,
		pointsUsed: 0,
		payable: q.total
	};
}

// ---------------------------------------------------------------- 予約系 RPC

export async function createHold(
	sessionId: string,
	ratePlanId: string,
	roomTypeId: string,
	checkin: string,
	nights: number,
	adults: number
): Promise<{ hold_id: string; expires_at: string; quote: Quote } | { error: 'sold_out' | string }> {
	const { data, error } = await supa().rpc('create_hold', {
		p_session_id: sessionId,
		p_rate_plan_id: ratePlanId,
		p_room_type_id: roomTypeId,
		p_checkin: checkin,
		p_nights: nights,
		p_adults: adults
	});
	if (error) {
		if (error.message.includes('sold_out')) return { error: 'sold_out' };
		throw error;
	}
	return { hold_id: data.hold_id, expires_at: data.expires_at, quote: mapQuote(data.quote) };
}

export async function getHold(holdId: string, sessionId: string) {
	const { data, error } = await supa().rpc('get_hold', { p_hold_id: holdId, p_session_id: sessionId });
	if (error) throw error;
	return data;
}

export async function confirmBooking(
	holdId: string,
	sessionId: string,
	guest: GuestInfo,
	pointsUsed = 0
): Promise<{ booking_code: string } | { error: string }> {
	const { data, error } = await supa().rpc('confirm_booking', {
		p_hold_id: holdId,
		p_session_id: sessionId,
		p_guest: guest,
		p_points_used: pointsUsed
	});
	if (error) {
		if (error.message.includes('hold_expired')) return { error: 'hold_expired' };
		throw error;
	}
	return data;
}

// 会員 or 社内のみ（authenticated）。Supabase Auth セッション接続後に使用（P5）
export async function cancelBooking(bookingCode: string, opts: { waiveFee?: boolean; reason?: string } = {}) {
	const { data, error } = await supa().rpc('cancel_booking', {
		p_booking_code: bookingCode,
		p_waive_fee: opts.waiveFee ?? false,
		p_reason: opts.reason ?? null
	});
	if (error) throw error;
	return data as { booking_code: string; cancellation_fee: number };
}

// ---------------------------------------------------------------- フォーラム RPC（設計書 §5.3）
// book スキーマの forum_* RPC を呼ぶ薄いアダプタ。store.ts（demo）と同じ意味論。
// 読み取り系（forum_list_boards / forum_list_threads / forum_get_thread / forum_list_posts）は
//   anon キーで即動作する（grant execute = anon, authenticated）。
// 書き込み系・モデレーション系（forum_set_nickname 以下）は auth.uid() を参照するため、
//   Supabase Auth 本接続（P5・@supabase/ssr の cookie 連携）後に有効になる。
//   それまでは anon セッションでは not_authenticated / forbidden が返る（cancelBooking と同じ扱い）。
// author_user_id は RPC 出力に含まれない（実体 ID 非露出を DB 側で構造的に保証）。

export interface ForumBoardRow {
	id: string;
	slug: string;
	title: string;
	description: string;
	sort_order: number;
	is_archived: boolean;
	created_at: string;
	thread_count: number;
	last_posted_at: string | null;
}

export interface ForumThreadListItemRow {
	id: string;
	title: string;
	is_pinned: boolean;
	is_locked: boolean;
	reply_count: number;
	last_posted_at: string;
	created_at: string;
	author_nickname: string;
	author_is_staff: boolean;
}

export interface ForumThreadRow {
	id: string;
	board_slug: string;
	board_title: string;
	title: string;
	is_pinned: boolean;
	is_locked: boolean;
	reply_count: number;
	last_posted_at: string;
	created_at: string;
}

export interface ForumPostViewRow {
	id: string;
	post_no: number;
	body: string;
	reply_to_no: number | null;
	created_at: string;
	is_deleted: boolean;
	nickname: string | null;
	is_staff: boolean;
	is_own: boolean;
}

// 読み取り系（anon キーで動作）

export async function listForumBoards(): Promise<ForumBoardRow[]> {
	const { data, error } = await supa().rpc('forum_list_boards');
	if (error) throw error;
	return (data ?? []) as ForumBoardRow[];
}

export async function listForumThreads(
	boardSlug: string,
	page = 1,
	perPage = 20
): Promise<{ total: number; threads: ForumThreadListItemRow[] }> {
	const { data, error } = await supa().rpc('forum_list_threads', {
		p_board_slug: boardSlug,
		p_page: page,
		p_per: perPage
	});
	if (error) throw error;
	return data as { total: number; threads: ForumThreadListItemRow[] };
}

export async function getForumThread(threadId: string): Promise<ForumThreadRow | null> {
	const { data, error } = await supa().rpc('forum_get_thread', { p_thread_id: threadId });
	if (error) throw error;
	return (data ?? null) as ForumThreadRow | null;
}

export async function listForumPosts(threadId: string): Promise<ForumPostViewRow[]> {
	const { data, error } = await supa().rpc('forum_list_posts', { p_thread_id: threadId });
	if (error) throw error;
	return (data ?? []) as ForumPostViewRow[];
}

// ---- 読み取り系アダプタ（route が使う camelCase 型に整形）----
// route 側のページ型を store（demo）と同一に保つため、上の *Row（snake_case RPC 出力）を
// $lib/types の Forum* 型へマッピングする。命名は store.ts の関数と揃える。
// author_user_id は RPC 出力に含まれない（実体 ID 非露出）ため、ForumBoard.createdAt など
// snake_case にしか無いフィールドはそのまま移送する。

/** store.listForumBoards 相当。isArchived 含む・sortOrder 順（RPC が整列済み） */
export async function listForumBoardsData(): Promise<(ForumBoard & { threadCount: number; lastPostedAt: string | null })[]> {
	const rows = await listForumBoards();
	return rows.map((b) => ({
		id: b.id,
		slug: b.slug,
		title: b.title,
		description: b.description,
		sortOrder: b.sort_order,
		isArchived: b.is_archived,
		createdAt: b.created_at,
		threadCount: b.thread_count,
		lastPostedAt: b.last_posted_at
	}));
}

/** store.getForumBoard 相当。board 一覧から slug で引く（RPC に単体取得が無いため） */
export async function getForumBoardData(slug: string): Promise<ForumBoard | undefined> {
	const rows = await listForumBoards();
	const b = rows.find((r) => r.slug === slug);
	if (!b) return undefined;
	return {
		id: b.id,
		slug: b.slug,
		title: b.title,
		description: b.description,
		sortOrder: b.sort_order,
		isArchived: b.is_archived,
		createdAt: b.created_at
	};
}

/** store.listForumThreads 相当。boardSlug で引く（store は boardId・RPC は slug）。整列は RPC 側 */
export async function listForumThreadsData(
	boardSlug: string,
	page = 1,
	perPage = 20
): Promise<{ threads: ForumThreadListItem[]; total: number }> {
	const { total, threads } = await listForumThreads(boardSlug, page, perPage);
	return {
		total,
		threads: (threads ?? []).map((t) => ({
			id: t.id,
			title: t.title,
			isPinned: t.is_pinned,
			isLocked: t.is_locked,
			replyCount: t.reply_count,
			lastPostedAt: t.last_posted_at,
			createdAt: t.created_at,
			authorNickname: t.author_nickname,
			authorIsStaff: t.author_is_staff
		}))
	};
}

/** store.getForumThread 相当。is_deleted なら RPC が null を返す → undefined へ正規化 */
export async function getForumThreadData(
	threadId: string
): Promise<(ForumThread & { boardSlug: string; boardTitle: string }) | undefined> {
	const t = await getForumThread(threadId);
	if (!t) return undefined;
	return {
		id: t.id,
		// boardId は RPC 出力に無い（board_slug/board_title のみ）。route は boardSlug/boardTitle しか
		// 使わないため、boardId は空文字を置く（型の穴埋め・表示には未使用）。
		boardId: '',
		// authorUserId は実体 ID 非露出のため RPC 出力に無い。表示未使用なので空文字。
		authorUserId: '',
		title: t.title,
		isPinned: t.is_pinned,
		isLocked: t.is_locked,
		isDeleted: false,
		replyCount: t.reply_count,
		lastPostedAt: t.last_posted_at,
		createdAt: t.created_at,
		boardSlug: t.board_slug,
		boardTitle: t.board_title
	};
}

/** store.listForumPosts 相当。post_no 昇順・削除済みもプレースホルダ行（RPC が整形済み）。
 *  is_own は auth.uid() 依存だが anon セッションでは常に false（Web からは本人判定不可・P5 で有効化）。 */
export async function listForumPostsData(threadId: string): Promise<ForumPostView[]> {
	const rows = await listForumPosts(threadId);
	return rows.map((p) => ({
		id: p.id,
		postNo: p.post_no,
		body: p.is_deleted ? '' : p.body,
		replyToNo: p.reply_to_no,
		createdAt: p.created_at,
		isDeleted: p.is_deleted,
		nickname: p.is_deleted ? null : p.nickname,
		isStaff: p.is_staff,
		isOwn: p.is_own
	}));
}

// 書き込み系（authenticated・Supabase Auth 本接続後に有効。P5）

export async function setForumNickname(nickname: string): Promise<{ user_id: string; nickname: string }> {
	const { data, error } = await supa().rpc('forum_set_nickname', { p_nickname: nickname });
	if (error) throw error;
	return data as { user_id: string; nickname: string };
}

export async function createForumThread(
	boardSlug: string,
	title: string,
	body: string
): Promise<{ thread_id: string }> {
	const { data, error } = await supa().rpc('forum_create_thread', {
		p_board_slug: boardSlug,
		p_title: title,
		p_body: body
	});
	if (error) throw error;
	return data as { thread_id: string };
}

export async function createForumPost(
	threadId: string,
	body: string
): Promise<{ post_id: string; post_no: number }> {
	const { data, error } = await supa().rpc('forum_create_post', {
		p_thread_id: threadId,
		p_body: body
	});
	if (error) throw error;
	return data as { post_id: string; post_no: number };
}

export async function deleteOwnForumPost(postId: string): Promise<{ post_id: string }> {
	const { data, error } = await supa().rpc('forum_delete_own_post', { p_post_id: postId });
	if (error) throw error;
	return data as { post_id: string };
}

// モデレーション系（authenticated + 内部 staff/admin ガード・Supabase Auth 本接続後に有効。P5）

export async function moderateForumThread(
	threadId: string,
	patch: { isPinned?: boolean; isLocked?: boolean; isDeleted?: boolean }
): Promise<{ thread_id: string }> {
	const { data, error } = await supa().rpc('forum_moderate_thread', {
		p_thread_id: threadId,
		p_pinned: patch.isPinned ?? null,
		p_locked: patch.isLocked ?? null,
		p_deleted: patch.isDeleted ?? null
	});
	if (error) throw error;
	return data as { thread_id: string };
}

export async function deleteForumPost(postId: string): Promise<{ post_id: string }> {
	const { data, error } = await supa().rpc('forum_delete_post', { p_post_id: postId });
	if (error) throw error;
	return data as { post_id: string };
}

export async function setForumBan(userId: string, banned: boolean): Promise<{ user_id: string; banned: boolean }> {
	const { data, error } = await supa().rpc('forum_set_ban', { p_user_id: userId, p_banned: banned });
	if (error) throw error;
	return data as { user_id: string; banned: boolean };
}

export async function upsertForumBoard(input: {
	id?: string;
	slug: string;
	title: string;
	description: string;
	sortOrder: number;
	isArchived: boolean;
}): Promise<{ board_id: string }> {
	const { data, error } = await supa().rpc('forum_upsert_board', {
		p_id: input.id ?? null,
		p_slug: input.slug,
		p_title: input.title,
		p_description: input.description,
		p_sort_order: input.sortOrder,
		p_is_archived: input.isArchived
	});
	if (error) throw error;
	return data as { board_id: string };
}

// ---------------------------------------------------------------- おたよりポイント RPC（設計書 §5.3 / §5.4）
// book スキーマの otayori_* RPC を呼ぶ薄いアダプタ。store.ts（demo）と同じ意味論。
// 本機能は全 RPC が authenticated 限定（grant execute = authenticated, service_role。anon は付けない）
//   のため、Supabase Auth 本接続（P5・@supabase/ssr の cookie 連携）後に有効になる。
//   それまでは anon セッションでは not_authenticated / forbidden が返る（cancelBooking と同じ扱い）。
// DATA_SOURCE=demo の現状は store.ts 実装が実働。
// member_user_id（= auth.users.id）や他会員の本文は deny-all + SECURITY DEFINER RPC で構造的に保護。
// 型は $lib/types の OtayoriEntry / OtayoriPost / OtayoriAdminItem（camelCase）に対応。
//   RPC は snake_case jsonb を返すため、ここでは RPC 出力の素の形（*Row）を返し、
//   camelCase へのマッピングは呼び出し側（route）で行う（forum_* と同じ流儀）。

export interface OtayoriLedgerRow {
	id: string;
	delta: number;
	reason: string;
	created_at: string;
}

export interface OtayoriPostRow {
	id: string;
	body: string;
	radio_name: string | null;
	status: OtayoriPost['status'];
	review_note: string | null;
	created_at: string;
	reviewed_at: string | null;
}

export interface OtayoriMySummaryRow {
	balance: number;
	ledger: OtayoriLedgerRow[];
	posts: OtayoriPostRow[];
}

export interface OtayoriAdminItemRow {
	post_id: string;
	member_user_id: string;
	member_code: string;
	member_name: string | null;
	radio_name: string | null;
	body: string;
	status: OtayoriAdminItem['status'];
	created_at: string;
}

// 会員向け（authenticated・Supabase Auth 本接続後に有効。P5）

// おたよりポイント残高（自分 or 社内のみ）。SUM(delta)。
export async function otayoriBalance(userId?: string): Promise<number> {
	const { data, error } = await supa().rpc('otayori_balance', { p_user: userId ?? null });
	if (error) throw error;
	return (data ?? 0) as number;
}

// 自分のおたよりサマリ（残高 + 台帳 + 投稿一覧）。auth.uid() の分のみ。
export async function getOtayoriMySummary(): Promise<OtayoriMySummaryRow> {
	const { data, error } = await supa().rpc('otayori_my_summary');
	if (error) throw error;
	return data as OtayoriMySummaryRow;
}

// おたより投稿（申請）。会員必須・本文 1〜2000字・ラジオネーム ≤40字・pending は5件まで。
// status='pending' で INSERT（ポイントは付与しない）。
export async function submitOtayori(body: string, radioName?: string): Promise<{ post_id: string }> {
	const { data, error } = await supa().rpc('otayori_submit', {
		p_body: body,
		p_radio_name: radioName ?? null
	});
	if (error) throw error;
	return data as { post_id: string };
}

// 管理向け（authenticated + 内部 staff/admin ガード・Supabase Auth 本接続後に有効。P5）

// 投稿一覧（管理・staff 可）。member_code / member_name を結合。created_at 降順・ページング。
export async function listOtayoriAdmin(
	status: 'pending' | 'approved' | 'rejected' = 'pending',
	page = 1,
	perPage = 50
): Promise<{ total: number; items: OtayoriAdminItemRow[] }> {
	const { data, error } = await supa().rpc('otayori_list_admin', {
		p_status: status,
		p_page: page,
		p_per: perPage
	});
	if (error) throw error;
	return data as { total: number; items: OtayoriAdminItemRow[] };
}

// 投稿の承認（admin・＝1pt 付与）。再承認しても二重付与されない（冪等）。
export async function approveOtayori(postId: string): Promise<{ post_id: string; status: string }> {
	const { data, error } = await supa().rpc('otayori_approve', { p_post_id: postId });
	if (error) throw error;
	return data as { post_id: string; status: string };
}

// 投稿の却下（staff）。ポイント操作なし。
export async function rejectOtayori(postId: string, note?: string): Promise<{ post_id: string; status: string }> {
	const { data, error } = await supa().rpc('otayori_reject', {
		p_post_id: postId,
		p_note: note ?? null
	});
	if (error) throw error;
	return data as { post_id: string; status: string };
}

// 会員別の手動付与/調整（admin・既存保持者向け）。delta は正負可・p_delta=0 / 空理由は拒否。
export async function adjustOtayori(memberUserId: string, delta: number, reason: string): Promise<void> {
	const { error } = await supa().rpc('otayori_adjust', {
		p_member_user_id: memberUserId,
		p_delta: delta,
		p_reason: reason
	});
	if (error) throw error;
}

// ---------------------------------------------------------------- 客室電子インフォメーション RPC（設計書 §7・P8a）
// book スキーマの inroom RPC（migration 20260710103006_book_inroom_phase1）を呼ぶ薄いアダプタ。
// store.ts（demo）と同じ意味論・同じ camelCase 型（HouseGuide / StayToken / StayInfo）を返す。
//
// ・ゲスト面（sbResolveStay / sbClaimStayByCode / sbListHouseGuides）は anon `supa()` で動作。
//   RPC は無効トークン等で例外（invalid_token / invalid_code）を投げるため、ここで null 返しへ正規化。
// ・管理面（sbIssueStayToken 以下）は authenticated + private.has_facility_access が前提のため、
//   呼び出し側で Supabase Auth セッションに紐づく client（auth.ts の createSupabaseServerClient）を渡す。
//   `supa()`（anon）を渡すと not_authenticated / forbidden になる（otayori/news 管理系と同じ流儀）。
// ・demo facility ID（'f-nishiwaga' 等）が渡された場合は FACILITY_UUID で UUID へ変換する
//   （ゲスト面は stay_info が既に UUID を返すため通常は不要だが、両対応にしておく）。

function toFacilityUuid(facilityId: string): string {
	return FACILITY_UUID[facilityId] ?? facilityId;
}

// ---- ゲスト面（anon）----

interface StayInfoRow {
	token_id: string;
	room_code: string;
	guest_name: string | null;
	valid_from: string;
	valid_to: string;
	facility: { id: string; slug: string; name: string; phone: string | null };
}

/** store.resolveStay 相当。無効トークンは RPC 例外 → null に正規化 */
export async function sbResolveStay(token: string): Promise<StayInfo | null> {
	const { data, error } = await supa().rpc('stay_info', { p_token: token });
	if (error) return null; // invalid_token など
	const r = data as StayInfoRow;
	return {
		tokenId: r.token_id,
		roomCode: r.room_code,
		guestName: r.guest_name ?? undefined,
		validFrom: r.valid_from,
		validTo: r.valid_to,
		facility: {
			id: r.facility.id,
			slug: r.facility.slug,
			name: r.facility.name,
			phone: r.facility.phone ?? undefined
		}
	};
}

/** store.claimStayByCode 相当。無効コードは RPC 例外 → null に正規化 */
export async function sbClaimStayByCode(code: string): Promise<string | null> {
	const { data, error } = await supa().rpc('claim_stay_by_code', { p_short_code: code });
	if (error) return null; // invalid_code など
	return (data as { token: string }).token;
}

interface HouseGuideRow {
	id: string;
	section: string;
	title: string;
	body: string;
	lang: Locale;
	sort_order: number;
}

/** store.listHouseGuidesFor 相当。公開のみ・language-unit フォールバックは RPC 側で実施 */
export async function sbListHouseGuides(facilityId: string, lang: string): Promise<HouseGuide[]> {
	const facilityUuid = toFacilityUuid(facilityId);
	const { data, error } = await supa().rpc('list_house_guides', { p_facility: facilityUuid, p_lang: lang });
	if (error) throw error;
	return ((data ?? []) as HouseGuideRow[]).map((r) => ({
		id: r.id,
		facilityId: facilityUuid,
		section: r.section,
		title: r.title,
		body: r.body,
		lang: r.lang,
		sortOrder: r.sort_order,
		isPublished: true // list_house_guides は公開分のみ返す
	}));
}

// ---- 管理面（authenticated・Supabase Auth 本接続後に有効）----
// 注: 管理用ガイド一覧（未公開含む）RPC は P8a には無い。deny-all テーブルの直 select も不可のため、
//     管理面のガイド一覧アダプタは省略する（P5 Auth 本接続時に管理用一覧 RPC を追加する）。
//     demo モードでは store.ts の listHouseGuidesAdmin が全件を返し機能は完結する。

interface StayTokenRow {
	id: string;
	stay_id: string | null;
	room_code: string;
	guest_name: string | null;
	token: string;
	short_code: string;
	valid_from: string;
	valid_to: string;
	revoked_at: string | null;
	last_used_at: string | null;
	created_at: string | null;
	is_active?: boolean;
}

function mapStayTokenRow(r: StayTokenRow, facilityId: string): StayToken {
	return {
		id: r.id,
		facilityId,
		stayId: r.stay_id ?? undefined,
		roomCode: r.room_code,
		guestName: r.guest_name ?? undefined,
		token: r.token,
		shortCode: r.short_code,
		validFrom: r.valid_from,
		validTo: r.valid_to,
		revokedAt: r.revoked_at ?? undefined,
		lastUsedAt: r.last_used_at ?? undefined,
		createdAt: r.created_at ?? r.valid_from
	};
}

/** store.issueStayToken 相当。token/short_code はサーバ（RPC）生成。監査記帳は RPC 側 */
export async function sbIssueStayToken(
	client: SupabaseClient,
	input: { facilityId: string; roomCode: string; guestName?: string; validTo: string; validFrom?: string; stayId?: string }
): Promise<StayToken> {
	const facilityUuid = toFacilityUuid(input.facilityId);
	const { data, error } = await client.schema('book').rpc('issue_stay_token', {
		p_facility: facilityUuid,
		p_room_code: input.roomCode,
		p_valid_to: input.validTo,
		p_guest_name: input.guestName ?? null,
		p_valid_from: input.validFrom ?? null,
		p_stay_id: input.stayId ?? null
	});
	if (error) throw error;
	// 発行 RPC は id/token/short_code/room_code/guest_name/valid_from/valid_to を返す
	return mapStayTokenRow(data as StayTokenRow, facilityUuid);
}

/** store.revokeStayToken 相当。冪等。監査記帳は RPC 側 */
export async function sbRevokeStayToken(client: SupabaseClient, tokenId: string): Promise<void> {
	const { error } = await client.schema('book').rpc('revoke_stay_token', { p_token_id: tokenId });
	if (error) throw error;
}

/** store.listStayTokens 相当。既定は有効のみ・include_inactive で全件。新しい順は RPC 側 */
export async function sbListStayTokens(
	client: SupabaseClient,
	facilityId: string,
	includeInactive = false
): Promise<StayToken[]> {
	const facilityUuid = toFacilityUuid(facilityId);
	const { data, error } = await client.schema('book').rpc('list_stay_tokens', {
		p_facility: facilityUuid,
		p_include_inactive: includeInactive
	});
	if (error) throw error;
	return ((data ?? []) as StayTokenRow[]).map((r) => mapStayTokenRow(r, facilityUuid));
}

/** store.upsertHouseGuide 相当。返り値は uuid（house_guide_upsert の戻り） */
export async function sbUpsertHouseGuide(
	client: SupabaseClient,
	input: {
		id?: string;
		facilityId: string;
		section: string;
		title: string;
		body: string;
		lang: string;
		sortOrder: number;
		isPublished: boolean;
	}
): Promise<string> {
	const { data, error } = await client.schema('book').rpc('house_guide_upsert', {
		p_facility: toFacilityUuid(input.facilityId),
		p_section: input.section,
		p_title: input.title,
		p_body: input.body,
		p_lang: input.lang,
		p_sort_order: input.sortOrder,
		p_is_published: input.isPublished,
		p_id: input.id ?? null
	});
	if (error) throw error;
	return data as string;
}

/** store.deleteHouseGuide 相当 */
export async function sbDeleteHouseGuide(client: SupabaseClient, id: string): Promise<void> {
	const { error } = await client.schema('book').rpc('house_guide_delete', { p_id: id });
	if (error) throw error;
}
