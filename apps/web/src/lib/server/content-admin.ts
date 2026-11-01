// 管理画面: 部屋タイプ・プランの紹介（book.room_type_contents / book.plan_contents）の読み書き。
//
// ■ 正本はこのテーブル（2026-09-26 決定）。autumn-rms の取引先専用ページも同じ行を読む。
// ■ 必ず**ログイン中スタッフの Supabase クライアント**（createSupabaseServerClient）で叩く。
//   RLS は *_staff_all（private.has_facility_access）で施設ごとに守られている。service_role は使わない。
// ■ 部屋名・定員は pms.room_types、プラン名は booking.rate_plans が持つ。紹介テーブルには無いので結合して見せる。
//   booking スキーマは Data API に出していないので、book.v_admin_rate_plans（security_invoker ビュー）から読む。
//   読めなければプラン名の代わりに slug を出し、画面に理由を出す（一覧そのものは落とさない）。
import { planAccessOf, type PlanAccess } from '$lib/plan-access';
import { planLimitsOf, stayClosedOf, type PlanLimits, type StayClosed } from '$lib/plan-limits';
import { planMealsOf, type DinnerCourseOption, type PlanMeals } from '$lib/plan-meals';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PLAN_PAY_OPTIONS, normalizeOptions, type PlanPayOption } from '$lib/direct-payment';
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
	/** 支払方法の組み合わせ（book.plan_contents.payment_options・2026-11-02）。未設定は payment_method から */
	paymentOptions: PlanPayOption[];
	/** 予約時決済（オンラインのカード事前決済）の割引率 0〜0.2（book.plan_contents.prepay_discount_rate） */
	prepayDiscountRate: number;
	/** 公開範囲（シークレットプラン・book.plan_contents.audience / min_rank / link_only） */
	access: PlanAccess;
	/** 絞り込み（販売期間・人数・部屋タイプ・booking.rate_plans）。読めないときは制限なし */
	limits: PlanLimits;
	/** 宿泊不可（期間・曜日）。book.plan_contents.stay_blackouts / stay_closed_dows（autumn-shared 20261101211300・20261101211430） */
	stayClosed: StayClosed;
	/** 料金（rms）との関係。'awaiting' は Book で先に作って、rms の料金設定をまだ紐づけていないプラン */
	rmsState: PlanRmsState;
	/** 販売表示期間（予約を受け付ける期間・日本時間の日付・空は制限なし）。book.plan_contents.booking_start / booking_end（autumn-shared 20261101045650） */
	bookingStart: string | null;
	bookingEnd: string | null;
	/** 料金テンプレートの食事（booking.rate_plans.meal_plan: 2食 / 朝食 / 素泊 / 日帰り）。読めないときは空 */
	mealPlan: string;
	/** お食事の設定（book.plan_contents.meals・null＝料金テンプレートどおり。$lib/plan-meals） */
	meals: PlanMeals | null;
}

/** rms = rms 先行（同期が作った）／ linked = Book 先行で rms に紐づけ済み／ awaiting = Book 先行で料金待ち */
export type PlanRmsState = 'rms' | 'linked' | 'awaiting';

/**
 * v_admin_rate_plans の managed_by / book_origin から、料金の紐づけ状態を決める。
 * book_origin（Book で作った）で managed_by が rms_sync なら紐づけ済み、book のままなら料金待ち。
 * ビューを読めなかったとき（行が無い）は rms 先行として扱う。
 */
export function planRmsStateOf(rp: { managed_by?: unknown; book_origin?: unknown } | undefined): PlanRmsState {
	if (rp?.book_origin !== true) return 'rms';
	return rp.managed_by === 'rms_sync' ? 'linked' : 'awaiting';
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
		.select('id, code, name, meal_plan, is_active, public_on_direct, payment_method, managed_by, book_origin, sales_start, sales_end, min_guests, max_guests, room_type_ids')
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
		paymentOptions: Array.isArray(c.payment_options)
			? normalizeOptions(PLAN_PAY_OPTIONS, c.payment_options)
			: rp?.payment_method === 'prepayment'
				? ['online_now', 'online_checkout']
				: rp?.payment_method === 'deposit'
					? ['onsite', 'online_now', 'online_checkout']
					: ['onsite'],
		prepayDiscountRate: Number(c.prepay_discount_rate ?? 0) || 0,
		access: planAccessOf(c),
		limits: planLimitsOf(rp),
		stayClosed: stayClosedOf(c),
		rmsState: planRmsStateOf(rp),
		bookingStart: dateOrNull(c.booking_start),
		bookingEnd: dateOrNull(c.booking_end),
		mealPlan: String(rp?.meal_plan ?? ''),
		meals: planMealsOf(c.meals)
	};
}

/** RMS の夕食コース（public.rms_meal_rates の「夕食」・並び順）。お食事設定の選択肢。読めなければ空 */
export async function sbListDinnerCourses(client: SupabaseClient, facilityUuid: string): Promise<DinnerCourseOption[]> {
	const { data, error } = await client
		.from('rms_meal_rates')
		.select('id, name, description, sort_order')
		.eq('facility_id', facilityUuid)
		.eq('category', '夕食')
		.order('sort_order');
	if (error) throw error;
	return ((data ?? []) as Row[]).map((r) => ({ id: String(r.id), name: String(r.name ?? ''), description: String(r.description ?? '') }));
}

/** このプランの夕食コースの自動判定（料金テンプレートの食事メモから・book.plan_dinner_course）。設定が無いときの初期値の推定に使う */
export async function sbAutoDinnerCourse(client: SupabaseClient, ratePlanId: string): Promise<string | null> {
	const { data, error } = await client.schema('book').rpc('plan_dinner_course', { p_rate_plan_id: ratePlanId });
	if (error) return null;
	return typeof data === 'string' && data ? data : null;
}

/** お食事の設定を保存する（null で料金テンプレートどおりに戻す）。料金は変わらない */
export async function sbSetPlanMeals(client: SupabaseClient, facilityUuid: string, ratePlanId: string, meals: PlanMeals | null): Promise<void> {
	const { data, error } = await client
		.schema('book')
		.from('plan_contents')
		.update({ meals, updated_at: new Date().toISOString() })
		.eq('rate_plan_id', ratePlanId)
		.eq('facility_id', facilityUuid)
		.select('rate_plan_id');
	if (error) throw error;
	if ((data ?? []).length === 0) throw new Error('対象のプランが見つからないか、編集する権限がありません。');
}

const dateOrNull = (v: unknown): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);

/** プランを Book で新規に作る（book.admin_create_plan）。料金は無い状態で、rms からの紐づけを待つ。作った rate_plan の id を返す */
export async function sbCreatePlan(
	client: SupabaseClient,
	facilityUuid: string,
	name: string,
	mealPlan: string | null
): Promise<string> {
	const { data, error } = await client.schema('book').rpc('admin_create_plan', {
		p_facility_id: facilityUuid,
		p_name: name,
		p_meal_plan: mealPlan
	});
	if (error) {
		if (error.message.includes('forbidden')) throw new Error('この施設にプランを作る権限がありません。');
		if (error.message.includes('invalid_params')) throw new Error('プラン名は 1〜60 文字で入力してください。');
		throw error;
	}
	return String(data);
}

/** その施設の紹介行があるプラン（rms 同期が作ったもの、または Book で先に作ったもの）を並び順で返す。 */
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

/**
 * 公開ページのプレビュー用に、未公開・料金なし・直販対象外のプランも slug で引く（スタッフだけが呼ぶ）。
 * 公開側の book.v_plans は is_published と直販対象で絞るので、ここでは紹介の行と管理用ビューから行を組み立てる。
 */
export async function sbPlanPreviewRow(
	client: SupabaseClient,
	facilityUuid: string,
	slug: string
): Promise<Record<string, unknown> | undefined> {
	const pc = await client
		.schema('book')
		.from('plan_contents')
		.select('*')
		.eq('facility_id', facilityUuid)
		.eq('slug', slug)
		.maybeSingle();
	if (pc.error) throw pc.error;
	if (!pc.data) return undefined;
	const c = pc.data as Row;
	const { byId } = await loadRatePlans(client, facilityUuid, [String(c.rate_plan_id)]);
	const rp = byId.get(String(c.rate_plan_id));
	return { ...c, name: rp?.name ?? c.slug, meal_plan: rp?.meal_plan ?? '', payment_method: rp?.payment_method ?? null };
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
			// 販売スイッチ（is_published）はここでは書かない（sbSetPlanSale）。紹介文の保存で、開いたままの古い画面の値に戻さないため
			headline: draft.headline,
			description: draft.description,
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

/**
 * 販売スイッチ（販売中／停止中＝is_published）と販売表示期間（booking_start / booking_end）を保存する。
 * 公式サイトで販売中かは DB の book.plan_on_sale が判定する（autumn-shared 20261101045650）。
 */
export async function sbSetPlanSale(
	client: SupabaseClient,
	facilityUuid: string,
	ratePlanId: string,
	sale: { onSale: boolean; bookingStart: string | null; bookingEnd: string | null }
): Promise<void> {
	const { data, error } = await client
		.schema('book')
		.from('plan_contents')
		.update({
			is_published: sale.onSale,
			booking_start: sale.bookingStart,
			booking_end: sale.bookingEnd,
			updated_at: new Date().toISOString()
		})
		.eq('rate_plan_id', ratePlanId)
		.eq('facility_id', facilityUuid)
		.select('rate_plan_id');
	if (error) {
		if (error.message.includes('plan_contents_booking_window_check')) throw new Error('販売表示期間は、開始日が終了日より後にならないようにしてください。');
		throw error;
	}
	if ((data ?? []).length === 0) throw new Error('対象のプランが見つからないか、編集する権限がありません。');
}

// ---------------------------------------------------------------- 写真

/**
 * 紹介用の写真を book-photos バケットへ上げて公開 URL を返す。
 * パスは rooms/{facilityUuid}/…・plans/{facilityUuid}/…・partners/{facilityUuid}/…（取引先特典の画像）・banners/{facilityUuid}/…（客室案内サンクスページのバナー）。
 * バケットは membership 保持者が書き込み可。
 * 形式・サイズの確認は呼び出し側で photoFileProblem() を通しておくこと。
 */
export async function sbUploadContentPhoto(
	client: SupabaseClient,
	kind: 'rooms' | 'plans' | 'partners' | 'banners',
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
/** 公開範囲を保存する（book.admin_set_plan_access・スタッフ）。シークレットプラン */
export async function sbSetPlanAccess(client: SupabaseClient, ratePlanId: string, access: PlanAccess): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_set_plan_access', {
		p_rate_plan_id: ratePlanId,
		p_audience: access.audience,
		p_min_rank: access.minRank,
		p_link_only: access.linkOnly
	});
	if (error) {
		if (error.message.includes('forbidden')) throw new Error('このプランの公開範囲を変更する権限がありません。');
		if (error.message.includes('not_found')) throw new Error('プランが見つかりません。');
		if (/invalid_params|invalid_rank/.test(error.message)) throw new Error('公開範囲の値が正しくありません。');
		throw error;
	}
}

/** 絞り込みを保存する（book.admin_set_plan_limits・スタッフ）。値の検査は planLimitsFromForm で済ませてから呼ぶ */
export async function sbSetPlanLimits(client: SupabaseClient, ratePlanId: string, l: PlanLimits): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_set_plan_limits', {
		p_rate_plan_id: ratePlanId,
		p_sales_start: l.salesStart,
		p_sales_end: l.salesEnd,
		p_min_guests: l.minGuests,
		p_max_guests: l.maxGuests,
		p_room_type_ids: l.roomTypeIds
	});
	if (error) {
		if (error.message.includes('forbidden')) throw new Error('このプランの絞り込みを変更する権限がありません。');
		if (error.message.includes('not_found')) throw new Error('プランが見つかりません。');
		if (error.message.includes('invalid_params')) throw new Error('絞り込みの値が正しくありません（期間の開始≦終了、人数 1〜6 で最小≦最大、部屋タイプはこの施設のもの）。');
		throw error;
	}
}

/** 宿泊不可（期間・曜日）を保存する（book.admin_set_plan_blackouts・スタッフ）。値の検査は stayClosedFromForm で済ませてから呼ぶ */
export async function sbSetPlanStayClosed(client: SupabaseClient, ratePlanId: string, s: StayClosed): Promise<void> {
	const { error } = await client.schema('book').rpc('admin_set_plan_blackouts', {
		p_rate_plan_id: ratePlanId,
		p_blackouts: s.blackouts,
		p_dows: s.dows
	});
	if (error) {
		if (error.message.includes('forbidden')) throw new Error('このプランの宿泊不可を変更する権限がありません。');
		if (error.message.includes('not_found')) throw new Error('プランが見つかりません。');
		if (error.message.includes('invalid_params')) throw new Error('宿泊不可の値が正しくありません（期間は開始≦終了・100件まで、曜日は日〜土）。');
		throw error;
	}
}

/** プランの専用 URL のトークン（book.admin_plan_share_link・無ければ作る。rotate で作り直す＝古い URL は使えなくなる） */
export async function sbPlanShareToken(client: SupabaseClient, ratePlanId: string, rotate = false): Promise<string> {
	const { data, error } = await client.schema('book').rpc('admin_plan_share_link', { p_rate_plan_id: ratePlanId, p_rotate: rotate });
	if (error) {
		if (error.message.includes('forbidden')) throw new Error('このプランの専用URLを発行する権限がありません。');
		if (error.message.includes('not_found')) throw new Error('プランが見つかりません。');
		throw error;
	}
	return String(data);
}

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
