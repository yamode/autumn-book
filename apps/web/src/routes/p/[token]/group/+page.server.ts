// 取引先ページ: 団体予約の一覧（docs/partner-group-booking.md §8.1）。
// 出すのは取引先の種類が旅行会社（kind='agent'）で、管理画面で団体予約をオンにしている取引先だけ（それ以外は 404）。
// 一覧は取引先の全施設の照会（新しい順）。承諾・辞退・取り下げは詳細（./[id]）の form action へ POST する（一覧の行からも同じ先へ）。
import { error } from '@sveltejs/kit';
import { canAccept, canReject, canWithdrawBy, GROUP_STATUS_LABELS_PARTNER, GROUP_STATUS_TABS, groupInquiryAvailable, groupInquiryBlockReason } from '$lib/partner-group';
import { listPartnerGroupInquiries } from '$lib/server/partners/group-inquiries';
import { PartnerStoreError } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requirePortalSession } from '$lib/server/partners/portal';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  if (!groupInquiryAvailable(partner)) throw error(404, 'ページが見つかりません。');
  let loadError: string | null = null;
  const inquiries = await listPartnerGroupInquiries(db, partner).catch((e) => {
    loadError = e instanceof PartnerStoreError ? e.message : '団体予約の照会を読み込めませんでした。';
    return [];
  });
  const viewer = { id: session.id, is_master: session.is_master === true };
  const now = new Date();
  return {
    portal: portalHeader(partner, session),
    inquiries: inquiries.map((r) => ({
      ...r,
      // 行のボタン（表示用。押したときにサーバで確かめ直す）
      actions: {
        accept: !session.preview && canAccept(r, now),
        reject: !session.preview && canReject(r),
        withdraw: !session.preview && canWithdrawBy(r, viewer)
      }
    })),
    statusTabs: GROUP_STATUS_TABS,
    statusLabels: GROUP_STATUS_LABELS_PARTNER,
    // 選んでいる施設で新しい照会を送れない理由（送れるなら null）。「新しい照会」ボタンの代わりに出す
    blockReason: groupInquiryBlockReason(partner),
    // ?done=batch（送信の直後）/ ?done=accepted 等の表示用
    done: event.url.searchParams.get('done'),
    loadError
  };
};
