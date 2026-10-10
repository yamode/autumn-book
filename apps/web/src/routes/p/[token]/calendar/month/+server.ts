// 料金カレンダーの月・人数切替用 JSON（ページ遷移せずに取得し、前後の月は画面側で先読みする）。
// 先読み（view=0）はアクセスログに残さず、実際に表示した月（view=1）だけ記録する。
import { error, json } from '@sveltejs/kit';
import { logPartnerAccess, partnerUnavailableReason } from '$lib/server/partners/store';
import { parsePortalQuery } from '$lib/server/partners/portal-month';
import { getPortalMonth } from '$lib/server/partners/portal-reference';
import { todayJst } from '$lib/server/partners/store';
import { PORTAL_HEADERS, requestMeta, resolvePortal } from '$lib/server/partners/portal';

const pad = (n: number) => String(n).padStart(2, '0');

export const GET = async (event) => {
  const { db, partner, session } = await resolvePortal(event);
  if (!session) throw error(401, 'ログインしてください。');
  const unavailable = partnerUnavailableReason(partner);
  // 管理画面からの確認モードは公開停止中でも見られる
  if (unavailable && !session.preview) throw error(403, unavailable);

  const q = parsePortalQuery(event.url);
  const view = event.url.searchParams.get('view') === '1';
  const [body] = await Promise.all([
    // KV に一時保存（portal-month-cache.ts）。日付未指定の最安（portal-reference.ts）と共通
    getPortalMonth(event, db, partner, q, todayJst()),
    view
      ? logPartnerAccess(db, {
          partnerId: partner.id,
          accountId: session.id,
          channel: 'web',
          action: 'view',
          detail: { month: `${q.year}-${pad(q.month)}`, guests: q.guests },
          ip: requestMeta(event).ip
        })
      : Promise.resolve()
  ]);
  return json(body, { headers: PORTAL_HEADERS });
};
