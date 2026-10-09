// 取引先向け REST API（/api/partner/v1/*）の共通処理: API キーの確認・応答ヘッダ・エラーの形・施設の指定。
// 2026-10-09 複数施設化 S5b（docs/partner-multi-facility.md §7.10・決定 N11）で rates から切り出した。
//
// 施設の指定（?facility=<slug>）:
//   - オンの施設が1つ → 省略可（その施設・従来どおり）
//   - オンの施設が2つ以上で省略 → 400 facility_required（オンの施設の一覧を facilities に入れて返す）
//   - 知らない slug → 400 unknown_facility ／ 取引先の施設だがオフ → 403 facility_disabled
//   - オンの施設が1つも無い（N9） → 403 no_facility
import { json, type RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  composePartnerContext,
  findPartnerByApiKey,
  NO_PARTNER_FACILITY_MESSAGE,
  partnerAdminClient,
  partnerUnavailableReason,
  PartnerStoreError,
  type PartnerBundle,
  type PartnerContext
} from './store';

export const PARTNER_API_CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400'
};
export const PARTNER_API_HEADERS = { ...PARTNER_API_CORS_HEADERS, 'cache-control': 'private, no-store' };

export function partnerApiError(status: number, code: string, message: string, opts: { headers?: Record<string, string>; body?: Record<string, unknown> } = {}) {
  return json({ error: { code, message }, ...(opts.body ?? {}) }, { status, headers: { ...PARTNER_API_HEADERS, ...(opts.headers ?? {}) } });
}

export const partnerApiOptions = () => new Response(null, { status: 204, headers: PARTNER_API_CORS_HEADERS });

export type ApiFacility = { id: string; slug: string; name: string; enabled: boolean };

export type ApiFacilityResult =
  | { ok: true; facilityId: string }
  | { ok: false; status: 400 | 403; code: 'facility_required' | 'unknown_facility' | 'facility_disabled' | 'no_facility'; message: string };

/** API の施設の決め方（純関数）。facilities は取引先の施設（オン／オフとも・並び順）、param は ?facility= の値 */
export function resolveApiFacility(facilities: readonly ApiFacility[], param: string | null | undefined): ApiFacilityResult {
  const enabled = facilities.filter((f) => f.enabled);
  const slug = String(param ?? '').trim();
  if (slug) {
    const hit = facilities.find((f) => f.slug === slug);
    if (!hit) return { ok: false, status: 400, code: 'unknown_facility', message: `Unknown facility "${slug}". See GET /api/partner/v1/facilities.` };
    if (!hit.enabled) return { ok: false, status: 403, code: 'facility_disabled', message: `Facility "${slug}" is not available for this partner.` };
    return { ok: true, facilityId: hit.id };
  }
  if (!enabled.length) return { ok: false, status: 403, code: 'no_facility', message: NO_PARTNER_FACILITY_MESSAGE };
  if (enabled.length >= 2) {
    return { ok: false, status: 400, code: 'facility_required', message: 'facility is required (this partner has more than one facility). See GET /api/partner/v1/facilities.' };
  }
  return { ok: true, facilityId: enabled[0].id };
}

/** API の施設一覧（オンの施設・並び順）。facilities エンドポイントと facility_required の応答で返す形 */
export const apiFacilityList = (facilities: readonly ApiFacility[]) => facilities.filter((f) => f.enabled).map((f) => ({ slug: f.slug, name: f.name }));

export const bundleApiFacilities = (bundle: PartnerBundle): ApiFacility[] =>
  bundle.facilities.filter((f) => !f.synthetic).map((f) => ({ id: f.facility_id, slug: f.slug, name: f.name, enabled: f.enabled }));

export type PartnerApiAuth = { db: SupabaseClient; partner: PartnerContext; bundle: PartnerBundle; apiKeyId: string };

/**
 * Authorization: Bearer <API キー> を確かめ、取引先（既定の施設で合成）を返す。失敗はそのまま返せる Response。
 * 公開停止中（公開期間外・停止）は 403 not_published。
 */
export async function authenticatePartnerApi(event: Pick<RequestEvent, 'request'>): Promise<PartnerApiAuth | Response> {
  const db = partnerAdminClient();
  if (!db) return partnerApiError(503, 'unavailable', 'Service is temporarily unavailable.');
  const auth = event.request.headers.get('authorization') ?? '';
  const apiKey = auth.match(/^Bearer\s+(\S+)$/i)?.[1] ?? '';
  if (!apiKey) return partnerApiError(401, 'unauthorized', 'Authorization: Bearer <API key> is required.', { headers: { 'www-authenticate': 'Bearer' } });
  let found: Awaited<ReturnType<typeof findPartnerByApiKey>>;
  try {
    found = await findPartnerByApiKey(db, apiKey);
  } catch (e) {
    if (e instanceof PartnerStoreError) return partnerApiError(503, 'unavailable', 'Service is temporarily unavailable.');
    throw e;
  }
  if (!found) return partnerApiError(401, 'unauthorized', 'Invalid or revoked API key.', { headers: { 'www-authenticate': 'Bearer error="invalid_token"' } });
  const unavailable = partnerUnavailableReason(found.partner);
  if (unavailable) return partnerApiError(403, 'not_published', unavailable);
  return { db, ...found };
}

/** ?facility= に従って施設を決め、その施設で合成した取引先を返す（決まらなければエラーの Response） */
export function partnerForApiFacility(auth: PartnerApiAuth, param: string | null | undefined): PartnerContext | Response {
  const facilities = bundleApiFacilities(auth.bundle);
  const r = resolveApiFacility(facilities, param);
  if (!r.ok) {
    return partnerApiError(r.status, r.code, r.message, r.code === 'no_facility' ? {} : { body: { facilities: apiFacilityList(facilities) } });
  }
  const partner = r.facilityId === auth.partner.facility_id ? auth.partner : composePartnerContext(auth.bundle, r.facilityId);
  if (!partner || partner.facility_id !== r.facilityId || !partner.facility_available) {
    return partnerApiError(403, 'facility_disabled', 'This facility is not available for this partner.');
  }
  return partner;
}
