// 管理画面: 「確認ページを開く」。取引先のアカウントを使わずに、その取引先から見た取引先ページを開く（確認モード）。
// 権限（admin / staff・この施設の取引先か）を確かめてから、署名付きのクッキーを /p/<urlToken> に置いて料金カレンダーへ。
// 確認モードは見るだけで、予約の確定・取消・保存はできない（$lib/server/partners/preview.ts）。
// ?f=<施設の slug>（詳細の施設タブ）を取引先ページへ渡す（取引先ページはオンの施設なら ?f= の施設で開く・2026-10-09 複数施設化 S3）。
import { error, redirect } from '@sveltejs/kit';
import { PartnerStoreError } from '$lib/server/partners/store';
import { staffPartnerScope, staffPartnerView, StaffScopeError } from '$lib/server/partners/staff';
import { issuePreviewToken, setPreviewCookie } from '$lib/server/partners/preview';

export const GET = async (event) => {
  let scope;
  try {
    scope = await staffPartnerScope(event, 'view');
  } catch (e) {
    if (e instanceof StaffScopeError) throw error(e.status, e.message);
    throw e;
  }
  let partner;
  try {
    // 取引先の施設のどれかにアクセスできれば開ける（詳細と同じ）
    partner = (await staffPartnerView(event, scope, event.params.id)).partner;
  } catch (e) {
    if (e instanceof PartnerStoreError) throw error(404, '取引先が見つかりません。');
    throw e;
  }
  const token = await issuePreviewToken(partner.id);
  if (!token) throw error(503, '確認ページを開けません（サーバの設定が足りません）。');
  setPreviewCookie(event.cookies, partner.url_token, token);
  const slug = event.url.searchParams.get('f') ?? '';
  const facilityQuery = /^[a-z0-9-]{1,40}$/i.test(slug) && partner.facilities.some((f) => f.slug === slug) ? `?f=${encodeURIComponent(slug)}` : '';
  throw redirect(303, `/p/${partner.url_token}/calendar${facilityQuery}`);
};
