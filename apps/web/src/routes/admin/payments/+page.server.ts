// 管理画面: 支払方法の一元管理（2026-09-27 ユーザー指示）。
//   基本     … 支払手段の一覧（現地払いの内訳・オンライン決済の状態）と、早期決済割（段階表・除外期間）の設定
//   プラン別 … 料金プランごとの支払方法（現地払い／事前決済／どちらも）・定率の予約時決済割引・早期決済割の対象
//   取引先別 … 取引先ごとの支払方法（後払い／予約時決済／チェックアウト日決済＋取引先ごとの自由入力）と予約時決済割引
// 権限: 閲覧は admin / staff。早期決済割と取引先は管理者だけが保存できる（金額・返金に関わるため。キャンセル規定・取引先と同じ）。
//       プラン別はプラン画面（/admin/plans/[id]）と同じくスタッフも保存できる。
import { fail, type RequestEvent } from '@sveltejs/kit';
import { normalizeEarlyPrepaySettings, validateEarlyPrepaySettings } from '$lib/early-prepay';
import {
  hasPrepayDiscount,
  normalizePartnerBookingSettings,
  normalizePrepayDiscount,
  PARTNER_PAYMENT_OPTIONS,
  partnerPaymentChoices,
  validatePartnerBookingSettings
} from '$lib/partner-booking';
import { createSupabaseServerClient } from '$lib/server/auth';
import { LIVE, NOT_LIVE, currentFacilityOf, demoPlanContents, denyIfNotStaff, messageOf } from '$lib/server/admin-content-page';
import { PLAN_PAYMENT_METHODS, sbSetPlanPayment, type PlanPaymentMethod } from '$lib/server/content-admin';
import { directPaymentsReady } from '$lib/server/direct-payments';
import { listPartners, PARTNER_KIND_LABELS, PartnerStoreError, requireStaffPartner, updatePartner } from '$lib/server/partners/store';
import { staffPartnerScope, StaffScopeError } from '$lib/server/partners/staff';
import {
  loadEarlyPrepaySettings,
  sbAdminPaymentSettings,
  sbSaveCancelAdminFee,
  sbSaveEarlyPrepaySettings,
  sbSetPlanEarlyPrepay,
  sbSetPlanNonmemberPayment
} from '$lib/server/payment-settings';
import { adminFeePercentError, DEFAULT_ADMIN_FEE_PERCENT } from '$lib/cancel-admin-fee';
import { inlinePaymentReady } from '$lib/server/stripe';
import type { Actions, PageServerLoad } from './$types';

const isAdmin = (event: Pick<RequestEvent, 'locals'>) => event.locals.user?.role === 'admin';

export const load: PageServerLoad = async (event) => {
  const { currentFacility } = await event.parent();
  const base = {
    facilityName: currentFacility.name,
    canEditAdmin: isAdmin(event),
    partnerPaymentOptions: PARTNER_PAYMENT_OPTIONS,
    kindLabels: PARTNER_KIND_LABELS
  };
  if (!LIVE) {
    // 実データに繋がっていない環境: 画面の確認用にデモのプランと段階表の初期値を閲覧だけさせる（保存は NOT_LIVE）
    const plans = demoPlanContents(currentFacility.id).map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      headline: p.headline,
      isActive: true,
      publicOnDirect: true,
      isPublished: p.isPublished,
      hasContent: true,
      paymentMethod: (p.prepayDiscountRate > 0 ? 'deposit' : 'onsite') as PlanPaymentMethod,
      prepayDiscountRate: p.prepayDiscountRate,
      earlyPrepay: true,
      nonmemberPaymentMethod: null
    }));
    return {
      ...base,
      live: false as const,
      notLive: NOT_LIVE,
      settings: { earlyPrepay: await loadEarlyPrepaySettings(currentFacility.id), cancelAdminFeePercent: DEFAULT_ADMIN_FEE_PERCENT, updatedAt: null, plans },
      settingsError: null,
      partners: [],
      partnersError: NOT_LIVE,
      status: { directOnline: false, partnerOnline: false }
    };
  }

  const client = createSupabaseServerClient(event);
  const facility = currentFacilityOf(event);

  const [settingsR, partnersR, directReady] = await Promise.all([
    sbAdminPaymentSettings(client, facility.uuid).then(
      (s) => ({ ok: true as const, s }),
      (e) => ({ ok: false as const, e: messageOf(e) })
    ),
    staffPartnerScope(event, 'view')
      .then((scope) => listPartners(scope.db, scope.facilityId))
      .then(
        (rows) => ({ ok: true as const, rows }),
        (e) => ({ ok: false as const, e: e instanceof Error ? e.message : String(e) })
      ),
    directPaymentsReady().catch(() => false)
  ]);

  return {
    ...base,
    live: true as const,
    notLive: null,
    settings: settingsR.ok ? settingsR.s : null,
    settingsError: settingsR.ok ? null : settingsR.e,
    partners: partnersR.ok
      ? partnersR.rows.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          isActive: p.is_active,
          bookingEnabled: p.booking_enabled,
          paymentOptions: p.booking_settings.paymentOptions,
          // 固定の3種＋その取引先の自由入力の支払方法（自由入力の追加・削除は取引先の画面で）
          paymentChoices: partnerPaymentChoices(p.booking_settings),
          prepayDiscount: p.booking_settings.prepayDiscount
        }))
      : [],
    partnersError: partnersR.ok ? null : partnersR.e,
    status: { directOnline: directReady, partnerOnline: inlinePaymentReady() }
  };
};

export const actions: Actions = {
  // 早期決済割（施設ごとの段階表・除外期間・ON/OFF）
  saveEarlyPrepay: async (event) => {
    if (!isAdmin(event)) return fail(403, { scope: 'early', error: '早期決済割の設定は管理者だけが変更できます。' });
    if (!LIVE) return fail(503, { scope: 'early', error: NOT_LIVE });
    const fd = await event.request.formData();
    const days = fd.getAll('tier_days').map(String);
    const pcts = fd.getAll('tier_percent').map(String);
    const froms = fd.getAll('bo_from').map(String);
    const tos = fd.getAll('bo_to').map(String);
    const labels = fd.getAll('bo_label').map(String);
    const settings = normalizeEarlyPrepaySettings({
      enabled: fd.get('enabled') === 'on',
      mode: fd.get('mode') === 'points' ? 'points' : 'discount',
      tiers: days
        .map((d, i) => ({ days: d, percent: pcts[i] }))
        .filter((t) => String(t.days).trim() !== '' || String(t.percent ?? '').trim() !== ''),
      blackouts: froms
        .map((f, i) => ({ from: f, to: tos[i] || f, label: labels[i] ?? '' }))
        .filter((b) => b.from.trim() !== '')
    });
    // 空欄・不正な行は normalize で落ちるので、入力された行数と比べて取りこぼしを知らせる
    const typedTiers = days.filter((d, i) => d.trim() !== '' || (pcts[i] ?? '').trim() !== '').length;
    if (settings.tiers.length !== typedTiers) return fail(400, { scope: 'early', error: '段階表の日数・割引率を数字で入れてください。' });
    const typedBlackouts = froms.filter((f, i) => f.trim() !== '' || (tos[i] ?? '').trim() !== '' || (labels[i] ?? '').trim() !== '').length;
    if (settings.blackouts.length !== typedBlackouts) return fail(400, { scope: 'early', error: '除外期間の開始日を入れてください。' });
    const problem = validateEarlyPrepaySettings(settings);
    if (problem) return fail(400, { scope: 'early', error: problem });
    try {
      await sbSaveEarlyPrepaySettings(createSupabaseServerClient(event), currentFacilityOf(event).uuid, settings);
      return { scope: 'early', saved: true };
    } catch (e) {
      return fail(400, { scope: 'early', error: messageOf(e) });
    }
  },

  // 予約時決済の事務手数料（取消時に返金しない率・施設ごとに1つ・2026-10-07）。金額・返金に関わるので管理者だけ（DB でも検査）
  saveAdminFee: async (event) => {
    if (!isAdmin(event)) return fail(403, { scope: 'adminFee', error: '事務手数料の率は管理者だけが変更できます。' });
    if (!LIVE) return fail(503, { scope: 'adminFee', error: NOT_LIVE });
    const fd = await event.request.formData();
    const raw = String(fd.get('percent') ?? '').trim();
    // 決済手数料（3.6%）以下・0%（事務手数料なし）は保存できない（lib/cancel-admin-fee.ts・DB の check と同じ）
    const problem = adminFeePercentError(raw);
    if (problem) return fail(400, { scope: 'adminFee', error: problem });
    try {
      await sbSaveCancelAdminFee(createSupabaseServerClient(event), currentFacilityOf(event).uuid, Number(raw));
      return { scope: 'adminFee', saved: true };
    } catch (e) {
      return fail(400, { scope: 'adminFee', error: messageOf(e) });
    }
  },

  // プラン別（支払方法・定率割引・早期決済割の対象）
  savePlan: async (event) => {
    const denied = denyIfNotStaff(event);
    if (denied) return denied;
    if (!LIVE) return fail(503, { scope: 'plan', error: NOT_LIVE });
    const fd = await event.request.formData();
    const planId = String(fd.get('planId') ?? '');
    const method = String(fd.get('method') ?? '');
    if (!(PLAN_PAYMENT_METHODS as readonly string[]).includes(method)) {
      return fail(400, { scope: 'plan', planId, error: '支払方法を選んでください。' });
    }
    const pct = method === 'onsite' ? 0 : Math.round(Number(fd.get('discount') ?? 0));
    if (!Number.isFinite(pct) || pct < 0 || pct > 20) {
      return fail(400, { scope: 'plan', planId, error: '定率の割引は 0〜20% で選んでください。' });
    }
    const early = fd.get('early') === 'on';
    // 非会員の支払方法（空 = 会員と同じ）
    const nm = String(fd.get('nonmember') ?? '');
    const nonmember = (PLAN_PAYMENT_METHODS as readonly string[]).includes(nm) ? (nm as PlanPaymentMethod) : null;
    const client = createSupabaseServerClient(event);
    try {
      await sbSetPlanPayment(client, planId, method as PlanPaymentMethod, pct / 100);
      await sbSetPlanEarlyPrepay(client, planId, early);
      await sbSetPlanNonmemberPayment(client, planId, nonmember);
      return { scope: 'plan', planId, saved: true };
    } catch (e) {
      return fail(400, { scope: 'plan', planId, error: messageOf(e) });
    }
  },

  // 取引先別（支払方法・予約時決済割引）。他の予約受付の設定は取引先の画面で
  savePartner: async (event) => {
    const fd = await event.request.formData();
    const partnerId = String(fd.get('partnerId') ?? '');
    try {
      const scope = await staffPartnerScope(event, 'edit');
      const partner = await requireStaffPartner(scope.db, scope.facilityId, partnerId);
      // 自由入力の支払方法もチェックで選べる（定義そのものは取引先の画面で編集。ここでは選べるかどうかだけ）
      const paymentOptions = partnerPaymentChoices(partner.booking_settings)
        .map((o) => o.id)
        .filter((id) => fd.get(`pay_${id}`) === 'on');
      const prepayDiscount = normalizePrepayDiscount({ type: fd.get('discount_type'), value: fd.get('discount_value') });
      if (paymentOptions.includes('online') === false && hasPrepayDiscount(prepayDiscount)) {
        return fail(400, { scope: 'partner', partnerId, error: '予約時決済割引は「オンライン決済（予約時）」を許可したときだけ設定できます。' });
      }
      // 既存の設定（自由入力の支払方法・特典・受付ルールなど）は残し、支払方法と割引だけ差し替える
      const settings = normalizePartnerBookingSettings({ ...partner.booking_settings, paymentOptions, prepayDiscount });
      const problem = validatePartnerBookingSettings(settings, partner.booking_enabled);
      if (problem) return fail(400, { scope: 'partner', partnerId, error: problem });
      await updatePartner(scope.db, partner, scope.userId, { booking_settings: settings });
      return { scope: 'partner', partnerId, saved: true };
    } catch (e) {
      if (e instanceof StaffScopeError || e instanceof PartnerStoreError) {
        return fail(e.status, { scope: 'partner', partnerId, error: e.message });
      }
      return fail(500, { scope: 'partner', partnerId, error: e instanceof Error ? e.message : String(e) });
    }
  }
};
