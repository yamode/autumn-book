// 取引先専用ページの「お部屋」「プラン」の紹介を読む（正本は autumn-book の book.*_contents）。
// RPC rms_partner_contents（service_role 専用）で施設ぶんをまとめて取り、取引先のルールで絞る。
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildPartnerContents } from '$lib/partner-contents';
import { expandPlanText } from '$lib/plan-templates';
import { loadPlanTemplates } from '$lib/server/plan-templates';
import type { PartnerContext } from './store';

// 紹介は滅多に変わらないので、施設ごとに短時間だけ使い回す（Worker の isolate 内だけ）。
const TTL_MS = 60 * 1000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function loadFacilityContents(db: SupabaseClient, facilityId: string): Promise<unknown> {
  const hit = cache.get(facilityId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = (async () => {
    const { data, error } = await db.rpc('rms_partner_contents', { p_facility: facilityId });
    if (error) throw new Error(`紹介の読み込みに失敗しました: ${error.message}`);
    return data;
  })();
  cache.set(facilityId, { at: Date.now(), value });
  value.catch(() => cache.delete(facilityId));
  return value;
}

// 紹介文はテンプレートの差し込み印（{{tpl:key}}）を展開し、「特典」のテンプレート（公式HP限定特典）は本文から外す。
// 公式HP限定特典は、取引先の設定（showOfficialPerks）で出すときだけ officialPerks に入れる。
export async function loadPartnerContents(db: SupabaseClient, partner: Pick<PartnerContext, 'facility_id' | 'pricing'> & { booking_settings?: { showOfficialPerks?: boolean } }) {
  const [raw, templates] = await Promise.all([loadFacilityContents(db, partner.facility_id), loadPlanTemplates(partner.facility_id)]);
  const contents = buildPartnerContents(raw, partner.pricing);
  const showOfficial = partner.booking_settings?.showOfficialPerks === true;
  return {
    ...contents,
    plans: contents.plans.map((p) => {
      const { text, perks } = expandPlanText(p.description, templates);
      return { ...p, description: text, officialPerks: showOfficial ? perks : [] };
    })
  };
}
