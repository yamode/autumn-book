// スタッフの販売ページプレビュー（v0.230.0）。
//
// 販売中でないプラン（販売停止中・販売表示期間の外）を、スタッフ（admin / staff）が販売ページの見た目のまま
// 本物の在庫・客室・料金で確かめ、仮押さえして予約入力画面まで進めるようにする。予約の確定はできない。
//
// DB は service_role の呼び出しに x-book-preview-plan ヘッダーがあるときだけ、そのプラン 1 つを販売中と同じに扱う
// （autumn-shared 20261101073819・$lib/server/partners/admin-client の previewServiceClient）。
// スタッフかどうかはここで確かめる。お客様の画面からは使わない。
//
// ⚠ プレビューの仮押さえは本物の在庫を期限まで（または「選び直す」まで）押さえる（ユーザー確認済み・2026-11-01）。
import { DATA_SOURCE } from '$lib/server/supabase';
import { previewServiceClient } from '$lib/server/partners/admin-client';
import { mapPlanRow, sbPlanByUuid } from '$lib/server/supabase-data';
import type { RatePlan } from '$lib/types';

type Locals = { user?: { role?: string } | null };

/** プレビューできる役割か（管理画面に入れる人） */
export function isStaffViewer(locals: Locals): boolean {
	const role = locals.user?.role;
	return role === 'admin' || role === 'staff';
}

/** プレビュー中のプランを販売ページの形で読む（販売中でなくても読める）。読めなければ undefined */
export async function previewPlanByUuid(ratePlanId: string): Promise<RatePlan | undefined> {
	if (DATA_SOURCE !== 'supabase') return undefined;
	const sb = previewServiceClient(ratePlanId);
	if (!sb) return undefined;
	const { data, error } = await sb.schema('book').from('v_plans').select('*').eq('rate_plan_id', ratePlanId).maybeSingle();
	if (error) throw error;
	return data ? mapPlanRow(data as Record<string, unknown>) : undefined;
}

/**
 * id でプランを引く。販売中なら普通に、販売中でなければスタッフのときだけプレビューとして読む。
 * preview=true のプランは予約を確定させない。
 */
export async function planOrPreview(ratePlanId: string, locals: Locals): Promise<{ plan: RatePlan; preview: boolean } | undefined> {
	const plan = await sbPlanByUuid(ratePlanId);
	if (plan) return { plan, preview: false };
	if (!isStaffViewer(locals)) return undefined;
	const preview = await previewPlanByUuid(ratePlanId).catch(() => undefined);
	return preview ? { plan: preview, preview: true } : undefined;
}

/**
 * 仮押さえの前に: 束のプランのうち販売中でないものを調べ、スタッフのプレビューならそのプランの id を返す。
 *   - 全部販売中 → { previewPlanId: undefined }（普通の仮押さえ）
 *   - スタッフで、販売中でないプランが 1 つ → { previewPlanId }（DB にはヘッダーで 1 つしか渡せない）
 *   - それ以外 → { error }（お客様は従来どおり DB が plan_not_found で断る）
 */
export async function previewPlanForHold(planIds: string[], locals: Locals): Promise<{ previewPlanId?: string; error?: 'invalid' }> {
	if (DATA_SOURCE !== 'supabase' || !isStaffViewer(locals)) return {};
	const ids = [...new Set(planIds)];
	const onSale = await Promise.all(ids.map((id) => sbPlanByUuid(id).catch(() => undefined)));
	const off = ids.filter((_, i) => !onSale[i]);
	if (off.length === 0) return {};
	if (off.length > 1) return { error: 'invalid' };
	return (await previewPlanByUuid(off[0]).catch(() => undefined)) ? { previewPlanId: off[0] } : { error: 'invalid' };
}
