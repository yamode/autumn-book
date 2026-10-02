// 管理画面: 部屋タイプ・プランの紹介（book.room_type_contents / book.plan_contents）の読み書き。
//
// ■ 正本はこのテーブル（2026-09-26 決定）。autumn-rms の取引先専用ページも同じ行を読む。
// ■ 必ず**ログイン中スタッフの Supabase クライアント**（createSupabaseServerClient）で叩く。
//   RLS は *_staff_all（private.has_facility_access）で施設ごとに守られている。service_role は使わない。
// ■ 部屋名・定員は pms.room_types、プラン名は booking.rate_plans が持つ。紹介テーブルには無いので結合して見せる。
//   booking スキーマは Data API に出していないので、book.v_admin_rate_plans（security_invoker ビュー）から読む。
//   読めなければプラン名の代わりに slug を出し、画面に理由を出す（一覧そのものは落とさない）。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	normalizePhotos,
	normalizeSections,
	normalizeSpecs,
	normalizeStringList,
	type ContentDraft,
	type ContentPhoto,
	type ContentSection,
	type ContentSpec
} from '$lib/content-blocks';

/** 編集画面に渡す共通部分。 */
export interface AdminContentBase {
	/** 紹介の行がまだ無い（部屋だけ起こりうる。保存すると作られる）。 */
	hasContent: boolean;
	slug: string;
	headline: string;
	description: string;
	isPublished: boolean;
	tags: string[];
	specs: ContentSpec[];
	sections: ContentSection[];
	photos: ContentPhoto[];
	sortOrder: number;
	updatedAt: string | null;
}

export interface AdminRoomContent extends AdminContentBase {
	id: string;
	code: string;
	name: string;
	capacityMin: number | null;
	capacityMax: number | null;
	isActive: boolean;
	/** 取引先向けの短縮名（book.room_type_contents.partner_short_name。ご請求書の部屋名）。空なら未設定 */
	partnerShortName: string;
	/** PMS の短縮名（pms.room_types.short_name。社内向けの略称。参考表示用） */
	pmsShortName: string;
}

export interface AdminPlanContent extends AdminContentBase {
	id: string;
	code: string;
	name: string;
	isActive: boolean;
	publicOnDirect: boolean;
	/** 支払方法（booking.rate_plans.payment_method）。Book の管理画面で設定する。読めないときは null */
	paymentMethod: PlanPaymentMethod | null;
	/** 予約時決済（オンラインのカード事前決済）の割引率 0〜0.2（book.plan_contents.prepay_discount_rate） */
	prepayDiscountRate: number;
}

/** onsite = 現地払いのみ / prepayment = 事前決済のみ / deposit = 事前決済と現地払いのどちらも選べる */
export const PLAN_PAYMENT_METHODS = ['onsite', 'prepayment', 'deposit'] as const;
export type PlanPaymentMethod = (typeof PLAN_PAYMENT_METHODS)[number];

type Row = Record<string, unknown>;

function baseFromRow(c: Row | undefined, photoFallback: 'room' | 'meal'): AdminContentBase {
	return {
		hasContent: !!c,
		slug: String(c?.slug ?? ''),
		headline: String(c?.headline ?? ''),
		description: String(c?.description ?? ''),
		isPublished: c?.is_published === true,
		tags: normalizeStringList(c?.amenities ?? c?.highlight_tags),
		specs: normalizeSpecs(c?.specs),
		sections: normalizeSections(c?.sections),
		photos: normalizePhotos(c?.photos, photoFallback),
		sortOrder: Number(c?.sort_order ?? 0) || 0,
		updatedAt: c?.updated_at ? String(c.updated_at) : null
	};
}

// ---------------------------------------------------------------- 部屋

/** その施設の部屋タイプ（PMS）と紹介を結合して返す。PMS 側の並び順どおり。 */
export async function sbListRoomContentsAdmin(
	client: SupabaseClient,
	facilityUuid: string
): Promise<AdminRoomContent[]> {
	const [rt, rc] = await Promise.all([
		client
			.schema('pms')
			.from('room_types')
			.select('id, code, name, short_name, capacity_min, capacity_max, is_active, sort_order')
			.eq('facility_id', facilityUuid)
			.order('sort_order')
			.order('code'),
		client.schema('book').from('room_type_contents').select('*').eq('facility_id', facilityUuid)
	]);
	if (rt.error) throw rt.error;
	if (rc.error) throw rc.error;
	const byId = new Map<string, Row>((rc.data ?? []).map((r: Row) => [String(r.room_type_id), r]));
	return (rt.data ?? []).map((r: Row) => ({
		...baseFromRow(byId.get(String(r.id)), 'room'),
		id: String(r.id),
		code: String(r.code ?? ''),
		name: String(r.name ?? ''),
		capacityMin: r.capacity_min == null ? null : Number(r.capacity_min),
		capacityMax: r.capacity_max == null ? null : Number(r.capacity_max),
		isActive: r.is_active === true,
		partnerShortName: String(byId.get(String(r.id))?.partner_short_name ?? ''),
		pmsShortName: String(r.short_name ?? '')
	}));
}

export async function sbGetRoomContentAdmin(
	client: SupabaseClient,
	facilityUuid: string,
	roomTypeId: string
): Promise<AdminRoomContent | null> {
	const rows = await sbListRoomContentsAdmin(client, facilityUuid);
	return rows.find((r) => r.id === roomTypeId) ?? null;
}

/** 部屋コードから URL 用の slug を作る（紹介の行を新しく作るときだけ使う）。 */
function slugFromCode(code: string, id: string): string {
	const s = code
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return s || id.slice(0, 8);
}

/**
 * 部屋の紹介を保存する。行があれば更新、無ければ PMS の行から tenant / facility を取って作る。
 * draft は normalizeContentDraft を通したものを渡すこと。
 */
export async function sbSaveRoomContent(
	client: SupabaseClient,
	facilityUuid: string,
	roomTypeId: string,
	draft: ContentDraft
): Promise<void> {
	const fields = {
		headline: draft.headline,
		description: draft.description,
		is_published: draft.isPublished,
		amenities: draft.tags,
		specs: draft.specs,
		sections: draft.sections,
		photos: draft.photos,
		updated_at: new Date().toISOString()
	};
	const upd = await client
		.schema('book')
		.from('room_type_contents')
		.update(fields)
		.eq('room_type_id', roomTypeId)
		.eq('facility_id', facilityUuid)
		.select('room_type_id');
	if (upd.error) throw upd.error;
	if ((upd.data ?? []).length > 0) return;

	// 紹介の行がまだ無い部屋。PMS の行を読めた（＝この施設の権限がある）ときだけ作る。
	const rt = await client
		.schema('pms')
		.from('room_types')
		.select('id, tenant_id, facility_id, code')
		.eq('id', roomTypeId)
		.eq('facility_id', facilityUuid)
		.maybeSingle();
	if (rt.error) throw rt.error;
	if (!rt.data) throw new Error('対象の部屋タイプが見つかりません。');
	const r = rt.data as Row;
	const ins = await client
		.schema('book')
		.from('room_type_contents')
		.insert({
			room_type_id: roomTypeId,
			tenant_id: r.tenant_id,
			facility_id: r.facility_id,
			slug: slugFromCode(String(r.code ?? ''), roomTypeId),
			...fields
		});
	if (ins.error) throw ins.error;
}

/**
 * 取引先向けの短縮名だけを保存する（2026-10-02 指示）。紹介の行が無ければ非公開の行を作る。
 * 空文字は未設定（null）として保存する。
 */
export async function sbSaveRoomPartnerShortName(
	client: SupabaseClient,
	facilityUuid: string,
	roomTypeId: string,
	value: string
): Promise<void> {
	const v = value.trim().slice(0, 40) || null;
	const upd = await client
		.schema('book')
		.from('room_type_contents')
		.update({ partner_short_name: v, updated_at: new Date().toISOString() })
		.eq('room_type_id', roomTypeId)
		.eq('facility_id', facilityUuid)
		.select('room_type_id');
	if (upd.error) throw upd.error;
	if ((upd.data ?? []).length > 0) return;
	const rt = await client
		.schema('pms')
		.from('room_types')
		.select('id, tenant_id, facility_id, code')
		.eq('id', roomTypeId)
		.eq('facility_id', facilityUuid)
		.maybeSingle();
	if (rt.error) throw rt.error;
	if (!rt.data) throw new Error('対象の部屋タイプが見つかりません。');
	const r = rt.data as Row;
	const ins = await client
		.schema('book')
		.from('room_type_contents')
		.insert({
			room_type_id: roomTypeId,
			tenant_id: r.tenant_id,
			facility_id: r.facility_id,
			slug: slugFromCode(String(r.code ?? ''), roomTypeId),
			is_published: false,
			partner_short_name: v
		});
	if (ins.error) throw ins.error;
}

// ---------------------------------------------------------------- プラン

export interface AdminPlanList {
	plans: AdminPlanContent[];
	/** プラン名（booking.rate_plans）を読めなかったときの理由。null なら読めている。 */
	namesError: string | null;
}

/**
 * プラン名などを読む。booking スキーマは Data API に出していないので、book の security_invoker ビュー
 * v_admin_rate_plans（autumn-shared 20260926094643）経由で読む（booking.rate_plans の RLS がそのまま効く）。
 * 読めなければ空の Map と理由を返す。
 */
async function loadRatePlans(
	client: SupabaseClient,
	facilityUuid: string,
	ids?: string[]
): Promise<{ byId: Map<string, Row>; error: string | null }> {
	let q = client
		.schema('book')
		.from('v_admin_rate_plans')
		.select('id, code, name, is_active, public_on_direct, payment_method')
		.eq('facility_id', facilityUuid);
	if (ids) q = q.in('id', ids);
	const { data, error } = await q;
	if (error) {
		return { byId: new Map(), error: `プラン名（book.v_admin_rate_plans）を読めません: ${error.message}` };
	}
	return { byId: new Map((data ?? []).map((r: Row) => [String(r.id), r])), error: null };
}

function planFromRows(c: Row, rp: Row | undefined): AdminPlanContent {
	return {
		...baseFromRow(c, 'meal'),
		id: String(c.rate_plan_id),
		code: String(rp?.code ?? ''),
		// プラン名が読めないときは slug（コード由来）で代用する
		name: String(rp?.name ?? c.slug ?? ''),
		isActive: rp ? rp.is_active === true : true,
		publicOnDirect: rp ? rp.public_on_direct === true : true,
		paymentMethod: (PLAN_PAYMENT_METHODS as readonly string[]).includes(String(rp?.payment_method))
			? (rp!.payment_method as PlanPaymentMethod)
			: null,
		prepayDiscountRate: Number(c.prepay_discount_rate ?? 0) || 0
	};
}

/** その施設の紹介行があるプラン（＝直販対象として rms 同期が作ったもの）を並び順で返す。 */
export async function sbListPlanContentsAdmin(
	client: SupabaseClient,
	facilityUuid: string
): Promise<AdminPlanList> {
	const pc = await client
		.schema('book')
		.from('plan_contents')
		.select('*')
		.eq('facility_id', facilityUuid)
		.order('sort_order')
		.order('slug');
	if (pc.error) throw pc.error;
	const { byId, error } = await loadRatePlans(client, facilityUuid);
	return {
		plans: (pc.data ?? []).map((c: Row) => planFromRows(c, byId.get(String(c.rate_plan_id)))),
		namesError: error
	};
}

export async function sbGetPlanContentAdmin(
	client: SupabaseClient,
	facilityUuid: string,
	ratePlanId: string
): Promise<{ plan: AdminPlanContent | null; namesError: string | null }> {
	const pc = await client
		.schema('book')
		.from('plan_contents')
		.select('*')
		.eq('facility_id', facilityUuid)
		.eq('rate_plan_id', ratePlanId)
		.maybeSingle();
	if (pc.error) throw pc.error;
	if (!pc.data) return { plan: null, namesError: null };
	const { byId, error } = await loadRatePlans(client, facilityUuid, [ratePlanId]);
	return { plan: planFromRows(pc.data as Row, byId.get(ratePlanId)), namesError: error };
}

/** プランの紹介を保存する（行は rms 同期が作るので更新のみ）。 */
export async function sbSavePlanContent(
	client: SupabaseClient,
	facilityUuid: string,
	ratePlanId: string,
	draft: ContentDraft
): Promise<void> {
	const { data, error } = await client
		.schema('book')
		.from('plan_contents')
		.update({
			headline: draft.headline,
			description: draft.description,
			is_published: draft.isPublished,
			highlight_tags: draft.tags,
			sort_order: draft.sortOrder,
			specs: draft.specs,
			sections: draft.sections,
			photos: draft.photos,
			updated_at: new Date().toISOString()
		})
		.eq('rate_plan_id', ratePlanId)
		.eq('facility_id', facilityUuid)
		.select('rate_plan_id');
	if (error) throw error;
	if ((data ?? []).length === 0) throw new Error('対象のプランが見つからないか、編集する権限がありません。');
}

// ---------------------------------------------------------------- 写真

/**
 * 紹介用の写真を book-photos バケットへ上げて公開 URL を返す。
 * パスは rooms/{facilityUuid}/… または plans/{facilityUuid}/…（バケットは membership 保持者が書き込み可）。
 * 形式・サイズの確認は呼び出し側で photoFileProblem() を通しておくこと。
 */
export async function sbUploadContentPhoto(
	client: SupabaseClient,
	kind: 'rooms' | 'plans',
	facilityUuid: string,
	file: File
): Promise<string> {
	const extByType: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/avif': 'avif'
	};
	const ext = extByType[file.type] ?? 'jpg';
	const path = `${kind}/${facilityUuid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
	const { error } = await client.storage.from('book-photos').upload(path, file, {
		contentType: file.type,
		upsert: false
	});
	if (error) throw error;
	return client.storage.from('book-photos').getPublicUrl(path).data.publicUrl;
}

/**
 * プランの支払方法と予約時決済の割引率を保存する（book.admin_set_plan_payment。autumn-shared 20260926151458）。
 * 支払方法は booking.rate_plans.payment_method（rms 同期は既存プランを上書きしない）、割引率は book.plan_contents。
 * 現地払いのみ（onsite）にすると割引率は DB 側で 0 に戻る。
 */
export async function sbSetPlanPayment(
	client: SupabaseClient,
	ratePlanId: string,
	method: PlanPaymentMethod,
	prepayDiscountRate: number
): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_set_plan_payment', {
		p_rate_plan_id: ratePlanId,
		p_method: method,
		p_prepay_discount_rate: prepayDiscountRate
	});
	if (error) {
		if (error.message.includes('forbidden')) throw new Error('このプランの支払方法を変更する権限がありません。');
		if (error.message.includes('not_found')) throw new Error('プランが見つかりません。');
		if (error.message.includes('invalid_params')) throw new Error('支払方法・割引率の値が正しくありません（割引は 0〜20%）。');
		throw error;
	}
}
