// 取引先向け REST API: 特別レートと残室を JSON で返す。
//
//   GET /api/partner/v1/rates?from=YYYY-MM-DD&to=YYYY-MM-DD[&room=<部屋コード>...][&guests=<人数>...]
//   Authorization: Bearer rmsp_xxxxxxxx   （autumn-rms の取引先画面で発行する API キー）
//
// 1回で最大31日。from 省略 = 今日（JST）、to 省略 = from から31日。取引先の公開範囲
// （今日〜何日先まで・公開終了日）の外は切り詰め、切り詰めた後の範囲を range に返す。
import { json, type RequestHandler } from '@sveltejs/kit';
import { findPartnerByApiKey, logPartnerAccess, partnerAdminClient, partnerUnavailableReason, PartnerStoreError, addDaysIso, todayJst } from '$lib/server/partners/store';
import { clampPartnerRange, loadPartnerRates, PARTNER_MAX_RANGE_DAYS } from '$lib/server/partners/rates';
import { requestMeta } from '$lib/server/partners/portal';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400'
};
const HEADERS = { ...CORS_HEADERS, 'cache-control': 'private, no-store' };

function apiError(status: number, code: string, message: string, extra: Record<string, string> = {}) {
  return json({ error: { code, message } }, { status, headers: { ...HEADERS, ...extra } });
}

const isIsoDate = (v: string | null): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export const OPTIONS: RequestHandler = () => new Response(null, { status: 204, headers: CORS_HEADERS });

export const GET: RequestHandler = async (event) => {
  const db = partnerAdminClient();
  if (!db) return apiError(503, 'unavailable', 'Service is temporarily unavailable.');

  const auth = event.request.headers.get('authorization') ?? '';
  const apiKey = auth.match(/^Bearer\s+(\S+)$/i)?.[1] ?? '';
  if (!apiKey) return apiError(401, 'unauthorized', 'Authorization: Bearer <API key> is required.', { 'www-authenticate': 'Bearer' });

  let found: Awaited<ReturnType<typeof findPartnerByApiKey>>;
  try {
    found = await findPartnerByApiKey(db, apiKey);
  } catch (e) {
    if (e instanceof PartnerStoreError) return apiError(503, 'unavailable', 'Service is temporarily unavailable.');
    throw e;
  }
  if (!found) return apiError(401, 'unauthorized', 'Invalid or revoked API key.', { 'www-authenticate': 'Bearer error="invalid_token"' });
  const { partner, apiKeyId } = found;

  const unavailable = partnerUnavailableReason(partner);
  if (unavailable) return apiError(403, 'not_published', unavailable);

  const params = event.url.searchParams;
  const fromParam = params.get('from');
  const toParam = params.get('to');
  if (fromParam && !isIsoDate(fromParam)) return apiError(400, 'invalid_from', 'from must be YYYY-MM-DD.');
  if (toParam && !isIsoDate(toParam)) return apiError(400, 'invalid_to', 'to must be YYYY-MM-DD.');
  const today = todayJst();
  const from = fromParam ?? today;
  const to = toParam ?? addDaysIso(from, PARTNER_MAX_RANGE_DAYS - 1);
  if (to < from) return apiError(400, 'invalid_range', 'to must be on or after from.');

  const guests = params.getAll('guests').flatMap((v) => v.split(',')).map(Number);
  if (guests.some((g) => !Number.isInteger(g) || g < 1 || g > 20)) return apiError(400, 'invalid_guests', 'guests must be integers between 1 and 20.');
  const rooms = params.getAll('room').flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);

  const range = clampPartnerRange(partner, from, to, today);
  const meta = requestMeta(event);
  const base = {
    partner: { name: partner.name },
    facility: { code: partner.facility_slug, name: partner.facility_name },
    currency: 'JPY',
    priceBasis: 'per_person_tax_included_excluding_bath_tax',
    priceBasisLabel: '1名あたり・税込・入湯税別',
    inventoryIncluded: partner.show_inventory,
    generatedAt: new Date().toISOString()
  };
  if (!range) {
    return json({ ...base, range: null, requested: { from, to }, ratesFetchedAt: null, rooms: [], days: [] }, { headers: HEADERS });
  }

  const result = await loadPartnerRates(db, partner, range, { rooms, guests });
  await logPartnerAccess(db, {
    partnerId: partner.id,
    apiKeyId,
    channel: 'api',
    action: 'rates',
    detail: { from: range.from, to: range.to, rooms: rooms.length ? rooms : undefined, guests: guests.length ? guests : undefined },
    ip: meta.ip
  });

  // 実際に料金が出ている部屋タイプだけを一覧に載せる（非公開ルールで隠した部屋は出さない）。
  const shown = new Set(result.days.flatMap((d) => d.rooms.map((r) => r.roomCode)));
  return json(
    {
      ...base,
      range: { from: range.from, to: range.to },
      requested: { from, to },
      availableRange: { from: range.earliest, to: range.latest },
      // 旧 API（autumn-rms）との互換のため項目は残す。理論値には取得時刻が無いので常に null。
      ratesFetchedAt: null,
      rooms: result.rooms.filter((r) => shown.has(r.roomCode)).map((r) => ({ roomCode: r.roomCode, roomName: r.name })),
      days: result.days
    },
    { headers: HEADERS }
  );
};
