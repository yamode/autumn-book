// 管理画面: 団体照会の一覧（全取引先・docs/partner-group-booking.md §8.3）。
// 見せるのはスタッフがアクセスできる Book の施設の照会（ab_fac に限らない・?fac= で絞る）。閲覧・回答は admin / staff。
// 束の一括回答（?/answerBatch・「全件を受けられるにする」）もここ。料金を変える回答は詳細（./[id]）で管理者が行う。
import { fail } from '@sveltejs/kit';
import {
  GROUP_ANSWER_LABELS,
  GROUP_INQUIRY_STATUSES,
  GROUP_QUOTE_STATUS_TEXT,
  GROUP_STATUS_LABELS_STAFF,
  type GroupInquiryStatus
} from '$lib/partner-group';
import { answerGroupBatch, listStaffGroupInquiries, type StaffGroupInquiry } from '$lib/server/partners/group-inquiries';
import { staffGroupScope } from '$lib/server/partners/group-staff';
import { actionFailure, StaffScopeError } from '$lib/server/partners/staff';
import { PartnerStoreError } from '$lib/server/partners/store';
import type { Actions, PageServerLoad } from './$types';

/** ?status= の読み取り: open（既定・回答待ち＋回答済み）/ all / カンマ区切りの状態 */
function parseStatuses(raw: string | null): { key: string; statuses: GroupInquiryStatus[] } {
  const v = String(raw ?? '').trim();
  if (!v || v === 'open') return { key: 'open', statuses: ['submitted', 'offered'] };
  if (v === 'all') return { key: 'all', statuses: [] };
  const list = v.split(',').filter((s): s is GroupInquiryStatus => (GROUP_INQUIRY_STATUSES as readonly string[]).includes(s));
  return list.length ? { key: list.join(','), statuses: list } : { key: 'open', statuses: ['submitted', 'offered'] };
}

export const load: PageServerLoad = async (event) => {
  const q = event.url.searchParams;
  const status = parseStatuses(q.get('status'));
  const filters = { status: status.key, fac: q.get('fac') ?? '', partner: q.get('partner') ?? '', from: q.get('from') ?? '', to: q.get('to') ?? '' };
  const base = {
    filters,
    statusLabels: GROUP_STATUS_LABELS_STAFF,
    answerLabels: GROUP_ANSWER_LABELS,
    quoteText: GROUP_QUOTE_STATUS_TEXT,
    isAdmin: event.locals.user?.role === 'admin'
  };
  try {
    const { scope, facilities } = await staffGroupScope(event);
    const fac = facilities.find((f) => f.bookId === filters.fac || f.id === filters.fac);
    const inquiries = await listStaffGroupInquiries(scope.db, {
      tenantId: scope.tenantId,
      facilityIds: fac ? [fac.id] : facilities.map((f) => f.id),
      statuses: status.statuses,
      partnerId: filters.partner || null,
      from: filters.from || null,
      to: filters.to || null
    });
    // 束ごとにまとめる（一覧は束を1枚のカードで出す。並びは新しい束から・束の中は batch_seq）
    const batches: { batchId: string; partnerId: string | null; partnerName: string; createdAt: string; items: StaffGroupInquiry[] }[] = [];
    const byBatch = new Map<string, (typeof batches)[number]>();
    for (const r of inquiries) {
      let b = byBatch.get(r.batch_id);
      if (!b) {
        b = { batchId: r.batch_id, partnerId: r.partner_id, partnerName: r.partner_name, createdAt: r.created_at, items: [] };
        byBatch.set(r.batch_id, b);
        batches.push(b);
      }
      b.items.push(r);
    }
    for (const b of batches) b.items.sort((x, y) => x.batch_seq - y.batch_seq);
    // 取引先の絞り込みの選択肢（読み込んだ照会に出てくる取引先）
    const partners = [...new Map(inquiries.filter((r) => r.partner_id).map((r) => [r.partner_id!, r.partner_name])).entries()].map(([id, name]) => ({ id, name }));
    return {
      ...base,
      live: true,
      error: null as string | null,
      facilities: facilities.map((f) => ({ id: f.bookId, name: f.name })),
      partners,
      inquiries,
      batches
    };
  } catch (e) {
    if (e instanceof StaffScopeError || e instanceof PartnerStoreError) {
      const live = !(e instanceof StaffScopeError && (e.code === 'not_live' || e.code === 'service_unconfigured'));
      return { ...base, live, error: e.message, facilities: [], partners: [], inquiries: [] as StaffGroupInquiry[], batches: [] };
    }
    throw e;
  }
};

export const actions: Actions = {
  // 束の「全件を受けられるにする」: fields batchId・message（任意）・expiresOn（任意 YYYY-MM-DD）
  // 返り値 { batchAnswered: number, skipped: [{inquiryCode, reason}], mailed: number（メールを実際に送れた件数） }
  answerBatch: async (event) => {
    try {
      const { scope, facilities, staff } = await staffGroupScope(event);
      const fd = await event.request.formData();
      const expiresOn = String(fd.get('expiresOn') ?? '').trim();
      const r = await answerGroupBatch(
        scope.db,
        staff,
        { tenantId: scope.tenantId, facilityIds: facilities.map((f) => f.id) },
        String(fd.get('batchId') ?? ''),
        // 形・実在の検証は answerGroupBatch（不正なら 400）
        { message: String(fd.get('message') ?? '').trim(), expiresOn: expiresOn.slice(0, 20) || null },
        { origin: event.url.origin }
      );
      if (!r.answered.length) return fail(400, { message: '回答できる照会がありませんでした。', skipped: r.skipped });
      return { batchAnswered: r.answered.length, skipped: r.skipped, mailed: r.mailed };
    } catch (e) {
      return actionFailure(e);
    }
  }
};
