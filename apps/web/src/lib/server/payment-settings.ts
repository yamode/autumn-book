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
};

export type AdminPaymentSettings = {
  earlyPrepay: EarlyPrepaySettings;
  updatedAt: string | null;
  plans: AdminPaymentPlan[];
};

const METHODS: PlanPaymentMethod[] = ['onsite', 'prepayment', 'deposit'];

function friendly(e: { message: string }, fallback: string): Error {
  const m = e.message;
  if (m.includes('forbidden'))
    return new Error('この施設の支払設定を変更する権限がありません（早期決済割の保存はテナント管理者だけができます）。');
  if (m.includes('not_found')) return new Error('施設またはプランが見つかりません。');
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
      earlyPrepay: p.early_prepay === true
    }))
  };
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
