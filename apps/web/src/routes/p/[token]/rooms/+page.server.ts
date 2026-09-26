import { error } from '@sveltejs/kit';
import { logPartnerAccess } from '$lib/server/partners/store';
import { loadPartnerContents } from '$lib/server/partners/contents';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';

// 取引先専用ページ: お部屋（部屋タイプ）の紹介。中身は autumn-book の紹介（公式サイトと共通）。
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  let contents;
  try {
    contents = await loadPartnerContents(db, partner);
  } catch {
    throw error(503, '紹介を読み込めませんでした。時間をおいてお試しください。');
  }
  await logPartnerAccess(db, {
    partnerId: partner.id,
    accountId: session.id,
    channel: 'web',
    action: 'view',
    detail: { page: 'rooms' },
    ip: requestMeta(event).ip
  });
  return {
    portal: portalHeader(partner, session),
    rooms: contents.rooms
  };
};
