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
import type { CalendarDay, GuestInfo } from '$lib/types';
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
