// プラン紹介文のテンプレートブロック（book.plan_text_templates・autumn-shared 20261005234553）。
// 読み込み: 公開情報なので anon（supa()）で読む（公式サイトのプラン詳細・取引先ページで展開する）。
// 書き込み: 管理画面からログイン中スタッフの権限で RPC（admin_save_plan_text_template／admin_delete_plan_text_template）。
// 一括置き換え: 同じ見出し・同じ本文のブロックを {{tpl:key}} に置き換えて book.plan_contents を更新する。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';
import { expandPlanText, replaceBlockWithToken, usedTemplateKeys, type PlanPerkBlock, type PlanTextTemplate } from '$lib/plan-templates';

type Row = Record<string, unknown>;
const mapRow = (r: Row): PlanTextTemplate => ({
  id: String(r.id),
  key: String(r.key),
  title: String(r.title ?? ''),
  body: String(r.body ?? ''),
  kind: r.kind === 'perk' ? 'perk' : 'body',
  bannerLabel: (r.banner_label as string | null) ?? null,
  sortOrder: Number(r.sort_order ?? 0)
});

/** 施設のテンプレート（並び順）。読めなければ空（紹介文はそのまま出す） */
export async function loadPlanTemplates(facilityUuid: string, client?: SupabaseClient): Promise<PlanTextTemplate[]> {
  if (DATA_SOURCE !== 'supabase' && !client) return [];
  try {
    const db = client ? client.schema('book') : supa();
    const { data, error } = await db.from('plan_text_templates').select('*').eq('facility_id', facilityUuid).order('sort_order').order('key');
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapRow);
  } catch (e) {
    console.error('[plan-templates] load', e instanceof Error ? e.message : String(e));
    return [];
  }
}

/** 紹介文を表示用に展開する（テンプレートを読んでから） */
export async function expandForFacility(facilityUuid: string, description: string): Promise<{ text: string; perks: PlanPerkBlock[] }> {
  return expandPlanText(description, await loadPlanTemplates(facilityUuid));
}

export type TemplateInput = {
  id?: string;
  key: string;
  title: string;
  body: string;
  kind: 'body' | 'perk';
  bannerLabel: string | null;
  sortOrder: number;
};

const RPC_MESSAGES: Record<string, string> = {
  invalid_key: 'キーは半角の英小文字・数字・ハイフン・下線で40文字までにしてください（例: breakfast）。',
  invalid_title: '見出しを80文字以内で入れてください。',
  invalid_body: '本文が長すぎます。',
  invalid_banner_label: '特典のときはバナーの文字（30文字まで）を入れてください。',
  duplicate_key: '同じキーのテンプレートがあります。',
  forbidden: '編集権限がありません。'
};
export const templateErrorMessage = (e: unknown) => {
  const m = e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  const hit = Object.keys(RPC_MESSAGES).find((k) => m.includes(k));
  return hit ? RPC_MESSAGES[hit] : m;
};

export async function saveTemplate(client: SupabaseClient, facilityUuid: string, t: TemplateInput): Promise<string> {
  const { data, error } = await client.schema('book').rpc('admin_save_plan_text_template', {
    p_id: t.id ?? null,
    p_facility_id: facilityUuid,
    p_key: t.key,
    p_title: t.title,
    p_body: t.body,
    p_kind: t.kind,
    p_banner_label: t.bannerLabel,
    p_sort_order: t.sortOrder
  });
  if (error) throw error;
  return String(data);
}

export async function deleteTemplate(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.schema('book').rpc('admin_delete_plan_text_template', { p_id: id });
  if (error) throw error;
}

export type PlanUsage = { ratePlanId: string; name: string; description: string };

/** 施設のプランの紹介文（テンプレートの使われ方・一括置き換え用） */
export async function listPlanTexts(client: SupabaseClient, facilityUuid: string): Promise<PlanUsage[]> {
  const { data, error } = await client
    .schema('book')
    .from('plan_contents')
    .select('rate_plan_id, headline, slug, description')
    .eq('facility_id', facilityUuid)
    .order('sort_order');
  if (error) throw error;
  return ((data ?? []) as Row[]).map((r) => ({
    ratePlanId: String(r.rate_plan_id),
    name: String(r.headline || r.slug || ''),
    description: String(r.description ?? '')
  }));
}

export const plansUsing = (plans: PlanUsage[], key: string) => plans.filter((p) => usedTemplateKeys(p.description).includes(key));

/**
 * 同じ見出し・同じ本文のブロックを差し込み印に置き換える。本文が違うプランは触らずに名前を返す。
 */
export async function replaceBlocks(
  client: SupabaseClient,
  facilityUuid: string,
  template: PlanTextTemplate
): Promise<{ replaced: string[]; different: string[] }> {
  const plans = await listPlanTexts(client, facilityUuid);
  const replaced: string[] = [];
  const different: string[] = [];
  for (const p of plans) {
    const r = replaceBlockWithToken(p.description, template);
    if (r.result === 'different') different.push(p.name);
    if (r.result !== 'replaced') continue;
    const { error } = await client
      .schema('book')
      .from('plan_contents')
      .update({ description: r.text })
      .eq('facility_id', facilityUuid)
      .eq('rate_plan_id', p.ratePlanId);
    if (error) throw error;
    replaced.push(p.name);
  }
  return { replaced, different };
}
