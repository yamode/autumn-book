// Supabase データアダプタ — book スキーマ（autumn-shared#28 適用後に有効化）
// store.ts（デモ）と同じ意味論の非同期 API を提供する。
// カットオーバー手順:
//   1. autumn-shared#28 を main にマージ（PROD 自動適用）
//   2. rms 側で daily_rates / availability にデータが入っていること、
//      book.facility_contents / plan_contents に公開行を投入済みであることを確認
//   3. .env の DATA_SOURCE=supabase に変更し、各 +page.server.ts の import を
//      store.ts からこのモジュールへ段階的に切替（検索系 → 予約系 → 会員系の順）
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
import type { CalendarDay, GuestInfo, OtayoriPost, OtayoriAdminItem } from '$lib/types';
import type { Quote } from '@autumn-book/core';

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
