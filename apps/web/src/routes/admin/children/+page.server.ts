// 管理画面: お子様の受け入れ（区分ごとの可否・2026-10-03）。施設で1件・全プラン共通。
// 取引先ページのプラン紹介「お子様について」に出る（未設定の施設は rms の区分コードから案内文を出す）。
// 保存先は book.facility_child_policies（RPC facility_child_policy_admin / _upsert。autumn-shared 20261003051130）。
// 流儀は /admin/bath と同じ（実データに繋がっていないときは保存させない・admin と staff が編集できる）。
import { fail } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { currentFacilityOf, denyIfNotStaff, LIVE, messageOf, NOT_LIVE } from '$lib/server/admin-content-page';
import { normalizeChildPolicy, type TermsRow } from '$lib/partner-plan-terms';
import type { Actions, PageServerLoad } from './$types';

// 未設定の施設に最初に出す区分（内容は空。入れた行だけ保存される）
const TEMPLATE_ROWS: TermsRow[] = [
  { label: '小学生高学年', value: '' },
  { label: '小学生低学年', value: '' },
  { label: '幼児（食事・布団あり）', value: '' },
  { label: '幼児（食事のみ）', value: '' },
  { label: '幼児（布団のみ）', value: '' },
  { label: '幼児（食事・布団なし）', value: '' },
  { label: '添い寝', value: '' }
];

export const load: PageServerLoad = async (event) => {
  const fac = currentFacilityOf(event);
  const base = { facilityName: fac.name, live: LIVE, template: TEMPLATE_ROWS };
  if (!LIVE) return { ...base, policy: null, updatedAt: null, loadError: NOT_LIVE };
  try {
    const { data, error } = await createSupabaseServerClient(event)
      .schema('book')
      .rpc('facility_child_policy_admin', { p_facility: fac.uuid });
    if (error) throw error;
    const raw = data as { rows?: unknown; note?: unknown; updated_at?: string } | null;
    return { ...base, policy: normalizeChildPolicy(raw), updatedAt: raw?.updated_at ?? null, loadError: null };
  } catch (e) {
    return { ...base, policy: null, updatedAt: null, loadError: messageOf(e) };
  }
};

export const actions: Actions = {
  save: async (event) => {
    const denied = denyIfNotStaff(event);
    if (denied) return denied;
    if (!LIVE) return fail(503, { error: NOT_LIVE });
    const fd = await event.request.formData();
    let raw: unknown = {};
    try {
      raw = JSON.parse(String(fd.get('payload') ?? '{}'));
    } catch {
      return fail(400, { error: '入力を読み取れませんでした。' });
    }
    // 区分と内容の両方がある行だけ保存する
    const policy = normalizeChildPolicy(raw) ?? { rows: [], note: '' };
    try {
      const { error } = await createSupabaseServerClient(event)
        .schema('book')
        .rpc('facility_child_policy_upsert', { p_facility: currentFacilityOf(event).uuid, p_rows: policy.rows, p_note: policy.note });
      if (error) throw error;
      return { saved: true };
    } catch (e) {
      return fail(400, { error: messageOf(e) });
    }
  }
};
