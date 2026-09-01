// 貸切風呂の公開予約（アプリ3）— Supabase の book RPC を叩く薄いアダプタ。
//
// 台帳は PMS の pms.private_bath_slots のまま。ここでは book スキーマの
// SECURITY DEFINER RPC 越しにしか触らない（anon は pms に権限を持たない）。
// 設計の正は autumn_book_private_bath_design.md。
import { supa } from '$lib/server/supabase';

export type BathSlot = {
	from: string;
	to: string;
	taken: boolean;
	mine: boolean;
	slot_id: string | null;
	/** 締切（利用の N 分前）を過ぎている。 */
	closed: boolean;
};

export type BathDay = { date: string; slots: BathSlot[] };
export type BathUnit = { bath_id: string | null; bath_name: string; days: BathDay[] };

export type BathReservation = {
	id: string;
	date: string;
	from: string;
	to: string | null;
	bath_id: string | null;
	price_yen: number;
	booked_via: string;
	/** ご自身で取り消せるか（QRから取った枠・締切前）。 */
	cancelable: boolean;
};

export type BathContext = {
	ok: boolean;
	/** ok=false のときだけ。stay_not_linked / stay_not_found。 */
	reason?: string;
	facility?: { id: string; slug: string; name: string };
	room_code?: string;
	guest_name?: string | null;
	check_in_date?: string;
	check_out_date?: string;
	enabled?: boolean;
	price_yen?: number;
	per_room_per_range?: number;
	cutoff_min?: number;
	cancel_min?: number;
	baths?: BathUnit[];
	mine?: BathReservation[];
};

/** 公開画面が1回で必要な情報を全部取る。無効なトークンは null。 */
export async function sbBathContext(token: string): Promise<BathContext | null> {
	const { data, error } = await supa().rpc('private_bath_context', { p_token: token });
	if (error) return null; // invalid_token など
	return data as BathContext;
}

/**
 * 枠を取る。RPC の例外は**そのまま投げず**、画面が出し分けられるキーに正規化する。
 * RPC は 'slot_taken:2026-09-01,15:00' のように詳細を付けて投げてくるので頭だけを見る。
 */
export type BathReserveResult =
	| { ok: true; made: number; price_yen: number }
	| { ok: false; code: 'slot_taken' | 'per_room_limit' | 'past_cutoff' | 'other' };

export async function sbBathReserve(
	token: string,
	bathId: string | null,
	slots: Array<{ date: string; from: string }>
): Promise<BathReserveResult> {
	const { data, error } = await supa().rpc('reserve_private_bath', {
		p_token: token,
		p_bath: bathId,
		p_slots: slots
	});
	if (error) {
		const head = String(error.message ?? '').split(':')[0].trim();
		if (head === 'slot_taken') return { ok: false, code: 'slot_taken' };
		if (head === 'per_room_limit') return { ok: false, code: 'per_room_limit' };
		if (head === 'past_cutoff') return { ok: false, code: 'past_cutoff' };
		return { ok: false, code: 'other' };
	}
	const r = data as { made: number; price_yen: number };
	return { ok: true, made: r.made, price_yen: r.price_yen };
}

/** 自分が取った枠を取り消す。失敗しても理由は分けない（画面では1つの案内に寄せる）。 */
export async function sbBathCancel(token: string, slotId: string): Promise<boolean> {
	const { error } = await supa().rpc('cancel_private_bath', {
		p_token: token,
		p_slot_id: slotId
	});
	return !error;
}

// ---------------------------------------------------------------------------
// 予約フォームの中身（文章・写真）と、QR テスト用の滞在一覧
// ---------------------------------------------------------------------------
// 公開側（anon）は content だけ。管理側（authenticated）は has_facility_access で守られた
// RPC を、管理者の Supabase セッションを持つ client で叩く（/admin/inroom と同じ作法）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBathContent, type BathContent } from '$lib/private-bath-content';

/** 公開画面に出す文章・写真。未設定なら空（＝アプリの既定文言が出る）。 */
export async function sbBathContent(facilityUuid: string, lang: string): Promise<BathContent> {
	const { data, error } = await supa().rpc('private_bath_content', {
		p_facility: facilityUuid,
		p_lang: lang
	});
	if (error) return normalizeBathContent(null);
	return normalizeBathContent(data);
}

/** 管理画面用: 3言語ぶんまとめて。 */
export async function sbBathContentsAdmin(
	client: SupabaseClient,
	facilityUuid: string
): Promise<Record<string, BathContent>> {
	const { data, error } = await client
		.schema('book')
		.rpc('private_bath_contents_admin', { p_facility: facilityUuid });
	if (error) throw error;
	const out: Record<string, BathContent> = {};
	for (const [lang, v] of Object.entries((data ?? {}) as Record<string, unknown>)) {
		out[lang] = normalizeBathContent(v);
	}
	return out;
}

export async function sbBathContentSave(
	client: SupabaseClient,
	facilityUuid: string,
	lang: string,
	content: BathContent
): Promise<void> {
	const { error } = await client.schema('book').rpc('private_bath_content_upsert', {
		p_facility: facilityUuid,
		p_lang: lang,
		p_fields: content.fields,
		p_images: content.images
	});
	if (error) throw error;
}

export type BookableStay = {
	stay_id: string;
	room_code: string;
	guest_name: string;
	check_in_date: string;
	check_out_date: string;
	token: string | null;
	short_code: string | null;
	valid_to: string | null;
};

/** QR テスト用: その日に泊まっているお客様（既に発行済みのトークンがあれば一緒に返る）。 */
export async function sbListBookableStays(
	client: SupabaseClient,
	facilityUuid: string,
	date: string | null
): Promise<BookableStay[]> {
	const { data, error } = await client
		.schema('book')
		.rpc('list_bookable_stays', { p_facility: facilityUuid, p_date: date });
	if (error) throw error;
	return (data ?? []) as BookableStay[];
}

/** その滞在のトークンを取り出す（無ければ発行）。刷り直しても同じ QR になる。 */
export async function sbGetOrIssueStayToken(
	client: SupabaseClient,
	facilityUuid: string,
	stay: { stay_id: string; room_code: string; guest_name: string; check_out_date: string }
): Promise<{ token: string; short_code: string }> {
	// 有効期限はチェックアウト日の 11:00 JST（/admin/inroom の発行と同じ考え方）。
	const validTo = new Date(`${stay.check_out_date}T11:00:00+09:00`).toISOString();
	const { data, error } = await client.schema('book').rpc('get_or_issue_stay_token', {
		p_facility: facilityUuid,
		p_stay_id: stay.stay_id,
		p_room_code: stay.room_code || '—',
		p_valid_to: validTo,
		p_guest_name: stay.guest_name || null
	});
	if (error) throw error;
	return data as { token: string; short_code: string };
}

/** 予約フォームの写真を book-photos バケットへ上げ、公開URLを返す。 */
export async function sbUploadBathPhoto(
	client: SupabaseClient,
	facilityUuid: string,
	file: File
): Promise<string> {
	const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
	const path = `private-bath/${facilityUuid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
	const { error } = await client.storage.from('book-photos').upload(path, file, {
		contentType: file.type || 'image/jpeg',
		upsert: false
	});
	if (error) throw error;
	return client.storage.from('book-photos').getPublicUrl(path).data.publicUrl;
}
