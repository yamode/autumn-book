// 旧・特別会員のご予約の詳細（/p/<token>/bookings/<予約番号>）の受け口（2026-11-27）。
// 特別会員の予約は公式サイトのマイページ（/account/reservations/<予約番号>）へ移した（docs/private-book.md）。
// 確定メールなどに載った古い URL がここへ来るので、ページは無くても resolvePortal を通して転送させる
// （特別会員のページなら memberPortalForward の行き先へ 303）。取引先にはこのページは元から無い（404）。
import { error } from '@sveltejs/kit';
import { resolvePortal } from '$lib/server/partners/portal';

export const load = async (event) => {
  await resolvePortal(event);
  throw error(404, 'ページが見つかりません。');
};
