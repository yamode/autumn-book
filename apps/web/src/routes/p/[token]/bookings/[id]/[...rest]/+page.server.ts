// 旧・特別会員のご予約の変更・アレンジ（/p/<token>/bookings/<予約番号>/amend・/amend/room/<n>・/options）の受け口（2026-11-27）。
// 上の +page.server.ts と同じく、resolvePortal を通して公式サイトのマイページへ転送させる。
// 取引先の添付（/bookings/<id>/attachments）は、より具体的なルートが先に当たるのでここには来ない。
import { error } from '@sveltejs/kit';
import { resolvePortal } from '$lib/server/partners/portal';

export const load = async (event) => {
  await resolvePortal(event);
  throw error(404, 'ページが見つかりません。');
};
