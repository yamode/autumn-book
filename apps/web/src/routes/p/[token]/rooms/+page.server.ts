import { logPartnerAccess, todayJst } from '$lib/server/partners/store';
import { loadPartnerContents } from '$lib/server/partners/contents';
import { deferTask, portalHeader, portalLogActor, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';

// 取引先専用ページ: お部屋（部屋タイプ）の紹介。中身は autumn-book の紹介（公式サイトと共通）。
// 紹介（写真・文章）は後から流す（contents: Promise・2026-10-10）。画面は届くまで枠を出す。
// 読めなかったときは以前の 503 の画面の代わりに、本文の位置に同じ文言を出す。アクセスログは応答を待たせない（waitUntil）
export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  deferTask(
    event,
    logPartnerAccess(db, {
      partnerId: partner.id,
      ...portalLogActor(session, { page: 'rooms' }),
      channel: 'web',
      action: 'view',
      ip: requestMeta(event).ip
    })
  );
  // オンの施設が無い取引先（N9）は紹介を出さない（ヘッダーの下に案内）
  const contents = (partner.facility_available ? loadPartnerContents(db, partner) : Promise.resolve({ rooms: [], plans: [] })).then(
    (c) => ({ rooms: c.rooms, error: null as string | null }),
    () => ({ rooms: [] as Awaited<ReturnType<typeof loadPartnerContents>>['rooms'], error: '紹介を読み込めませんでした。時間をおいてお試しください。' })
  );
  return {
    portal: portalHeader(partner, session),
    contents,
    // 「この部屋の空室・料金を見る」の部屋カレンダー用
    today: todayJst(),
    showInventory: partner.show_inventory
  };
};
