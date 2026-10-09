// 取引先向け REST API: 特別レートと残室を JSON で返す。
//
//   GET /api/partner/v1/rates?from=YYYY-MM-DD&to=YYYY-MM-DD[&facility=<施設の slug>][&room=<部屋コード>...][&guests=<人数>...]
//   Authorization: Bearer rmsp_xxxxxxxx   （Book の管理画面の取引先で発行する API キー）
//
// facility（2026-10-09 複数施設化 S5b・§7.10・決定 N11）: 施設の slug（GET /api/partner/v1/facilities の slug）。
// オンの施設が1つなら省略可（その施設）。2つ以上で省略すると 400 facility_required（応答の facilities にオンの施設の一覧）。
// 知らない施設は 400 unknown_facility、オフの施設は 403 facility_disabled、オンの施設が無ければ 403 no_facility。
//
// 1回で最大31日。from 省略 = 今日（JST）、to 省略 = from から31日。取引先の公開範囲
// （今日〜何日先まで・公開終了日）の外は切り詰め、切り詰めた後の範囲を range に返す。
import { json, type RequestHandler } from '@sveltejs/kit';
import { logPartnerAccess, addDaysIso, todayJst } from '$lib/server/partners/store';
import { clampPartnerRange, loadPartnerRates, PARTNER_MAX_RANGE_DAYS } from '$lib/server/partners/rates';
import { requestMeta } from '$lib/server/partners/portal';
import { authenticatePartnerApi, partnerApiError as apiError, PARTNER_API_HEADERS as HEADERS, partnerApiOptions, partnerForApiFacility } from '$lib/server/partners/api';

const isIsoDate = (v: string | null): v is string =>
  !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export const OPTIONS: RequestHandler = () => partnerApiOptions();

export const GET: RequestHandler = async (event) => {
  const auth = await authenticatePartnerApi(event);
  if (auth instanceof Response) return auth;
  const { db, apiKeyId } = auth;
  // 施設（?facility=<slug>）: オンが1つなら省略可・2つ以上で省略は 400 facility_required（N11）・オンが無ければ 403 no_facility（N9）
  const partner = partnerForApiFacility(auth, event.url.searchParams.get('facility'));
  if (partner instanceof Response) return partner;

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
    detail: { facility: partner.facility_slug, from: range.from, to: range.to, rooms: rooms.length ? rooms : undefined, guests: guests.length ? guests : undefined },
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
      // 旧 API（autumn-rms）との互換の項目。保存済みの最終料金（2026-10-09 §7）なら計算した時刻、従来の計算なら null。
      ratesFetchedAt: result.computedAt ?? null,
      rooms: result.rooms.filter((r) => shown.has(r.roomCode)).map((r) => ({ roomCode: r.roomCode, roomName: r.name })),
      days: result.days
    },
    { headers: HEADERS }
  );
};
