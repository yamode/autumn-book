// 取引先ページの施設切替（docs/partner-multi-facility.md §7.8・決定 N1・2026-10-09 複数施設化 S4）。
//   POST /p/<token>/facility  f=<施設の slug>&next=<戻るページ>
// 選んだ施設をクッキー rms_partner_facility（path /p/<token>・1年）に入れ、元のページへ 303 で戻す。
// オンでない・知らない施設なら何も変えずに戻す（ヘッダーの切替はオンの施設しか出さない）。
// ログイン前・確認モード（管理画面の「確認ページを開く」）でも使える（見る施設を変えるだけで、予約・保存はしない）。
import { redirect, type RequestHandler } from '@sveltejs/kit';
import { facilitySwitchTarget, resolvePortal, setPartnerFacilityCookie } from '$lib/server/partners/portal';

export const POST: RequestHandler = async (event) => {
  const token = event.params.token ?? '';
  const { partner } = await resolvePortal(event);
  const fd = await event.request.formData();
  const slug = String(fd.get('f') ?? '').trim();
  const target = partner.facilities.find((f) => f.enabled && f.slug === slug);
  if (target) setPartnerFacilityCookie(event.cookies, token, target.slug);
  throw redirect(303, facilitySwitchTarget(token, String(fd.get('next') ?? '')));
};
