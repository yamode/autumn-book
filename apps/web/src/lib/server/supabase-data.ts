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
	Locale,
	Photo,
	AccessInfo,
	PaymentConfig,
	Facility,
	RoomType,
	RatePlan,
	Faq,
	FacilityAvailability,
	OptionItem,
	OptionCategory,
	BookingOptionOrder,
	BookingAmendment,
	AmendmentKind,
	AmendQuote,
	AmendParams,
	RankCancelPolicy,
	CancelFeePreview
} from '$lib/types';
import type { Quote, CancellationPolicy, CancellationRule } from '@autumn-book/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Cookies } from '@sveltejs/kit';

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
	adults: number,
	client?: SupabaseClient
): Promise<{ hold_id: string; expires_at: string; quote: Quote } | { error: 'sold_out' | string }> {
	// 会員は authenticated client（member_user_id を記録）、ゲストは anon `supa()`。
	const params = {
		p_session_id: sessionId,
		p_rate_plan_id: ratePlanId,
		p_room_type_id: roomTypeId,
		p_checkin: checkin,
		p_nights: nights,
		p_adults: adults
	};
	const { data, error } = client
		? await client.schema('book').rpc('create_hold', params)
		: await supa().rpc('create_hold', params);
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

/** book.get_hold の結果を予約フロー（+page.server.ts / .svelte）が使う camelCase 形へ整形。
 *  本人以外・不在は RPC が null を返す → null に正規化。expiresAt はミリ秒（HoldTimer 用）。 */
export interface SbHold {
	id: string;
	facilityId: string;
	roomTypeId: string;
	planId: string;
	checkin: string;
	nights: number;
	adults: number;
	quote: Quote;
	expiresAt: number;
	status: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function sbGetHoldMapped(
	holdId: string,
	sessionId: string,
	client?: SupabaseClient
): Promise<SbHold | null> {
	// UUID 形でない id（手入力・URL いじり等）は get_hold（p_hold_id uuid）が 22P02 で失敗するため、
	// RPC を叩かず「期限切れ/不在」として null を返す（デモの getHold が unknown を undefined 扱いするのと対称）。
	if (!UUID_RE.test(holdId)) return null;
	const params = { p_hold_id: holdId, p_session_id: sessionId };
	const { data, error } = client
		? await client.schema('book').rpc('get_hold', params)
		: await supa().rpc('get_hold', params);
	if (error) throw error;
	if (!data) return null;
	const r = data as {
		hold_id: string;
		facility_id: string;
		room_type_id: string;
		rate_plan_id: string;
		checkin_date: string;
		checkout_date: string;
		adult_count: number;
		quote: Parameters<typeof mapQuote>[0];
		expires_at: string;
		status: string;
	};
	return {
		id: r.hold_id,
		facilityId: r.facility_id,
		roomTypeId: r.room_type_id,
		planId: r.rate_plan_id,
		checkin: r.checkin_date,
		nights: daysBetween(r.checkin_date, r.checkout_date),
		adults: r.adult_count,
		quote: mapQuote(r.quote),
		expiresAt: Date.parse(r.expires_at),
		status: r.status
	};
}

export async function confirmBooking(
	holdId: string,
	sessionId: string,
	guest: GuestInfo,
	opts: { client?: SupabaseClient; pointsUsed?: number; locale?: string; memberCouponId?: string | null } = {}
): Promise<{ booking_code: string; total: number; points_used: number; points_earned: number; discount?: number } | { error: string }> {
	// 会員（ポイント利用・クーポン）は authenticated client、ゲストは anon `supa()`。
	// 会員のロケール（p_locale）・クーポン（p_member_coupon_id）は任意。
	const params = {
		p_hold_id: holdId,
		p_session_id: sessionId,
		p_guest: guest,
		p_points_used: opts.pointsUsed ?? 0,
		p_locale: opts.locale ?? 'ja',
		p_member_coupon_id: opts.memberCouponId ?? null
	};
	const { data, error } = opts.client
		? await opts.client.schema('book').rpc('confirm_booking', params)
		: await supa().rpc('confirm_booking', params);
	if (error) {
		if (error.message.includes('hold_expired')) return { error: 'hold_expired' };
		if (error.message.includes('forbidden')) return { error: 'forbidden' };
		if (error.message.includes('invalid_guest')) return { error: 'invalid_guest' };
		if (error.message.includes('coupon_invalid')) return { error: 'coupon_invalid' };
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
	avatar_url: string | null;
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
		avatarUrl: p.is_deleted ? null : (p.avatar_url ?? null),
		isStaff: p.is_staff,
		isOwn: p.is_own
	}));
}

// 書き込み系（authenticated・Supabase Auth 本接続後に有効。Phase 2）
// 認証済みユーザーの cookie に紐づく client（createSupabaseServerClient(event)）を渡すこと。
// anon supa() では auth.uid() が null になり not_authenticated / no_nickname になる。
// RPC は失敗時に raw な例外メッセージ（nickname_taken / banned / board_archived …）を throw する。
// 呼び出し側（route）で error.message を見て i18n メッセージにマッピングする。

export async function setForumNickname(
	client: SupabaseClient,
	nickname: string
): Promise<{ user_id: string; nickname: string }> {
	const { data, error } = await client.schema('book').rpc('forum_set_nickname', { p_nickname: nickname });
	if (error) throw error;
	return data as { user_id: string; nickname: string };
}

/** 自分の現ニックネーム（未設定は空文字）。設定画面のプリフィル用。 */
export async function getForumNickname(client: SupabaseClient): Promise<string> {
	const { data, error } = await client.schema('book').rpc('forum_my_nickname');
	if (error) throw error;
	return (data as string | null) ?? '';
}

export async function createForumThread(
	client: SupabaseClient,
	boardSlug: string,
	title: string,
	body: string
): Promise<{ thread_id: string }> {
	const { data, error } = await client.schema('book').rpc('forum_create_thread', {
		p_board_slug: boardSlug,
		p_title: title,
		p_body: body
	});
	if (error) throw error;
	return data as { thread_id: string };
}

export async function createForumPost(
	client: SupabaseClient,
	threadId: string,
	body: string
): Promise<{ post_id: string; post_no: number }> {
	const { data, error } = await client.schema('book').rpc('forum_create_post', {
		p_thread_id: threadId,
		p_body: body
	});
	if (error) throw error;
	return data as { post_id: string; post_no: number };
}

export async function deleteOwnForumPost(client: SupabaseClient, postId: string): Promise<{ post_id: string }> {
	const { data, error } = await client.schema('book').rpc('forum_delete_own_post', { p_post_id: postId });
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

// 自分のおたよりサマリ（残高 + 台帳 + 投稿一覧）。auth.uid() の分のみ。認証済み client を渡すこと。
export async function getOtayoriMySummary(client: SupabaseClient): Promise<OtayoriMySummaryRow> {
	const { data, error } = await client.schema('book').rpc('otayori_my_summary');
	if (error) throw error;
	return data as OtayoriMySummaryRow;
}

// おたより投稿（申請）。会員必須・本文 1〜2000字・ラジオネーム ≤40字・pending は5件まで。
// status='pending' で INSERT（ポイントは付与しない）。認証済み client を渡すこと（auth.uid() 必須）。
export async function submitOtayori(
	client: SupabaseClient,
	body: string,
	radioName?: string
): Promise<{ post_id: string }> {
	const { data, error } = await client.schema('book').rpc('otayori_submit', {
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

// ================================================================ 会員系（authenticated・Phase 2）
// マイページ（プロフィール・ポイント・予約・お気に入り）。すべて Supabase Auth セッションに
// 紐づく client（auth.ts の createSupabaseServerClient(event)）を渡すこと。anon supa() を渡すと
// RLS/GRANT で 0件 / permission denied / not_authenticated になる。
// book スキーマは yamado-one（モバイル会員アプリ）と共有。会員行の作成は必ず register_member
// RPC 経由（テーブル直 insert 禁止）。members の UPDATE は列レベル GRANT のため update_my_profile
// RPC 経由でのみ氏名/カナ/電話/locale/メルマガ同意を更新する。

// 実 UUID（core.facilities.id）→ store のデモ施設 ID（'f-nishiwaga' 等）の逆引き。
// 施設マスタ（名称・写真・スラッグ）は store 側が正で、予約/お気に入りの UUID を表示に橋渡しする。
const FACILITY_ID_BY_UUID: Record<string, string> = Object.fromEntries(
	Object.entries(FACILITY_UUID).map(([storeId, uuid]) => [uuid, storeId])
);

/** core.facilities.id（UUID）→ store の施設 ID。未知の UUID は undefined。 */
export function reverseFacilityUuid(uuid: string): string | undefined {
	return FACILITY_ID_BY_UUID[uuid];
}

/** store の施設 ID → 実 UUID（お気に入り書き込み用）。既に UUID ならそのまま。 */
export function toFacilityUuidStrict(facilityId: string): string {
	return FACILITY_UUID[facilityId] ?? facilityId;
}

// ---- プロフィール（book.my_profile / book.update_my_profile / book.register_member）----

export interface MemberProfile {
	userId: string;
	memberCode: string;
	rankCode: 'standard' | 'silver' | 'gold' | 'platinum';
	locale: Locale;
	isMailOptIn: boolean;
	joinedAt: string;
	name: string;
	kana: string;
	familyName: string;
	givenName: string;
	middleName: string;
	familyNameKana: string;
	givenNameKana: string;
	phone: string;
	email: string;
	avatarUrl: string | null;
}

interface MyProfileRow {
	user_id: string;
	member_code: string;
	rank_code: string;
	locale: string;
	is_mail_opt_in: boolean;
	joined_at: string;
	name: string | null;
	kana: string | null;
	family_name: string | null;
	given_name: string | null;
	middle_name: string | null;
	family_name_kana: string | null;
	given_name_kana: string | null;
	phone: string | null;
	email: string | null;
	avatar_url: string | null;
}

/** store.memberById 相当。会員本人のプロフィール（members + guests を1回で）。未登録は not_member 例外。 */
export async function sbMyProfile(client: SupabaseClient): Promise<MemberProfile> {
	const { data, error } = await client.schema('book').rpc('my_profile');
	if (error) throw error;
	const r = data as MyProfileRow;
	return {
		userId: r.user_id,
		memberCode: r.member_code,
		rankCode: (r.rank_code as MemberProfile['rankCode']) ?? 'standard',
		locale: (r.locale as Locale) ?? 'ja',
		isMailOptIn: r.is_mail_opt_in,
		joinedAt: (r.joined_at ?? '').slice(0, 10),
		name: r.name ?? '',
		kana: r.kana ?? '',
		familyName: r.family_name ?? '',
		givenName: r.given_name ?? '',
		middleName: r.middle_name ?? '',
		familyNameKana: r.family_name_kana ?? '',
		givenNameKana: r.given_name_kana ?? '',
		phone: r.phone ?? '',
		email: r.email ?? '',
		avatarUrl: r.avatar_url ?? null
	};
}

/** 会員本人の氏名/カナ/電話/locale/メルマガ同意を更新（RPC 経由・列レベル GRANT を尊重）。 */
export async function sbUpdateMyProfile(
	client: SupabaseClient,
	input: {
		name: string;
		kana?: string;
		phone?: string;
		locale?: string;
		mailOptIn?: boolean;
		familyName?: string;
		givenName?: string;
		middleName?: string;
		familyNameKana?: string;
		givenNameKana?: string;
	}
): Promise<void> {
	const { error } = await client.schema('book').rpc('update_my_profile', {
		p_name: input.name,
		p_kana: input.kana ?? null,
		p_phone: input.phone ?? null,
		p_locale: input.locale ?? null,
		p_mail_opt_in: input.mailOptIn ?? null,
		p_family_name: input.familyName ?? null,
		p_given_name: input.givenName ?? null,
		p_middle_name: input.middleName ?? null,
		p_family_name_kana: input.familyNameKana ?? null,
		p_given_name_kana: input.givenNameKana ?? null
	});
	if (error) throw error;
}

/** アバターURLを更新（book.set_my_avatar・null で解除）。 */
export async function sbSetMyAvatar(client: SupabaseClient, url: string | null): Promise<void> {
	const { error } = await client.schema('book').rpc('set_my_avatar', { p_url: url });
	if (error) throw error;
}

/** アバター画像を Storage 'avatars' の本人フォルダへアップロードし、公開URLを book.members に保存。 */
export async function sbUploadAvatar(client: SupabaseClient, userId: string, file: File): Promise<string> {
	const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
	const path = `${userId}/avatar.${ext}`;
	const { error } = await client.storage.from('avatars').upload(path, file, {
		upsert: true,
		contentType: file.type || 'image/jpeg'
	});
	if (error) throw error;
	const { data } = client.storage.from('avatars').getPublicUrl(path);
	// キャッシュバスター（同一パス upsert のため）
	const url = `${data.publicUrl}?v=${Date.now()}`;
	await sbSetMyAvatar(client, url);
	return url;
}

/** 退会（論理削除）。book.withdraw_member RPC が withdrawn_at をマークする（データは保持）。
 *  以後 my_profile は not_member を返すため、呼び出し側で updateUser({member:false}) と signOut を行う。 */
export async function sbWithdrawMember(client: SupabaseClient): Promise<void> {
	const { error } = await client.schema('book').rpc('withdraw_member');
	if (error) throw error;
}

/** 会員登録（OTP サインイン後に呼ぶ）。member_code 採番・email 名寄せ・入会500pt は RPC が一元処理。
 *  既存会員は already_registered 例外。 */
export async function sbRegisterMember(
	client: SupabaseClient,
	input: {
		name: string;
		kana: string;
		phone?: string;
		mailOptIn: boolean;
		locale?: string;
		familyName?: string;
		givenName?: string;
		middleName?: string;
		familyNameKana?: string;
		givenNameKana?: string;
	}
): Promise<{ member_code: string; guest_id: string }> {
	const { data, error } = await client.schema('book').rpc('register_member', {
		p_name: input.name,
		p_kana: input.kana,
		p_phone: input.phone ?? null,
		p_mail_opt_in: input.mailOptIn,
		p_locale: input.locale ?? 'ja',
		p_family_name: input.familyName ?? null,
		p_given_name: input.givenName ?? null,
		p_middle_name: input.middleName ?? null,
		p_family_name_kana: input.familyNameKana ?? null,
		p_given_name_kana: input.givenNameKana ?? null
	});
	if (error) throw error;
	return data as { member_code: string; guest_id: string };
}

// ---- ポイント（book.point_balance / book.point_ledger）----

/** store.pointBalance 相当。残高＝SUM(delta)。自分の分のみ（RLS）。 */
export async function sbPointBalance(client: SupabaseClient): Promise<number> {
	const { data, error } = await client.schema('book').rpc('point_balance', { p_user: null });
	if (error) throw error;
	return (data ?? 0) as number;
}

export interface MemberPointEntry {
	id: string;
	delta: number;
	reason: string;
	bookingId?: string;
	expiresAt?: string;
	createdAt: string;
}

/** store.pointLedger（自分の分）相当。新しい順。RLS で member_user_id = auth.uid() の行のみ。 */
export async function sbPointLedger(client: SupabaseClient): Promise<MemberPointEntry[]> {
	const { data, error } = await client
		.schema('book')
		.from('point_ledger')
		.select('id, delta, reason, booking_id, expires_at, created_at')
		.order('created_at', { ascending: false });
	if (error) throw error;
	return ((data ?? []) as {
		id: string;
		delta: number;
		reason: string;
		booking_id: string | null;
		expires_at: string | null;
		created_at: string;
	}[]).map((r) => ({
		id: r.id,
		delta: r.delta,
		reason: r.reason,
		bookingId: r.booking_id ?? undefined,
		expiresAt: r.expires_at ?? undefined,
		createdAt: (r.created_at ?? '').slice(0, 10)
	}));
}

/** 有効期限が withinDays 日以内に迫っている加算ポイントの合計（デモ store.expiringPoints 相当）。 */
export function sumExpiringPoints(ledger: MemberPointEntry[], withinDays = 30): number {
	const limit = new Date(Date.now() + withinDays * 86400000).toISOString().slice(0, 10);
	const today = new Date().toISOString().slice(0, 10);
	return ledger
		.filter((e) => e.delta > 0 && e.expiresAt && e.expiresAt >= today && e.expiresAt <= limit)
		.reduce((s, e) => s + e.delta, 0);
}

// ---- 予約（book.my_reservations / book.cancel_booking）----

interface MyReservationRow {
	booking_code: string;
	facility_id: string;
	room_type_id: string;
	rate_plan_id: string;
	check_in_date: string;
	check_out_date: string;
	adult_count: number;
	stay_status: string;
	booking_status: string;
	payment_status: string;
	total_amount: number;
	cancellation_fee: number | null;
	cancellation_policy: CancellationPolicy | null;
	points_used: number;
	points_earned: number;
	guest: GuestInfo | null;
	created_at: string;
}

export interface MemberReservation {
	code: string;
	facilityUuid: string;
	roomTypeUuid: string;
	ratePlanUuid: string;
	checkin: string;
	checkout: string;
	nights: number;
	adults: number;
	status: 'reserved' | 'cancelled' | 'stayed';
	paymentStatus: 'unpaid' | 'paid' | 'refunded' | 'partial_refund';
	payment: 'onsite' | 'card';
	total: number;
	cancelFee?: number;
	cancellationPolicy: CancellationPolicy;
	pointsUsed: number;
	pointsEarned: number;
	guest: GuestInfo;
	channel: 'autumn_booking';
	createdAt: string;
}

function daysBetween(from: string, to: string): number {
	const a = Date.parse(from + 'T00:00:00Z');
	const b = Date.parse(to + 'T00:00:00Z');
	if (Number.isNaN(a) || Number.isNaN(b)) return 1;
	return Math.max(1, Math.round((b - a) / 86400000));
}

function reservationStatus(stayStatus: string, bookingStatus: string): MemberReservation['status'] {
	if (bookingStatus === 'cancelled' || stayStatus === 'cancelled' || stayStatus === 'no_show') return 'cancelled';
	if (stayStatus === 'checked_out' || stayStatus === 'stayed' || stayStatus === 'departed') return 'stayed';
	return 'reserved';
}

function mapReservationRow(r: MyReservationRow): MemberReservation {
	const paymentStatus: MemberReservation['paymentStatus'] =
		r.payment_status === 'paid'
			? 'paid'
			: r.payment_status === 'refunded'
				? 'refunded'
				: r.payment_status === 'partial_refund'
					? 'partial_refund'
					: 'unpaid';
	return {
		code: r.booking_code,
		facilityUuid: r.facility_id,
		roomTypeUuid: r.room_type_id,
		ratePlanUuid: r.rate_plan_id,
		checkin: r.check_in_date,
		checkout: r.check_out_date,
		nights: daysBetween(r.check_in_date, r.check_out_date),
		adults: r.adult_count,
		status: reservationStatus(r.stay_status, r.booking_status),
		paymentStatus,
		payment: paymentStatus === 'paid' || paymentStatus === 'refunded' || paymentStatus === 'partial_refund' ? 'card' : 'onsite',
		total: r.total_amount,
		cancelFee: r.cancellation_fee ?? undefined,
		cancellationPolicy: normalizeCancellationPolicy(r.cancellation_policy),
		pointsUsed: r.points_used ?? 0,
		pointsEarned: r.points_earned ?? 0,
		guest: r.guest ?? { name: '', kana: '', phone: '', email: '' },
		channel: 'autumn_booking',
		createdAt: (r.created_at ?? '').slice(0, 10)
	};
}

/** store.myReservations 相当。会員本人（guest_id 連結）の予約一覧。check_in 降順は RPC 側。 */
export async function sbMyReservations(client: SupabaseClient): Promise<MemberReservation[]> {
	const { data, error } = await client.schema('book').rpc('my_reservations');
	if (error) throw error;
	return ((data ?? []) as MyReservationRow[]).map(mapReservationRow);
}

/** 会員本人によるキャンセル（キャンセル料はグレード別規定どおり・免除不可）。cancel_booking RPC。
 *  戻り値に rank_benefit（適用したグレード規定の内訳・P3）を含む。 */
export async function sbCancelBookingAsMember(
	client: SupabaseClient,
	bookingCode: string
): Promise<{ booking_code: string; cancellation_fee: number; rank_benefit: unknown }> {
	const { data, error } = await client.schema('book').rpc('cancel_booking', {
		p_booking_code: bookingCode,
		p_waive_fee: false,
		p_reason: null
	});
	if (error) throw error;
	return data as { booking_code: string; cancellation_fee: number; rank_benefit: unknown };
}

// ---------------------------------------------------------------- グレード別キャンセル料規定（P3・設計書 §3.3 / §4.3）
// book.compute_cancel_fee（本人 or スタッフ・プレビュー）と book.rank_cancel_policies（公開 read）の薄いアダプタ。
// 料率 = プラン規定 snapshot 非空 → プラン規定、空 → 予約作成会員 rank のルール表 → standard（SQL と同式）。

interface ComputeCancelFeeRow {
	rules_source: string;
	rank_code: string;
	rate: number;
	fee: number;
	total_amount: number;
	check_in_date: string;
}

/** store.computeCancelFee 相当。compute_cancel_fee RPC を叩き、適用ルール表を除く結果を返す。
 *  表示用の rules は呼び出し側で（plan なら予約 snapshot、rank なら sbListRankCancelPolicies から）補う。 */
export async function sbComputeCancelFee(
	client: SupabaseClient,
	code: string,
	asOf?: string
): Promise<Omit<CancelFeePreview, 'rules'>> {
	const args: { p_booking_code: string; p_as_of?: string } = { p_booking_code: code };
	if (asOf) args.p_as_of = asOf;
	const { data, error } = await client.schema('book').rpc('compute_cancel_fee', args);
	if (error) throw error;
	const r = data as ComputeCancelFeeRow;
	return {
		rulesSource: r.rules_source === 'plan' ? 'plan' : 'rank',
		rankCode: r.rank_code,
		rate: r.rate,
		fee: r.fee,
		totalAmount: r.total_amount,
		checkInDate: r.check_in_date
	};
}

interface RankCancelPolicyRow {
	rank_code: string;
	rules: unknown;
	allow_amend_in_penalty: boolean;
	note: string | null;
}

/** rules jsonb（bare 配列 or {rules:[...]}）を CancellationRule[] へ正規化。 */
function normalizeRules(raw: unknown): CancellationRule[] {
	const arr = Array.isArray(raw)
		? raw
		: raw && typeof raw === 'object' && Array.isArray((raw as { rules?: unknown }).rules)
			? (raw as { rules: unknown[] }).rules
			: [];
	return (arr as Record<string, unknown>[])
		.filter((r) => r && typeof r === 'object')
		.map((r) => ({ days_before: Number(r.days_before ?? 0), rate: Number(r.rate ?? 0) }));
}

/** store.listRankCancelPolicies 相当。全グレードのキャンセル規定（公開 read・anon）。
 *  /membership の規定表示に使う。書込みは service_role のみ（admin は demo 運用）。 */
export async function sbListRankCancelPolicies(): Promise<RankCancelPolicy[]> {
	const { data, error } = await supa()
		.from('rank_cancel_policies')
		.select('rank_code, rules, allow_amend_in_penalty, note');
	if (error) throw error;
	return ((data ?? []) as RankCancelPolicyRow[]).map((r) => ({
		rankCode: r.rank_code as RankCancelPolicy['rankCode'],
		rules: normalizeRules(r.rules),
		allowAmendInPenalty: r.allow_amend_in_penalty,
		note: r.note ?? undefined
	}));
}

// ---------------------------------------------------------------- オプション（滞在アレンジ・P1・設計書 §4.2）
// book.option_items / booking_option_orders の RPC 5本を叩く薄いアダプタ。store.ts（demo）と同じ意味論・
// 同じ camelCase 型（OptionItem / BookingOptionOrder）を返す。会計は宿泊料金と分離（現地精算）。
//  ・カタログ（list_option_items）は anon `supa()` で動作（is_active のみ）。
//  ・会員操作（add/cancel/list_my）は authenticated client（本人・auth.uid()）を渡す。
//  ・当日提供リスト（list_booking_options_admin）は staff（facility_access）。

const OPTION_CATEGORIES: OptionCategory[] = ['meal', 'spa', 'activity', 'amenity', 'personalize', 'other'];
function safeCategory(raw: unknown): OptionCategory {
	return OPTION_CATEGORIES.includes(raw as OptionCategory) ? (raw as OptionCategory) : 'other';
}

interface OptionItemRow {
	id: string;
	code: string;
	name: string;
	description: string | null;
	category: string;
	price_type: string;
	unit_price: number;
	lead_time_hours: number;
	stock_type: string;
	daily_capacity: number | null;
	requires_service_date: boolean;
	member_only: boolean;
	photos: unknown;
	sort_order: number;
}

function mapOptionItemRow(r: OptionItemRow): OptionItem {
	return {
		id: r.id,
		code: r.code,
		name: r.name,
		description: r.description ?? '',
		category: safeCategory(r.category),
		priceType: (r.price_type as OptionItem['priceType']) ?? 'per_stay',
		unitPrice: r.unit_price,
		leadTimeHours: r.lead_time_hours,
		stockType: r.stock_type === 'per_day' ? 'per_day' : 'none',
		dailyCapacity: r.daily_capacity ?? undefined,
		requiresServiceDate: r.requires_service_date,
		memberOnly: r.member_only,
		photos: mapPhotos(r.photos, r.name),
		sortOrder: r.sort_order
	};
}

/** store.listOptionItems 相当。施設の公開オプション（anon 可・is_active のみ）。
 *  i18n: RPC は ja ベースを返すため、content_translations（entity_type='option'・is_published）を
 *  app 層で引いて name/description を部分上書きする（facility/plan 翻訳マージと同じ §2.2 規約）。 */
export async function sbListOptionItems(facilityUuid: string, locale: Locale = 'ja'): Promise<OptionItem[]> {
	const { data, error } = await supa().rpc('list_option_items', { p_facility: toFacilityUuidStrict(facilityUuid) });
	if (error) throw error;
	const items = ((data ?? []) as OptionItemRow[]).map(mapOptionItemRow);
	if (locale === 'ja' || items.length === 0) return items;

	const { data: tr } = await supa()
		.from('content_translations')
		.select('entity_id, fields')
		.eq('entity_type', 'option')
		.eq('locale', locale)
		.eq('is_published', true)
		.in('entity_id', items.map((o) => o.id));
	if (!tr || tr.length === 0) return items;

	const byId = new Map((tr as { entity_id: string; fields: Record<string, unknown> }[]).map((t) => [t.entity_id, t.fields]));
	return items.map((o) => {
		const fields = byId.get(o.id);
		if (!fields) return o;
		const name = fields.name;
		const description = fields.description;
		return {
			...o,
			name: typeof name === 'string' && name !== '' ? name : o.name,
			description: typeof description === 'string' && description !== '' ? description : o.description
		};
	});
}

/** store.addBookingOptions 相当。会員が自分の予約へオプションを追加（現地精算）。締切/在庫/本人検証は RPC 側。
 *  items: [{ optionId, serviceDate, quantity, note }]。RPC の例外（past_deadline 等）はそのまま throw。 */
export async function sbAddBookingOptions(
	client: SupabaseClient,
	code: string,
	items: { optionId: string; serviceDate?: string | null; quantity: number; note?: string }[]
): Promise<{ total_added: number }> {
	const { data, error } = await client.schema('book').rpc('add_booking_options', {
		p_booking_code: code,
		p_items: items.map((i) => ({
			option_id: i.optionId,
			service_date: i.serviceDate ?? null,
			quantity: i.quantity,
			note: i.note ?? null
		}))
	});
	if (error) throw error;
	return data as { total_added: number };
}

/** store.cancelBookingOption 相当。本人・提供日前日まで（RPC 側検証）。 */
export async function sbCancelBookingOption(client: SupabaseClient, orderId: string): Promise<void> {
	const { error } = await client.schema('book').rpc('cancel_booking_option', { p_order_id: orderId });
	if (error) throw error;
}

interface MyBookingOptionRow {
	order_id: string;
	option_id: string;
	name: string;
	category: string;
	service_date: string | null;
	quantity: number;
	unit_price: number;
	amount: number;
	status: BookingOptionOrder['status'];
	note: string | null;
	requires_service_date: boolean;
	created_at: string;
}

/** store.listMyBookingOptions 相当。本人・cancelled 以外を作成順で返す。
 *  注: 明細名（name）は RPC が返す ja ベースのまま（翻訳マージはカタログ画面のみ・§7）。 */
export async function sbListMyBookingOptions(client: SupabaseClient, code: string): Promise<BookingOptionOrder[]> {
	const { data, error } = await client.schema('book').rpc('list_my_booking_options', { p_booking_code: code });
	if (error) throw error;
	return ((data ?? []) as MyBookingOptionRow[]).map((r) => ({
		orderId: r.order_id,
		optionId: r.option_id,
		name: r.name,
		category: safeCategory(r.category),
		serviceDate: r.service_date ?? undefined,
		quantity: r.quantity,
		unitPrice: r.unit_price,
		amount: r.amount,
		status: r.status,
		note: r.note ?? undefined,
		requiresServiceDate: r.requires_service_date,
		createdAt: r.created_at
	}));
}

export interface AdminBookingOptionRow {
	orderId: string;
	bookingCode: string;
	guestName: string;
	optionName: string;
	category: OptionCategory;
	serviceDate?: string;
	quantity: number;
	amount: number;
	status: BookingOptionOrder['status'];
	note?: string;
}

/** 当日提供リスト（スタッフ・自施設）。list_booking_options_admin。
 *  現状デッドコード: /admin は AUTH_MODE=supabase 前まで demo（store）運用のため未接続。
 *  AUTH_MODE=supabase 後に admin/options のロードから接続する（news/faqs 管理系と同じ段階）。 */
export async function sbListBookingOptionsAdmin(
	client: SupabaseClient,
	facilityUuid: string,
	date: string
): Promise<AdminBookingOptionRow[]> {
	const { data, error } = await client.schema('book').rpc('list_booking_options_admin', {
		p_facility: toFacilityUuidStrict(facilityUuid),
		p_date: date
	});
	if (error) throw error;
	return ((data ?? []) as {
		order_id: string;
		booking_code: string;
		guest_name: string | null;
		option_name: string;
		category: string;
		service_date: string | null;
		quantity: number;
		amount: number;
		status: BookingOptionOrder['status'];
		note: string | null;
	}[]).map((r) => ({
		orderId: r.order_id,
		bookingCode: r.booking_code,
		guestName: r.guest_name ?? '',
		optionName: r.option_name,
		category: safeCategory(r.category),
		serviceDate: r.service_date ?? undefined,
		quantity: r.quantity,
		amount: r.amount,
		status: r.status,
		note: r.note ?? undefined
	}));
}

// ---------------------------------------------------------------- 予約変更（P2・設計書 §4.1）
// book.quote_amendment / amend_booking / list_my_amendments の薄いアダプタ。
// 6 引数（rate_plan_id, room_type_id, checkin, nights, adults）を厳密に渡す（変更なしでも現値を渡す）。
// RPC の例外（past_deadline / amend_limit / no_change / amend_in_penalty / sold_out …）は
// そのまま throw し、呼び出し側（+page.server.ts）で i18n 文言へマッピングする。

/** quote_amendment / _amend_compute の jsonb（snake_case）→ AmendQuote（camelCase）。 */
function mapAmendQuote(raw: Record<string, unknown>): AmendQuote {
	const q = (raw.quote ?? {}) as Record<string, unknown>;
	const total = Number(q.total ?? raw.new_total ?? 0);
	const quote: Quote = {
		lines: [],
		total,
		perPerson: Number(q.per_person ?? 0),
		taxIncluded: Number(q.tax_included ?? 0),
		pointsUsed: 0,
		payable: total
	};
	return {
		ok: Boolean(raw.ok),
		amendable: Boolean(raw.amendable),
		amendRemaining: Number(raw.amend_remaining ?? 0),
		kind: (raw.kind as AmendmentKind) ?? 'none',
		isNoop: Boolean(raw.is_noop),
		deadlineAt: String(raw.deadline_at ?? ''),
		pastDeadline: Boolean(raw.past_deadline),
		oldCharge: Number(raw.old_charge ?? 0),
		newTotal: Number(raw.new_total ?? 0),
		newCharge: Number(raw.new_charge ?? 0),
		diff: Number(raw.diff ?? 0),
		pointsRefund: Number(raw.points_refund ?? 0),
		newPointsUsed: Number(raw.new_points_used ?? 0),
		newDiscount: Number(raw.new_discount ?? 0),
		inPenalty: Boolean(raw.in_penalty),
		dateChanged: Boolean(raw.date_changed),
		planChanged: Boolean(raw.plan_changed),
		quote
	};
}

/** store.quoteAmendment 相当。変更見積（読み取り専用・本人）。RPC 例外はそのまま throw。 */
export async function sbQuoteAmendment(
	client: SupabaseClient,
	code: string,
	p: AmendParams
): Promise<AmendQuote> {
	const { data, error } = await client.schema('book').rpc('quote_amendment', {
		p_booking_code: code,
		p_rate_plan_id: p.ratePlanId,
		p_room_type_id: p.roomTypeId,
		p_checkin: p.checkin,
		p_nights: p.nights,
		p_adults: p.adults
	});
	if (error) throw error;
	return mapAmendQuote(data as Record<string, unknown>);
}

export interface AmendResult {
	booking_code: string;
	amendment_no: number;
	diff: number;
	new_total: number;
	points_refund: number;
	kind: AmendmentKind;
}

/** store.amendBooking 相当。変更確定（単一Tx・本人）。RPC 例外はそのまま throw。 */
export async function sbAmendBooking(
	client: SupabaseClient,
	code: string,
	p: AmendParams
): Promise<AmendResult> {
	const { data, error } = await client.schema('book').rpc('amend_booking', {
		p_booking_code: code,
		p_rate_plan_id: p.ratePlanId,
		p_room_type_id: p.roomTypeId,
		p_checkin: p.checkin,
		p_nights: p.nights,
		p_adults: p.adults
	});
	if (error) throw error;
	return data as AmendResult;
}

interface AmendmentRow {
	amendment_no: number;
	kind: string;
	price_before: number;
	price_after: number;
	diff_amount: number;
	points_refund: number;
	created_at: string;
}

const AMEND_KINDS: AmendmentKind[] = ['none', 'dates', 'party', 'room', 'plan', 'composite'];
function safeAmendKind(raw: unknown): AmendmentKind {
	return AMEND_KINDS.includes(raw as AmendmentKind) ? (raw as AmendmentKind) : 'composite';
}

/** store.listMyAmendments 相当。本人の変更履歴（amendment_no 昇順は RPC 側）。 */
export async function sbListMyAmendments(client: SupabaseClient, code: string): Promise<BookingAmendment[]> {
	const { data, error } = await client.schema('book').rpc('list_my_amendments', { p_booking_code: code });
	if (error) throw error;
	return ((data ?? []) as AmendmentRow[]).map((r) => ({
		amendmentNo: r.amendment_no,
		kind: safeAmendKind(r.kind),
		priceBefore: r.price_before,
		priceAfter: r.price_after,
		diffAmount: r.diff_amount,
		pointsRefund: r.points_refund,
		createdAt: r.created_at
	}));
}

// ---- お気に入り（book.favorites テーブル・RLS member_user_id = auth.uid()）----

/** store.favoritesByMember 相当。お気に入り施設の UUID 一覧。 */
export async function sbListFavorites(client: SupabaseClient): Promise<string[]> {
	const { data, error } = await client.schema('book').from('favorites').select('facility_id');
	if (error) throw error;
	return ((data ?? []) as { facility_id: string }[]).map((r) => r.facility_id);
}

/** お気に入り追加（冪等・PK 重複は無視）。tenant_id は NOT NULL のため付与する。 */
export async function sbAddFavorite(
	client: SupabaseClient,
	memberUserId: string,
	facilityId: string
): Promise<void> {
	const { error } = await client
		.schema('book')
		.from('favorites')
		.insert({ member_user_id: memberUserId, facility_id: toFacilityUuidStrict(facilityId), tenant_id: TENANT_ID });
	// 23505 = unique_violation（既にお気に入り済み）は成功扱い
	if (error && error.code !== '23505') throw error;
}

/** お気に入り削除（自分の行のみ・RLS）。 */
export async function sbRemoveFavorite(
	client: SupabaseClient,
	memberUserId: string,
	facilityId: string
): Promise<void> {
	const { error } = await client
		.schema('book')
		.from('favorites')
		.delete()
		.eq('member_user_id', memberUserId)
		.eq('facility_id', toFacilityUuidStrict(facilityId));
	if (error) throw error;
}

// ---- お気に入り客室（book.favorite_rooms・RPC 経由。会員は pms.rooms を直接読めない）----

export interface FacilityRoomRow {
	roomId: string;
	roomNumber: string;
	name: string;
	roomTypeName: string;
}

/** 施設の個別客室一覧（book.facility_rooms・display_name＝部屋名）。 */
export async function sbFacilityRooms(client: SupabaseClient, facilityId: string): Promise<FacilityRoomRow[]> {
	const { data, error } = await client
		.schema('book')
		.rpc('facility_rooms', { p_facility_id: toFacilityUuidStrict(facilityId) });
	if (error) throw error;
	return ((data ?? []) as { room_id: string; room_number: string; display_name: string; room_type_name: string | null }[]).map(
		(r) => ({ roomId: r.room_id, roomNumber: r.room_number, name: r.display_name, roomTypeName: r.room_type_name ?? '' })
	);
}

/** 自分のお気に入り客室 ID 一覧。 */
export async function sbListFavoriteRooms(client: SupabaseClient): Promise<string[]> {
	const { data, error } = await client.schema('book').rpc('list_my_favorite_rooms');
	if (error) throw error;
	return ((data ?? []) as { room_id: string }[]).map((r) => r.room_id);
}

/** お気に入り客室のトグル（true=登録した / false=解除した）。 */
export async function sbToggleFavoriteRoom(client: SupabaseClient, roomId: string): Promise<boolean> {
	const { data, error } = await client.schema('book').rpc('toggle_favorite_room', { p_room_id: roomId });
	if (error) throw error;
	return Boolean(data);
}

// ================================================================ 公開予約導線（検索→施設→プラン→客室→hold→確定）
// DATA_SOURCE=supabase のとき、公開ページ（トップ／検索／施設HP／プラン／客室／予約フロー）が使う。
// ビュー（v_facilities / v_room_types / v_plans）と RPC（search_availability / reference_min_price /
// plan_offers / get_plan_calendar / quote / create_hold / get_hold / confirm_booking）を叩き、返り値を
// store.ts（デモ）と同じ camelCase 型（$lib/types）へ寄せる（+page.svelte を変えずに動かすため）。
// 実データはコンテンツ（写真・アクセス・設備）が未投入のことがあるため、UI が undefined 参照で落ちないよう
// 各マッパーは全フィールドを安全な既定値で埋める（施設写真は最低1枚のプレースホルダーを保証）。
// ゲスト（未ログイン）は anon `supa()`、会員（MEMBER_SUPABASE）は authenticated client を使い分ける。

/** 施設スラッグ→HPテンプレート。デモ（store.ts）の template 割当に合わせる（未知は standard）。 */
function templateForSlug(slug: string): Facility['template'] {
	if (slug === 'nishiwaga') return 'yamado-v1';
	if (slug === 'oga') return 'oga-v1';
	return 'standard';
}

/** 施設ヒーロー用のプレースホルダー写真（facility_photos 未投入時のフォールバック・最低1枚を保証）。 */
function placeholderPhotos(seed: string, caption: string): Photo[] {
	return [{ url: `https://picsum.photos/seed/${encodeURIComponent(seed)}/960/640`, caption, category: 'exterior' }];
}

const PHOTO_CATEGORIES: Photo['category'][] = ['exterior', 'room', 'bath', 'meal', 'view'];

/** jsonb photos 配列 → Photo[]（不正な category は 'exterior' に丸め、url 空要素は除外）。 */
function mapPhotos(raw: unknown, fallbackCaption: string): Photo[] {
	if (!Array.isArray(raw)) return [];
	return raw
		.map((p) => {
			const o = (p ?? {}) as Record<string, unknown>;
			const cat = o.category as Photo['category'];
			return {
				url: String(o.url ?? ''),
				caption: String(o.caption ?? fallbackCaption),
				category: PHOTO_CATEGORIES.includes(cat) ? cat : 'exterior'
			};
		})
		.filter((p) => p.url);
}

/** jsonb access（空 {} のことがある）→ AccessInfo 骨格（shuttle/parking を必ず持たせて undefined 参照を防ぐ）。 */
function safeAccess(raw: unknown): AccessInfo {
	const a = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
	const arr = (v: unknown) => (Array.isArray(v) ? v : []);
	const shuttle = (a.shuttle ?? {}) as Record<string, unknown>;
	const parking = (a.parking ?? {}) as Record<string, unknown>;
	return {
		car: arr(a.car) as AccessInfo['car'],
		train: arr(a.train) as AccessInfo['train'],
		air: arr(a.air) as AccessInfo['air'],
		shuttle: { available: !!shuttle.available, note: String(shuttle.note ?? '') },
		parking: { available: !!parking.available, capacity: Number(parking.capacity ?? 0), fee: String(parking.fee ?? '') }
	};
}

/** payment_method（onsite / prepayment / deposit）→ PaymentConfig。実データに事前決済割引は無いため rate=0。 */
function mapPaymentMethod(pm: string | null | undefined): PaymentConfig {
	switch (pm) {
		case 'prepayment':
			return { onsite: false, prepay: true, prepayMethods: ['card'], prepayDiscountRate: 0 };
		case 'deposit':
			return { onsite: true, prepay: true, prepayMethods: ['card'], prepayDiscountRate: 0 };
		case 'onsite':
		default:
			return { onsite: true, prepay: false, prepayMethods: [], prepayDiscountRate: 0 };
	}
}

/** v_facilities 行 → Facility。写真は facility_photos 未投入のためプレースホルダー（投入後はここで差し替える）。 */
export function mapFacilityRow(row: FacilityRow): Facility {
	return {
		id: row.facility_id,
		brandSlug: row.brand_slug ?? 'yamado',
		slug: row.slug,
		name: row.name,
		catchCopy: row.catch_copy ?? '',
		description: row.description ?? '',
		lat: Number(row.lat ?? 0),
		lng: Number(row.lng ?? 0),
		prefecture: row.prefecture ?? '',
		addressPublic: row.address_public ?? '',
		phone: row.phone ?? '',
		checkinTime: row.checkin_time ?? '15:00',
		checkoutTime: row.checkout_time ?? '10:00',
		amenities: Array.isArray(row.amenities) ? (row.amenities as string[]) : [],
		access: safeAccess(row.access),
		photos: placeholderPhotos(row.slug || row.facility_id, row.name),
		template: templateForSlug(row.slug),
		isPublished: true
	};
}

/** v_room_types 行 → RoomType（capacity は capacity_max・面積は area_sqm。photos は無ければ空でよい）。 */
export function mapRoomTypeRow(row: Record<string, unknown>): RoomType {
	return {
		id: String(row.room_type_id),
		facilityId: String(row.facility_id),
		slug: String(row.slug ?? ''),
		name: String(row.name ?? ''),
		headline: String(row.headline ?? ''),
		description: String(row.description ?? ''),
		capacity: Number(row.capacity_max ?? row.capacity_min ?? 2),
		sizeM2: Number(row.area_sqm ?? 0),
		totalRooms: 0, // 実在庫は booking.availability 側。表示未使用のため 0。
		amenities: Array.isArray(row.amenities) ? (row.amenities as string[]) : [],
		photos: mapPhotos(row.photos, String(row.name ?? ''))
	};
}

/** DB の cancellation_policy は「日数別料率の配列」（rms 同期は '[]' で作成）。
 *  アプリ型 CancellationPolicy は { rules, note } なので、配列はラップし、不正値は空ポリシーに正規化する。 */
export function normalizeCancellationPolicy(raw: unknown): CancellationPolicy {
	if (Array.isArray(raw)) return { rules: raw as CancellationPolicy['rules'], note: '' };
	if (raw && typeof raw === 'object' && Array.isArray((raw as CancellationPolicy).rules)) {
		return raw as CancellationPolicy;
	}
	return { rules: [], note: '' };
}

/** v_plans 行 → RatePlan。プラン⇄客室の関係は持たない（実データは plan_offers が返す・設計）。basePrice は 0。 */
export function mapPlanRow(row: Record<string, unknown>): RatePlan {
	const policy = normalizeCancellationPolicy(row.cancellation_policy);
	return {
		id: String(row.rate_plan_id),
		facilityId: String(row.facility_id),
		slug: String(row.slug ?? ''),
		name: String(row.name ?? ''),
		headline: String(row.headline ?? ''),
		description: String(row.description ?? ''),
		mealPlan: String(row.meal_plan ?? ''),
		payment: mapPaymentMethod(row.payment_method as string | null),
		basePrice: 0, // 参考額はビューに無い。実料金は daily_rates（plan_offers / quote）。
		highlightTags: Array.isArray(row.highlight_tags) ? (row.highlight_tags as string[]) : [],
		photos: mapPhotos(row.photos, String(row.name ?? '')),
		cancellationPolicy: policy,
		roomTypeIds: [],
		isPublished: true,
		sortOrder: Number(row.sort_order ?? 0)
	};
}

function mapFaqRow(row: Record<string, unknown>, facilityId: string): Faq {
	return {
		id: String(row.id),
		facilityId,
		category: String(row.category ?? ''),
		question: String(row.question ?? ''),
		answer: String(row.answer ?? ''),
		isPublished: true,
		sortOrder: Number(row.sort_order ?? 0)
	};
}

// ---- 施設・客室・プラン・FAQ・お知らせ（マッパー適用済み）----

export async function sbListFacilities(): Promise<Facility[]> {
	const rows = await listFacilities();
	return rows.map(mapFacilityRow);
}

export async function sbFacilityBySlug(slug: string): Promise<Facility | undefined> {
	const { data, error } = await supa().from('v_facilities').select('*').eq('slug', slug).maybeSingle();
	if (error) throw error;
	return data ? mapFacilityRow(data as FacilityRow) : undefined;
}

export async function sbFacilityByUuid(uuid: string): Promise<Facility | undefined> {
	const { data, error } = await supa().from('v_facilities').select('*').eq('facility_id', uuid).maybeSingle();
	if (error) throw error;
	return data ? mapFacilityRow(data as FacilityRow) : undefined;
}

export async function sbListRoomTypesMapped(facilityUuid: string): Promise<RoomType[]> {
	const rows = await listRoomTypes(facilityUuid);
	return (rows ?? []).map((r) => mapRoomTypeRow(r as Record<string, unknown>));
}

export async function sbRoomTypeByUuid(uuid: string): Promise<RoomType | undefined> {
	const { data, error } = await supa().from('v_room_types').select('*').eq('room_type_id', uuid).maybeSingle();
	if (error) throw error;
	return data ? mapRoomTypeRow(data as Record<string, unknown>) : undefined;
}

export async function sbRoomTypeBySlug(facilityUuid: string, slug: string): Promise<RoomType | undefined> {
	const { data, error } = await supa()
		.from('v_room_types')
		.select('*')
		.eq('facility_id', facilityUuid)
		.eq('slug', slug)
		.maybeSingle();
	if (error) throw error;
	return data ? mapRoomTypeRow(data as Record<string, unknown>) : undefined;
}

export async function sbListPlansMapped(facilityUuid: string): Promise<RatePlan[]> {
	const rows = await listPlans(facilityUuid);
	return (rows ?? []).map((r) => mapPlanRow(r as Record<string, unknown>));
}

export async function sbPlanByUuid(uuid: string): Promise<RatePlan | undefined> {
	const { data, error } = await supa().from('v_plans').select('*').eq('rate_plan_id', uuid).maybeSingle();
	if (error) throw error;
	return data ? mapPlanRow(data as Record<string, unknown>) : undefined;
}

export async function sbPlanBySlug(facilityUuid: string, slug: string): Promise<RatePlan | undefined> {
	const { data, error } = await supa()
		.from('v_plans')
		.select('*')
		.eq('facility_id', facilityUuid)
		.eq('slug', slug)
		.maybeSingle();
	if (error) throw error;
	return data ? mapPlanRow(data as Record<string, unknown>) : undefined;
}

export async function sbListFaqsMapped(facilityUuid: string): Promise<Faq[]> {
	const rows = await listFaqs(facilityUuid);
	return (rows ?? []).map((r) => mapFaqRow(r as Record<string, unknown>, facilityUuid));
}

export async function sbListNewsMapped(facilityUuid: string, limit?: number): Promise<NewsPost[]> {
	const rows = await listNews(facilityUuid, limit);
	return (rows ?? []).map((r) => ({
		id: r.id,
		facilityId: facilityUuid,
		title: r.title,
		body: r.body ?? '',
		publishedAt: r.published_at,
		isPublished: true,
		createdAt: r.published_at
	}));
}

// ---- plan_offers（プラン×客室×料金×残室。プラン一覧/詳細の「泊まれる客室」の心臓部）----

export interface PlanOffer {
	ratePlanId: string;
	roomTypeId: string;
	total: number;
	perPerson: number;
	remaining: number;
}

/** book.plan_offers。日付 null は 0 行（「日付を選択してください」表示）。p_rate_plan_id 省略で施設全プラン。 */
export async function sbPlanOffers(
	facilityUuid: string,
	checkin: string | undefined,
	nights: number,
	adults: number,
	ratePlanId?: string
): Promise<PlanOffer[]> {
	const { data, error } = await supa().rpc('plan_offers', {
		p_facility: facilityUuid,
		p_checkin: checkin ?? null,
		p_nights: nights,
		p_adults: adults,
		p_rate_plan_id: ratePlanId ?? null
	});
	if (error) throw error;
	return ((data ?? []) as { rate_plan_id: string; room_type_id: string; total: number; per_person: number; remaining: number }[]).map(
		(r) => ({ ratePlanId: r.rate_plan_id, roomTypeId: r.room_type_id, total: r.total, perPerson: r.per_person, remaining: r.remaining })
	);
}

/** plan_offers の 1 行 → Quote（客室選択カードの表示に必要な total / perPerson のみ確定。lines は省略）。 */
export function offerToQuote(o: PlanOffer): Quote {
	return { lines: [], total: o.total, perPerson: o.perPerson, taxIncluded: 0, pointsUsed: 0, payable: o.total };
}

/** 検索/トップ用: 全施設 × 空室（or 参考料金）を FacilityAvailability[] に整形（demo searchAvailability と同形）。 */
export async function sbFacilityAvailability(
	checkin: string | undefined,
	nights: number,
	adults: number
): Promise<FacilityAvailability[]> {
	const facilities = await sbListFacilities();
	if (!checkin) {
		// 日付未指定 = 参考最低料金（1名1泊。SEO入口）。rate が無い施設は満室扱い（minTotal=null）。
		const ref = await referenceMinPrice(adults);
		const byId = new Map(ref.map((r) => [r.facility_id, r.min_per_person]));
		return facilities.map((f) => {
			const per = byId.get(f.id) ?? null;
			return {
				facility: f,
				minTotal: per !== null ? per * adults * nights : null,
				minPerPerson: per,
				remaining: per !== null ? 9 : 0,
				reference: true
			};
		});
	}
	const avail = await searchAvailability(checkin, nights, adults);
	const byId = new Map(avail.map((r) => [r.facility_id, r]));
	return facilities.map((f) => {
		const a = byId.get(f.id);
		return {
			facility: f,
			minTotal: a ? a.min_total : null,
			minPerPerson: a ? a.min_per_person : null,
			remaining: a ? a.remaining : 0,
			reference: false
		};
	});
}

// ---- 予約フローの cookie（session_id / ドラフト / 直近予約）----
// book.holds は anon から UPDATE 不可（RLS）で guest_draft を書けず、予約確定を anon で参照できる
// booking 取得 RPC も無いため、②→③（ドラフト）と ③→完了（直近予約）の受け渡しは httpOnly cookie で行う。

const SID_COOKIE = 'ab_book_sid';
const DRAFT_COOKIE = 'ab_book_draft';
const LAST_COOKIE = 'ab_book_last';

/** hold の session_id（未ログインでも hold 可能にする匿名セッション識別子）。無ければ発行して cookie に保存。 */
export function bookingSessionId(cookies: Cookies): string {
	let sid = cookies.get(SID_COOKIE);
	if (!sid) {
		sid = crypto.randomUUID();
		cookies.set(SID_COOKIE, sid, { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 });
	}
	return sid;
}

/** ②お客様情報 → ③決済 へ引き継ぐ入力ドラフト（事前決済プランのみ使用）。 */
export interface BookingDraft {
	holdId: string;
	guest: GuestInfo;
	pointsUsed: number;
	payment: 'onsite' | 'card' | 'paypay';
}

export function setBookingDraft(cookies: Cookies, draft: BookingDraft): void {
	cookies.set(DRAFT_COOKIE, encodeURIComponent(JSON.stringify(draft)), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 30
	});
}

export function getBookingDraft(cookies: Cookies): BookingDraft | null {
	const raw = cookies.get(DRAFT_COOKIE);
	if (!raw) return null;
	try {
		return JSON.parse(decodeURIComponent(raw)) as BookingDraft;
	} catch {
		return null;
	}
}

export function clearBookingDraft(cookies: Cookies): void {
	cookies.delete(DRAFT_COOKIE, { path: '/' });
}

/** 確定 → 完了ページ へ引き継ぐ直近予約サマリ（anon で booking を再取得できないための受け渡し）。 */
export interface LastBooking {
	code: string;
	facilityUuid: string;
	roomUuid: string;
	planUuid: string;
	checkin: string;
	nights: number;
	adults: number;
	total: number;
	pointsUsed: number;
	pointsEarned: number;
	payment: 'onsite' | 'card' | 'paypay';
	discountAmount: number;
	prepayDiscountRate?: number;
	guest: { name: string; kana: string; phone: string; email: string };
}

export function setLastBooking(cookies: Cookies, last: LastBooking): void {
	cookies.set(LAST_COOKIE, encodeURIComponent(JSON.stringify(last)), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 30
	});
}

export function getLastBooking(cookies: Cookies): LastBooking | null {
	const raw = cookies.get(LAST_COOKIE);
	if (!raw) return null;
	try {
		return JSON.parse(decodeURIComponent(raw)) as LastBooking;
	} catch {
		return null;
	}
}
