// 取引先向け REST API: この取引先に販売している施設（オンの施設）の一覧（2026-10-09 複数施設化 S5b・§7.10）。
//
//   GET /api/partner/v1/facilities
//   Authorization: Bearer rmsp_xxxxxxxx
//
// 応答: { partner: { name }, defaultFacility: <slug|null>, facilities: [{ slug, name }] }
//   slug は GET /api/partner/v1/rates の facility に渡す値（rates の応答の facility.code と同じ）。
//   defaultFacility は facility を省略できるとき（オンの施設が1つ）だけその slug、2つ以上・0 なら null。
import { json, type RequestHandler } from '@sveltejs/kit';
import { logPartnerAccess } from '$lib/server/partners/store';
import { requestMeta } from '$lib/server/partners/portal';
import { apiFacilityList, authenticatePartnerApi, bundleApiFacilities, PARTNER_API_HEADERS, partnerApiOptions } from '$lib/server/partners/api';

export const OPTIONS: RequestHandler = () => partnerApiOptions();

export const GET: RequestHandler = async (event) => {
  const auth = await authenticatePartnerApi(event);
  if (auth instanceof Response) return auth;
  const facilities = apiFacilityList(bundleApiFacilities(auth.bundle));
  await logPartnerAccess(auth.db, {
    partnerId: auth.partner.id,
    apiKeyId: auth.apiKeyId,
    channel: 'api',
    action: 'facilities',
    ip: requestMeta(event).ip
  });
  return json(
    {
      partner: { name: auth.partner.name },
      defaultFacility: facilities.length === 1 ? facilities[0].slug : null,
      facilities
    },
    { headers: PARTNER_API_HEADERS }
  );
};
