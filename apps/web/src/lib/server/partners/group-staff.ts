// 管理画面の団体照会（/admin/group-inquiries/**・docs/partner-group-booking.md §8.3）の入口。
//
// 取引先の管理画面と同じ流儀（staff.ts）: 役割は admin / staff、施設へのアクセスはログイン中スタッフの権限（RLS）で確かめてから
// service_role で触る。団体照会は ab_fac の施設に限らず、スタッフがアクセスできる Book の施設すべてを見せる（施設で絞り込める）。
// 回答はスタッフでもできる（§7.9）。料金の変更・受付枠超過の承認は管理者だけ（N2・group-inquiries.ts の answerGroupInquiry が見る）。
import type { RequestEvent } from '@sveltejs/kit';
import { facilities } from '$lib/server/store';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { staffHasFacilityAccess, staffPartnerScope, type StaffPartnerScope } from './staff';
import type { GroupStaff } from './group-inquiries';

export type StaffGroupScope = {
  scope: StaffPartnerScope;
  /** スタッフがアクセスできる Book の施設（core.facilities の UUID・Book の ID・名前） */
  facilities: { id: string; bookId: string; name: string }[];
  staff: GroupStaff;
};

/** 入口: 役割・ab_fac の施設へのアクセス（staffPartnerScope('view')）と、ほかの Book の施設へのアクセスを確かめる */
export async function staffGroupScope(event: RequestEvent): Promise<StaffGroupScope> {
  const scope = await staffPartnerScope(event, 'view');
  const list: StaffGroupScope['facilities'] = [];
  for (const f of facilities) {
    const id = FACILITY_UUID[f.id];
    if (!id) continue;
    if (id === scope.facilityId || (await staffHasFacilityAccess(event, id).catch(() => false))) list.push({ id, bookId: f.id, name: f.name });
  }
  const user = event.locals.user;
  // answered_by は uuid 列（auth.users.id）。uuid でない id（デモのセッション等）は残さない
  const userId = user?.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user.id) ? user.id : null;
  return { scope, facilities: list, staff: { userId, name: user?.name ?? '', isAdmin: user?.role === 'admin' } };
}
