// 支払設定（施設ごとの早期決済割の段階表・除外期間、プランごとの支払方法と割引）の読み書き。
// DB は autumn-shared 20260926221912（book.payment_settings・book.admin_payment_settings ほか）。
//
//   公開側: loadEarlyPrepaySettings(Book の施設 ID) … 予約画面・プラン詳細で段階表を見せ、割引額を計算する。
//           book.payment_settings は anon で読める（公開情報）。DATA_SOURCE=demo はデモ用の設定を返す。
//   管理画面: sbAdminPaymentSettings / sbSaveEarlyPrepaySettings / sbSetPlanEarlyPrepay（ログイン中スタッフの権限で RPC）。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_EARLY_PREPAY_TIERS,
  NO_EARLY_PREPAY,
  normalizeEarlyPrepaySettings,
  type EarlyPrepaySettings
} from '$lib/early-prepay';
import type { PlanPaymentMethod } from '$lib/server/content-admin';
import { DEFAULT_ADMIN_FEE_PERCENT, normalizeAdminFeePercent, roundAdminFeePercent } from '$lib/cancel-admin-fee';
import {
  FACILITY_PAY_METHODS,
  PLAN_PAY_OPTIONS,
  normalizeOptions,
  normalizePaymentTexts,
  type FacilityPayMethod,
  type PaymentTexts,
  type PlanPayOption
} from '$lib/direct-payment';
import { DATA_SOURCE, supa } from './supabase';
import { FACILITY_UUID } from './supabase-data';

/** デモ環境の設定（段階表の初期値で ON） */
const DEMO_EARLY_PREPAY: EarlyPrepaySettings = { enabled: true, mode: 'discount', tiers: DEFAULT_EARLY_PREPAY_TIERS, blackouts: [] };

/**
 * 公開側: 施設の早期決済割の設定。読めなかったとき（migration 未適用など）は OFF として扱う
 * （DB の direct_payment_prepare も設定が無ければ段階表を当てないので、画面と金額はずれない）。
 */
export async function loadEarlyPrepaySettings(bookFacilityId: string): Promise<EarlyPrepaySettings> {
  if (DATA_SOURCE !== 'supabase') return DEMO_EARLY_PREPAY;
  const uuid = FACILITY_UUID[bookFacilityId] ?? bookFacilityId;
  try {
    const { data, error } = await supa()
      .from('payment_settings')
      // 列単位の grant なので列を明示する（* は anon で permission denied になる）
      .select('early_prepay_enabled, early_prepay_mode, early_prepay_tiers, early_prepay_blackouts')
      .eq('facility_id', uuid)
      .maybeSingle();
    if (error || !data) return NO_EARLY_PREPAY;
    return normalizeEarlyPrepaySettings(data);
  } catch {
    return NO_EARLY_PREPAY;
  }
}

/**
 * 公開側: 施設の「予約時決済の事務手数料（取消時に返金しない率）」（autumn-shared 20261007010002）。
 * 公式サイト（Book の施設 ID）・取引先ページ（core.facilities の UUID）のどちらの ID でもよい。
 * 読めなかったとき（migration 未適用・行が無い）は既定の 5%（DB の既定・トリガーの既定と同じ）。
 */
export async function loadCancelAdminFeePercent(facilityId: string): Promise<number> {
  if (DATA_SOURCE !== 'supabase') return DEFAULT_ADMIN_FEE_PERCENT;
  const uuid = FACILITY_UUID[facilityId] ?? facilityId;
  try {
    const { data, error } = await supa()
      .from('payment_settings')
      .select('cancel_admin_fee_percent')
      .eq('facility_id', uuid)
      .maybeSingle();
    if (error || !data) return DEFAULT_ADMIN_FEE_PERCENT;
    return normalizeAdminFeePercent((data as { cancel_admin_fee_percent?: unknown }).cancel_admin_fee_percent);
  } catch {
    return DEFAULT_ADMIN_FEE_PERCENT;
  }
}

/**
 * 公開側: 予約確認画面の支払方法の名前・説明文（施設ごとの上書き・autumn-shared 20261101211030）。
 * 読めなかったとき（migration 未適用・行が無い）は空＝画面の既定の文言。
 */
export async function loadPaymentTexts(facilityId: string): Promise<PaymentTexts> {
  if (DATA_SOURCE !== 'supabase') return {};
  const uuid = FACILITY_UUID[facilityId] ?? facilityId;
  try {
    const { data, error } = await supa().from('payment_settings').select('payment_texts').eq('facility_id', uuid).maybeSingle();
    if (error || !data) return {};
    return normalizePaymentTexts((data as { payment_texts?: unknown }).payment_texts);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// 管理画面
// ---------------------------------------------------------------------------

export type AdminPaymentPlan = {
  id: string;
  code: string;
  name: string;
  headline: string | null;
  isActive: boolean;
  publicOnDirect: boolean;
  isPublished: boolean;
  /** book.plan_contents の行があるか（無いと支払方法・割引を保存できない） */
  hasContent: boolean;
  paymentMethod: PlanPaymentMethod;
  /** 定率の予約時決済割引 0〜0.2 */
  prepayDiscountRate: number;
  /** 早期決済割（段階表）の対象 */
  earlyPrepay: boolean;
  /** 非会員の支払方法（null = 会員と同じ） */
  nonmemberPaymentMethod: PlanPaymentMethod | null;
  /** このプランで出す支払方法の組み合わせ（施設でオフの方法を含むことがある＝画面で薄く見せる） */
  paymentOptions: PlanPayOption[];
  /** 非会員の組み合わせ（null = 会員と同じ） */
  nonmemberPaymentOptions: PlanPayOption[] | null;
};

export type AdminPaymentSettings = {
  earlyPrepay: EarlyPrepaySettings;
  /** 予約時決済の事務手数料（取消時に返金しない率・%）。既定 5 */
  cancelAdminFeePercent: number;
  /** 施設全体でオンの支払方法 */
  paymentMethods: FacilityPayMethod[];
  /** 予約確認画面の支払方法の名前・説明文（上書き） */
  paymentTexts: PaymentTexts;
  updatedAt: string | null;
  plans: AdminPaymentPlan[];
};

const METHODS: PlanPaymentMethod[] = ['onsite', 'prepayment', 'deposit'];

function friendly(e: { message: string }, fallback: string): Error {
  const m = e.message;
  if (m.includes('forbidden'))
    return new Error('この施設の支払設定を変更する権限がありません（早期決済割の保存はテナント管理者だけができます）。');
  if (m.includes('not_found')) return new Error('施設またはプランが見つかりません。');
  if (m.includes('invalid_admin_fee')) return new Error('事務手数料の率が正しくありません（決済手数料 3.6% より大きく、20% 以下）。');
  if (m.includes('invalid_tiers')) return new Error('段階表の値が正しくありません（日数・割引率とも上の段より大きく、率は 1〜20%）。');
  if (m.includes('invalid_blackouts')) return new Error('除外期間の値が正しくありません（開始日 ≦ 終了日・1年以内）。');
  if (m.includes('Could not find the function') || m.includes('does not exist'))
    return new Error('DB の更新（autumn-shared 20260926225536）がまだ適用されていません。');
  return new Error(`${fallback}（${m}）`);
}

export async function sbAdminPaymentSettings(client: SupabaseClient, facilityUuid: string): Promise<AdminPaymentSettings> {
  const { data, error } = await client.schema('book').rpc('admin_payment_settings', { p_facility_id: facilityUuid });
  if (error) throw friendly(error, '支払設定を読み込めませんでした');
  const d = (data ?? {}) as Record<string, unknown>;
  const plans = (Array.isArray(d.plans) ? d.plans : []) as Record<string, unknown>[];
  return {
    earlyPrepay: normalizeEarlyPrepaySettings(d),
    cancelAdminFeePercent: normalizeAdminFeePercent(d.cancel_admin_fee_percent),
    // 列が無い（migration 未適用）ときは全部オン＝従来どおり
    paymentMethods: Array.isArray(d.payment_methods) ? normalizeOptions(FACILITY_PAY_METHODS, d.payment_methods) : [...FACILITY_PAY_METHODS],
    paymentTexts: normalizePaymentTexts(d.payment_texts),
    updatedAt: (d.updated_at as string | null) ?? null,
    plans: plans.map((p) => ({
      id: String(p.id),
      code: String(p.code ?? ''),
      name: String(p.name ?? ''),
      headline: (p.headline as string | null) ?? null,
      isActive: p.is_active === true,
      publicOnDirect: p.public_on_direct === true,
      isPublished: p.is_published === true,
      hasContent: p.has_content === true,
      paymentMethod: METHODS.includes(p.payment_method as PlanPaymentMethod) ? (p.payment_method as PlanPaymentMethod) : 'onsite',
      prepayDiscountRate: Number(p.prepay_discount_rate ?? 0) || 0,
      earlyPrepay: p.early_prepay === true,
      nonmemberPaymentMethod: METHODS.includes(p.nonmember_payment_method as PlanPaymentMethod) ? (p.nonmember_payment_method as PlanPaymentMethod) : null,
      paymentOptions: optionsOrLegacy(p.payment_options, p.payment_method) ?? ['onsite'],
      nonmemberPaymentOptions: optionsOrLegacy(p.nonmember_payment_options, p.nonmember_payment_method)
    }))
  };
}

/** 組み合わせの列があればそれ、無ければ従来の3択から（null = 未設定） */
function optionsOrLegacy(options: unknown, method: unknown): PlanPayOption[] | null {
  if (Array.isArray(options)) {
    const o = normalizeOptions(PLAN_PAY_OPTIONS, options);
    return o.length > 0 ? o : null;
  }
  switch (method) {
    case 'prepayment':
      return ['online_now', 'online_checkout'];
    case 'deposit':
      return ['onsite', 'online_now', 'online_checkout'];
    case 'onsite':
      return ['onsite'];
    default:
      return null;
  }
}

/** 施設全体の支払方法のオン/オフを保存する（管理者だけ・DB でも検査） */
export async function sbSavePaymentMethods(client: SupabaseClient, facilityUuid: string, methods: FacilityPayMethod[]): Promise<void> {
  const { error } = await client.schema('book').rpc('admin_save_payment_methods', { p_facility_id: facilityUuid, p_methods: methods });
  if (error) {
    if (error.message.includes('invalid_params')) throw new Error('支払方法を1つ以上オンにしてください。');
    throw friendly(error, '支払方法のオン/オフを保存できませんでした');
  }
}

/** 予約確認画面の支払方法の名前・説明文を保存する（管理者だけ） */
export async function sbSavePaymentTexts(client: SupabaseClient, facilityUuid: string, texts: PaymentTexts): Promise<void> {
  const { error } = await client.schema('book').rpc('admin_save_payment_texts', { p_facility_id: facilityUuid, p_texts: texts });
  if (error) {
    if (error.message.includes('text_too_long')) throw new Error('文言が長すぎます（名前は60文字、説明は600文字まで）。');
    throw friendly(error, '支払方法の文言を保存できませんでした');
  }
}

/** プランの支払方法の組み合わせと定率割引を保存する（スタッフも可） */
export async function sbSetPlanPaymentOptions(client: SupabaseClient, ratePlanId: string, options: PlanPayOption[], prepayDiscountRate: number): Promise<void> {
  const { error } = await client
    .schema('book')
    .rpc('admin_set_plan_payment_options', { p_rate_plan_id: ratePlanId, p_options: options, p_prepay_discount_rate: prepayDiscountRate });
  if (error) {
    if (error.message.includes('invalid_params')) throw new Error('支払方法を1つ以上選んでください（割引は 0〜20%）。');
    throw friendly(error, 'プランの支払方法を保存できませんでした');
  }
}

/** プランの非会員の組み合わせを保存する（null = 会員と同じ） */
export async function sbSetPlanNonmemberOptions(client: SupabaseClient, ratePlanId: string, options: PlanPayOption[] | null): Promise<void> {
  const { error } = await client
    .schema('book')
    .rpc('admin_set_plan_nonmember_options', { p_rate_plan_id: ratePlanId, p_options: options && options.length > 0 ? options : null });
  if (error) throw friendly(error, '非会員の支払方法を保存できませんでした');
}

export async function sbSaveEarlyPrepaySettings(client: SupabaseClient, facilityUuid: string, s: EarlyPrepaySettings): Promise<void> {
  const { error } = await client.schema('book').rpc('admin_save_payment_settings', {
    p_facility_id: facilityUuid,
    p_enabled: s.enabled,
    p_tiers: s.tiers,
    p_blackouts: s.blackouts,
    p_mode: s.mode
  });
  if (error) throw friendly(error, '早期決済割の設定を保存できませんでした');
}

export async function sbSetPlanEarlyPrepay(client: SupabaseClient, ratePlanId: string, enabled: boolean): Promise<void> {
  const { error } = await client.schema('book').rpc('admin_set_plan_early_prepay', { p_rate_plan_id: ratePlanId, p_enabled: enabled });
  if (error) throw friendly(error, '早期決済割の対象を保存できませんでした');
}

/** 非会員の支払方法（null で「会員と同じ」）。autumn-shared 20260926232136 */
export async function sbSetPlanNonmemberPayment(client: SupabaseClient, ratePlanId: string, method: PlanPaymentMethod | null): Promise<void> {
  const { error } = await client.schema('book').rpc('admin_set_plan_nonmember_payment', { p_rate_plan_id: ratePlanId, p_method: method });
  if (error) throw friendly(error, '非会員の支払方法を保存できませんでした');
}

/** 予約時決済の事務手数料の率を保存（管理者のみ・DB でも検査）。autumn-shared 20261007010002 */
export async function sbSaveCancelAdminFee(client: SupabaseClient, facilityUuid: string, percent: number): Promise<number> {
  const { data, error } = await client
    .schema('book')
    .rpc('admin_save_cancel_admin_fee', { p_facility_id: facilityUuid, p_percent: roundAdminFeePercent(percent) });
  if (error) {
    if (error.message.includes('Could not find the function') || error.message.includes('does not exist'))
      throw new Error('DB の更新（autumn-shared 20261007010002）がまだ適用されていません。');
    throw friendly(error, '事務手数料の率を保存できませんでした');
  }
  return normalizeAdminFeePercent(data);
}
