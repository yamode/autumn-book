// 取引先ページの団体予約（問い合わせ → 宿が回答 → 承諾で予約・docs/partner-group-booking.md）のサーバ処理。
//
// 表 public.rms_partner_group_inquiries / rms_partner_group_inquiry_events（autumn-shared 20261010053641）は service_role 専用。
// ここの関数は service_role のクライアントで触るので、呼び出し側（routes）が先に
//   - 取引先: 限定URL＋セッション（requirePortalSession / requirePortalApi）と団体予約の可否（groupInquiryAvailable）
//   - 宿: スタッフの役割と照会の施設へのアクセス（staffPartnerScope・staffHasFacilityAccess）
// を確かめること。ここでも取引先の照会は partner_id、宿の照会は tenant_id と施設で必ず絞る。
//
// 予約・PMS・請求書・与信の数え方は個人予約と同じ（承諾時に既存の RPC rms_partner_create_booking を呼ぶだけ・§4）。
// 照会・回答の段階では在庫を押さえない（N6）。承諾時に RPC が施設ロックの中で残室を数え直す。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  canAccept,
  canAnswer,
  canReject,
  canWithdrawBy,
  defaultAnswerExpiry,
  describeGroupIssues,
  endOfDayJst,
  groupInquiryAvailable,
  groupInquiryBlockReason,
  groupNightDates,
  GROUP_MAX_TOTAL_EXCLUSIVE,
  GROUP_MAX_UNIT_PRICE,
  groupPaymentChoices,
  groupPriceLimitError,
  groupQuoteStatusOf,
  groupRoomsTotal,
  isRealIsoDate,
  isValidPriceRooms,
  MAX_GROUP_ANSWER_MESSAGE_LENGTH,
  normalizeGroupDraftItem,
  overrideUnitPrices,
  resolveGroupChoice,
  spreadTotalOverRooms,
  validateGroupDraft,
  withSubtotals,
  type GroupAnswer,
  type GroupDraftItem,
  type GroupInquiryExtras,
  type GroupInquiryStatus,
  type GroupPriceRoom,
  type GroupQuoteStatus,
  type GroupValidationIssue
} from '$lib/partner-group';
import { normalizeBooker, normalizePartnerBookingSettings, partnerPlanName, type PartnerBooker } from '$lib/partner-booking';
import { buildBookingExtras, extraOptionRows } from './booking-extras';
import {
  attachBookingExtras,
  bathTaxRule,
  friendlyRpcError,
  getPartnerBooking,
  partnerStayCredit,
  quotePartnerBooking,
  sendBookingMails,
  snapshotCancelPolicy,
  type PartnerQuoteCredit
} from './booking';
import { addDaysIso, loadPartnerContextAt, logPartnerAccess, PartnerStoreError, todayJst, type PartnerContext } from './store';
import { partnerPublicBounds } from './rates';
import { loadPortalReference } from './portal-reference';
import { sendGroupAcceptFailedMail, sendGroupAnswerMail, sendGroupClosedMail, sendGroupSubmittedMail } from './group-mail';

type AnySchema = { schema: (s: string) => SupabaseClient };
const pmsDb = (db: SupabaseClient) => (db as unknown as AnySchema).schema('pms');

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

/** rms_partner_group_inquiries の行（DB の形そのまま） */
export type GroupInquiryRow = {
  id: string;
  tenant_id: string;
  facility_id: string;
  partner_id: string | null;
  partner_name: string;
  account_id: string | null;
  submitted_by: string | null;
  batch_id: string;
  batch_seq: number;
  inquiry_code: string;
  status: GroupInquiryStatus;
  group_name: string;
  room_type_id: string | null;
  room_code: string;
  room_name: string;
  plan_code: string;
  plan_name: string;
  plan_display_name: string | null;
  meal_type: string | null;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  room_count: number;
  adult_total: number;
  rooms: { adults: number }[];
  payment_option: string;
  payment_label: string;
  extras: GroupInquiryExtras;
  booker: PartnerBooker;
  quote_status: GroupQuoteStatus;
  quote_message: string | null;
  quote_rooms: GroupPriceRoom[] | null;
  quote_total: number | null;
  quote_bath_tax: number | null;
  quote_price_mode: string | null;
  quote_remaining: number | null;
  quote_credit: PartnerQuoteCredit | null;
  answer: GroupAnswer | null;
  answer_total: number | null;
  answer_bath_tax: number | null;
  answer_rooms: GroupPriceRoom[] | null;
  answer_message: string | null;
  answer_expires_at: string | null;
  answered_at: string | null;
  answered_by: string | null;
  answered_by_name: string | null;
  credit_override: boolean;
  accepted_at: string | null;
  accepted_by: string | null;
  booking_id: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  created_at: string;
  updated_at: string;
};

/** 取引先ページに渡す照会（宿のスタッフの id・名前は渡さない）。予約確定なら予約番号・予約の状態も付ける */
export type PartnerGroupInquiry = Omit<GroupInquiryRow, 'answered_by' | 'answered_by_name' | 'tenant_id'> & {
  facilityName: string;
  bookingCode: string | null;
  bookingStatus: string | null;
};

/** 管理画面に渡す照会（全列＋施設名・予約番号） */
export type StaffGroupInquiry = GroupInquiryRow & { facilityName: string; bookingCode: string | null; bookingStatus: string | null };

/** rms_partner_group_inquiry_events の行 */
export type GroupInquiryEvent = {
  id: number;
  inquiry_id: string;
  kind: string;
  actor_kind: 'partner' | 'staff' | 'system';
  actor_label: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
};

const COLUMNS =
  'id, tenant_id, facility_id, partner_id, partner_name, account_id, submitted_by, batch_id, batch_seq, inquiry_code, status, group_name, room_type_id, room_code, room_name, plan_code, plan_name, plan_display_name, meal_type, check_in_date, check_out_date, nights, room_count, adult_total, rooms, payment_option, payment_label, extras, booker, quote_status, quote_message, quote_rooms, quote_total, quote_bath_tax, quote_price_mode, quote_remaining, quote_credit, answer, answer_total, answer_bath_tax, answer_rooms, answer_message, answer_expires_at, answered_at, answered_by, answered_by_name, credit_override, accepted_at, accepted_by, booking_id, closed_at, closed_reason, created_at, updated_at';

const TABLE = 'rms_partner_group_inquiries';
const EVENTS = 'rms_partner_group_inquiry_events';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isGroupInquiryId = (id: string | null | undefined) => UUID_RE.test(String(id ?? ''));

function dbError(error: { message?: string; code?: string } | null, fallback: string): never {
  if (error && (error.code === '42P01' || error.code === 'PGRST205' || /could not find the table|does not exist/i.test(error.message ?? ''))) {
    throw new PartnerStoreError('団体予約の DB（autumn-shared migration 20261010053641）が未適用です。', 503, 'migration_missing');
  }
  console.error('[group-inquiry]', fallback, error?.message);
  throw new PartnerStoreError(fallback, 500, 'db_error');
}

/** 取引先の団体予約を出してよいか（kind=agent かつ取引先ごとのオン）。だめなら 404 を投げる（メニューを隠すだけにしない・§7.10） */
export function requireGroupInquiry(partner: Pick<PartnerContext, 'kind' | 'booking_settings'>) {
  if (!groupInquiryAvailable(partner)) throw new PartnerStoreError('ページが見つかりません。', 404, 'not_found');
}

// ---------------------------------------------------------------------------
// 読み出し
// ---------------------------------------------------------------------------

async function attachBookings<T extends GroupInquiryRow>(db: SupabaseClient, rows: T[]): Promise<(T & { bookingCode: string | null; bookingStatus: string | null })[]> {
  const ids = [...new Set(rows.map((r) => r.booking_id).filter((id): id is string => !!id))];
  const map = new Map<string, { code: string; status: string }>();
  if (ids.length) {
    const { data } = await db.from('rms_partner_bookings').select('id, booking_code, status').in('id', ids);
    for (const b of (data ?? []) as { id: string; booking_code: string; status: string }[]) map.set(b.id, { code: b.booking_code, status: b.status });
  }
  return rows.map((r) => ({ ...r, bookingCode: r.booking_id ? (map.get(r.booking_id)?.code ?? null) : null, bookingStatus: r.booking_id ? (map.get(r.booking_id)?.status ?? null) : null }));
}

async function facilityNames(db: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return out;
  const { data } = await db.schema('core').from('facilities').select('id, name').in('id', uniq);
  for (const f of (data ?? []) as { id: string; name: string }[]) out.set(f.id, f.name);
  return out;
}

const toPartnerView = (r: GroupInquiryRow & { bookingCode: string | null; bookingStatus: string | null }, facilityName: string): PartnerGroupInquiry => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { answered_by, answered_by_name, tenant_id, ...rest } = r;
  return { ...rest, facilityName };
};

/** 取引先の照会の一覧（取引先の全施設・新しい順・最大 200 件） */
export async function listPartnerGroupInquiries(
  db: SupabaseClient,
  partner: Pick<PartnerContext, 'id' | 'facilities'>,
  filter: { statuses?: GroupInquiryStatus[]; batchId?: string; limit?: number } = {}
): Promise<PartnerGroupInquiry[]> {
  let q = db.from(TABLE).select(COLUMNS).eq('partner_id', partner.id).order('created_at', { ascending: false }).order('batch_seq').limit(filter.limit ?? 200);
  if (filter.statuses?.length) q = q.in('status', filter.statuses);
  if (filter.batchId && isGroupInquiryId(filter.batchId)) q = q.eq('batch_id', filter.batchId);
  const { data, error } = await q;
  if (error) dbError(error, '団体予約の照会を読み込めませんでした。');
  const rows = await attachBookings(db, (data ?? []) as GroupInquiryRow[]);
  const names = new Map(partner.facilities.map((f) => [f.id, f.name]));
  return rows.map((r) => toPartnerView(r, names.get(r.facility_id) ?? ''));
}

/** 取引先の照会1件（partner_id で絞る）。無ければ null */
export async function getPartnerGroupInquiry(
  db: SupabaseClient,
  partner: Pick<PartnerContext, 'id' | 'facilities'>,
  id: string
): Promise<PartnerGroupInquiry | null> {
  const row = await getGroupInquiryRow(db, id, { partnerId: partner.id });
  if (!row) return null;
  const [withBooking] = await attachBookings(db, [row]);
  return toPartnerView(withBooking, partner.facilities.find((f) => f.id === row.facility_id)?.name ?? '');
}

/** 照会1件（行のまま）。partnerId / tenantId で必ず絞る */
export async function getGroupInquiryRow(db: SupabaseClient, id: string, scope: { partnerId?: string; tenantId?: string }): Promise<GroupInquiryRow | null> {
  if (!isGroupInquiryId(id) || (!scope.partnerId && !scope.tenantId)) return null;
  let q = db.from(TABLE).select(COLUMNS).eq('id', id);
  if (scope.partnerId) q = q.eq('partner_id', scope.partnerId);
  if (scope.tenantId) q = q.eq('tenant_id', scope.tenantId);
  const { data, error } = await q.maybeSingle();
  if (error) dbError(error, '団体予約の照会を読み込めませんでした。');
  return (data as GroupInquiryRow | null) ?? null;
}

/** やりとり（古い順）。audience=partner はスタッフの名前を「宿」に置き換える */
export async function listGroupInquiryEvents(db: SupabaseClient, inquiryId: string, audience: 'partner' | 'staff'): Promise<GroupInquiryEvent[]> {
  const { data, error } = await db.from(EVENTS).select('id, inquiry_id, kind, actor_kind, actor_label, detail, created_at').eq('inquiry_id', inquiryId).order('created_at').limit(200);
  if (error) dbError(error, '団体予約のやりとりを読み込めませんでした。');
  const rows = (data ?? []) as GroupInquiryEvent[];
  return audience === 'staff' ? rows : rows.map((e) => (e.actor_kind === 'staff' ? { ...e, actor_label: '宿' } : e));
}

/** 管理画面の一覧（テナント・施設で絞る。既定は回答待ち＋回答済み） */
export async function listStaffGroupInquiries(
  db: SupabaseClient,
  filter: {
    tenantId: string;
    facilityIds: string[];
    statuses?: GroupInquiryStatus[];
    partnerId?: string | null;
    /** 同じ束の照会だけ（詳細の「同じ束のほかの照会」） */
    batchId?: string | null;
    from?: string | null;
    to?: string | null;
    limit?: number;
  }
): Promise<StaffGroupInquiry[]> {
  if (!filter.facilityIds.length) return [];
  let q = db
    .from(TABLE)
    .select(COLUMNS)
    .eq('tenant_id', filter.tenantId)
    .in('facility_id', filter.facilityIds)
    .order('created_at', { ascending: false })
    .order('batch_seq')
    .limit(filter.limit ?? 300);
  if (filter.statuses?.length) q = q.in('status', filter.statuses);
  if (filter.partnerId && isGroupInquiryId(filter.partnerId)) q = q.eq('partner_id', filter.partnerId);
  if (filter.batchId) {
    if (!isGroupInquiryId(filter.batchId)) return [];
    q = q.eq('batch_id', filter.batchId);
  }
  if (filter.from && /^\d{4}-\d{2}-\d{2}$/.test(filter.from)) q = q.gte('check_in_date', filter.from);
  if (filter.to && /^\d{4}-\d{2}-\d{2}$/.test(filter.to)) q = q.lte('check_in_date', filter.to);
  const { data, error } = await q;
  if (error) dbError(error, '団体照会を読み込めませんでした。');
  const rows = await attachBookings(db, (data ?? []) as GroupInquiryRow[]);
  const names = await facilityNames(db, rows.map((r) => r.facility_id));
  return rows.map((r) => ({ ...r, facilityName: names.get(r.facility_id) ?? '' }));
}

/** 管理画面のサイドバーのバッジ: 回答待ち（submitted）の件数（施設アクセスの範囲）。読めなければ null */
export async function countSubmittedGroupInquiries(db: SupabaseClient, tenantId: string, facilityIds: string[]): Promise<number | null> {
  if (!facilityIds.length) return 0;
  const { count, error } = await db
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .in('facility_id', facilityIds)
    .eq('status', 'submitted');
  return error ? null : (count ?? 0);
}

/** 管理画面の取引先詳細: この取引先の照会の直近 limit 件 */
export async function listRecentGroupInquiriesOfPartner(db: SupabaseClient, partnerId: string, limit = 20): Promise<StaffGroupInquiry[]> {
  const { data, error } = await db.from(TABLE).select(COLUMNS).eq('partner_id', partnerId).order('created_at', { ascending: false }).limit(limit);
  if (error) return [];
  const rows = await attachBookings(db, (data ?? []) as GroupInquiryRow[]);
  const names = await facilityNames(db, rows.map((r) => r.facility_id));
  return rows.map((r) => ({ ...r, facilityName: names.get(r.facility_id) ?? '' }));
}

/**
 * 「前回の内容を使う」（§8.1）: このアカウント（無ければ取引先）の直近の送信の束の1件目を、下書きの形で返す。
 * 団体名は空にする（団体名以外を埋める）。無ければ null。
 */
export async function latestGroupBatch(db: SupabaseClient, partnerId: string, accountId: string | null): Promise<GroupDraftItem | null> {
  const pick = async (byAccount: boolean) => {
    let q = db.from(TABLE).select(COLUMNS).eq('partner_id', partnerId).order('created_at', { ascending: false }).order('batch_seq').limit(1);
    if (byAccount && accountId) q = q.eq('account_id', accountId);
    const { data } = await q;
    return ((data ?? []) as GroupInquiryRow[])[0] ?? null;
  };
  const row = (accountId ? await pick(true) : null) ?? (await pick(false));
  if (!row) return null;
  return {
    facilityId: row.facility_id,
    groupName: '',
    roomCode: row.room_code,
    planCode: row.plan_code,
    planName: row.plan_name,
    checkIn: row.check_in_date,
    nights: row.nights,
    adults: row.adult_total,
    rooms: (row.rooms ?? []).map((r) => ({ adults: r.adults })),
    paymentOption: row.payment_option,
    transport: { choice: row.extras?.transport?.choice ?? '', other: row.extras?.transport?.other ?? '' },
    dinnerTime: { choice: row.extras?.dinnerTime?.choice ?? '', other: row.extras?.dinnerTime?.other ?? '' },
    note: row.extras?.note ?? '',
    booker: normalizeBooker(row.booker)
  };
}

// ---------------------------------------------------------------------------
// 入力画面の選択肢（部屋タイプ・プラン）
// ---------------------------------------------------------------------------

export type GroupCatalogRoom = {
  code: string;
  name: string;
  capacityMax: number;
  plans: { planCode: string; planName: string; displayName: string; mealType: string | null; minPerPerson: number | null }[];
};

/** 部屋タイプの定員（pms.room_types・有効なもの）。code → {id, name, capacityMax} */
async function roomTypesOf(db: SupabaseClient, facilityId: string): Promise<Map<string, { id: string; name: string; capacityMax: number }>> {
  const { data } = await pmsDb(db).from('room_types').select('id, code, name, capacity_max').eq('facility_id', facilityId).eq('is_active', true);
  const out = new Map<string, { id: string; name: string; capacityMax: number }>();
  for (const r of (data ?? []) as { id: string; code: string; name: string; capacity_max: number | null }[]) {
    out.set(r.code, { id: r.id, name: r.name, capacityMax: Math.max(1, Number(r.capacity_max) || 6) });
  }
  return out;
}

/**
 * 入力画面の部屋タイプ・プランの選択肢（選んでいる施設）。料金カレンダーの「今後3か月の最安」（2名1室・KV 共通）に出る
 * 部屋 × プランだけを出す（取引先に売っていないプランは出さない）。読めなければ部屋タイプだけ（プランは空）。
 */
export async function groupFormCatalog(event: { platform?: App.Platform }, db: SupabaseClient, partner: PartnerContext): Promise<GroupCatalogRoom[]> {
  const [types, refs] = await Promise.all([
    roomTypesOf(db, partner.facility_id),
    loadPortalReference(event, db, partner, 2, todayJst()).catch(() => [])
  ]);
  const rooms = new Map<string, GroupCatalogRoom>();
  for (const p of refs) {
    const t = types.get(p.roomCode);
    if (!t || p.advance) continue;
    const room = rooms.get(p.roomCode) ?? { code: p.roomCode, name: p.roomName || t.name, capacityMax: t.capacityMax, plans: [] };
    if (!room.plans.some((x) => x.planCode === p.planCode && x.planName === p.planName)) {
      room.plans.push({
        planCode: p.planCode,
        planName: p.planName,
        displayName: partnerPlanName(partner.booking_settings.planNames, p.planCode, p.planName),
        mealType: p.mealType,
        minPerPerson: p.minPerPerson
      });
    }
    rooms.set(p.roomCode, room);
  }
  return [...rooms.values()];
}

// ---------------------------------------------------------------------------
// 送信（束）
// ---------------------------------------------------------------------------

export type SubmitGroupResult =
  | { ok: true; batchId: string; inquiries: { id: string; inquiryCode: string; quoteStatus: GroupQuoteStatus }[]; warnings: GroupValidationIssue[] }
  | { ok: false; message: string; errors: GroupValidationIssue[]; warnings: GroupValidationIssue[] };

/**
 * 束の送信（§8.1・§7.1）: 全件を検証し、1件でも誤りがあれば送らない（部分送信にしない）。
 * 1件ずつ取引先料金で自動計算（quotePartnerBooking・個人予約と同じ）して写し、INSERT → やりとり → 宿へ施設ごとに1通。
 * resolveFacility: 件の施設で合成した取引先（routes が portalFacilityContext で作る。取引先の施設でなければ例外）
 * catalogOf: その施設の入力画面の選択肢（routes が groupFormCatalog で作る）。部屋タイプ・プランの組がこの中に無い件はエラー
 */
export async function submitGroupBatch(
  db: SupabaseClient,
  selected: PartnerContext,
  account: { id: string; login_id: string },
  rawItems: unknown[],
  meta: { ip: string | null; origin: string },
  resolveFacility: (facilityId: string) => Promise<PartnerContext>,
  catalogOf: (ctx: PartnerContext) => Promise<GroupCatalogRoom[]>
): Promise<SubmitGroupResult> {
  requireGroupInquiry(selected);
  const items = rawItems.slice(0, 100).map(normalizeGroupDraftItem);
  // 件の施設ごとに合成（同じ施設は1回）
  const ctxs = new Map<string, PartnerContext>();
  const facilityErrors: GroupValidationIssue[] = [];
  for (const [index, it] of items.entries()) {
    if (!it.facilityId) it.facilityId = selected.facility_id;
    if (ctxs.has(it.facilityId)) continue;
    try {
      const ctx = await resolveFacility(it.facilityId);
      ctxs.set(it.facilityId, ctx);
    } catch {
      facilityErrors.push({ index, message: '施設を確かめられませんでした。画面を読み直してください。' });
    }
  }
  for (const [index, it] of items.entries()) {
    const ctx = ctxs.get(it.facilityId);
    if (!ctx) continue;
    const reason = groupInquiryBlockReason(ctx);
    if (reason) facilityErrors.push({ index, message: reason });
  }
  const types = new Map<string, Map<string, { id: string; name: string; capacityMax: number }>>();
  const catalogs = new Map<string, GroupCatalogRoom[]>();
  await Promise.all([
    ...[...ctxs.keys()].map(async (fid) => types.set(fid, await roomTypesOf(db, fid))),
    ...[...ctxs.entries()].map(async ([fid, ctx]) => catalogs.set(fid, await catalogOf(ctx).catch(() => [])))
  ]);
  // 部屋タイプ × プラン（コード・元の名前）の組が、入力画面の選択肢（取引先に売っているもの）にあるか。
  // 部屋タイプ自体が無い件は validateGroupDraft が「この部屋タイプは現在ご案内できません」を出すので重ねない
  for (const [index, it] of items.entries()) {
    if (!ctxs.has(it.facilityId) || !it.roomCode || !it.planCode || !it.planName) continue;
    if (!types.get(it.facilityId)?.has(it.roomCode)) continue;
    const listed = (catalogs.get(it.facilityId) ?? []).some(
      (r) => r.code === it.roomCode && r.plans.some((p) => p.planCode === it.planCode && p.planName === it.planName)
    );
    if (!listed) facilityErrors.push({ index, message: 'このお部屋・プランの組み合わせは現在ご案内できません。選び直してください。' });
  }
  const s = selected.booking_settings;
  const v = validateGroupDraft(items, s, {
    bounds: (it) => {
      const ctx = ctxs.get(it.facilityId) ?? selected;
      return partnerPublicBounds(ctx);
    },
    capacityOf: (it) => types.get(it.facilityId)?.get(it.roomCode)?.capacityMax ?? null,
    paymentIds: groupPaymentChoices(s).map((o) => o.id)
  });
  const errors = [...facilityErrors, ...v.errors].sort((a, b) => a.index - b.index);
  if (errors.length) return { ok: false, message: describeGroupIssues(errors), errors, warnings: v.warnings };

  // 自動計算（5件ずつ）
  const quotes: Awaited<ReturnType<typeof quoteItem>>[] = [];
  for (let i = 0; i < items.length; i += 5) {
    quotes.push(...(await Promise.all(items.slice(i, i + 5).map((it) => quoteItem(db, ctxs.get(it.facilityId)!, it)))));
  }
  const { data: codes, error: codeError } = await db.rpc('rms_partner_next_group_inquiry_codes', { p_count: items.length });
  if (codeError || !Array.isArray(codes) || codes.length !== items.length) dbError(codeError, '照会番号を採番できませんでした。時間をおいてお試しください。');
  const batchId = crypto.randomUUID();
  const rows = items.map((it, i) => {
    const ctx = ctxs.get(it.facilityId)!;
    const q = quotes[i];
    const type = types.get(it.facilityId)?.get(it.roomCode);
    const transport = resolveGroupChoice(it.transport, s.groupTransportChoices, '交通機関');
    const dinner = resolveGroupChoice(it.dinnerTime, s.groupDinnerTimeChoices, '夕食開始時間');
    return {
      tenant_id: ctx.tenant_id,
      facility_id: ctx.facility_id,
      partner_id: ctx.id,
      partner_name: ctx.name,
      account_id: account.id,
      submitted_by: account.login_id,
      batch_id: batchId,
      batch_seq: i + 1,
      inquiry_code: String(codes[i]),
      status: 'submitted',
      group_name: it.groupName,
      room_type_id: type?.id ?? null,
      room_code: it.roomCode,
      room_name: q.roomName ?? type?.name ?? it.roomCode,
      plan_code: it.planCode,
      plan_name: it.planName,
      plan_display_name: partnerPlanName(ctx.booking_settings.planNames, it.planCode, it.planName),
      meal_type: q.mealType,
      check_in_date: it.checkIn,
      check_out_date: addDaysIso(it.checkIn, it.nights),
      nights: it.nights,
      room_count: it.rooms.length,
      adult_total: it.adults,
      rooms: it.rooms.map((r) => ({ adults: r.adults })),
      payment_option: it.paymentOption,
      payment_label: groupPaymentChoices(s).find((o) => o.id === it.paymentOption)?.label ?? it.paymentOption,
      extras: {
        transport: { ...it.transport, value: transport.ok ? transport.value : '' },
        dinnerTime: { ...it.dinnerTime, value: dinner.ok ? dinner.value : '' },
        note: it.note
      } satisfies GroupInquiryExtras,
      booker: it.booker,
      quote_status: q.status,
      quote_message: q.message,
      quote_rooms: q.rooms,
      quote_total: q.total,
      quote_bath_tax: q.bathTax,
      quote_price_mode: q.priceMode,
      quote_remaining: q.remaining,
      quote_credit: q.credit
    };
  });
  const { data: inserted, error } = await db.from(TABLE).insert(rows).select(COLUMNS);
  if (error) dbError(error, '照会を保存できませんでした。時間をおいてお試しください。');
  const saved = ((inserted ?? []) as GroupInquiryRow[]).sort((a, b) => a.batch_seq - b.batch_seq);
  await db
    .from(EVENTS)
    .insert(saved.map((r) => ({ inquiry_id: r.id, kind: 'submitted', actor_kind: 'partner', actor_label: account.login_id, detail: { batch_id: batchId, quote_status: r.quote_status, quote_total: r.quote_total } })))
    .then(
      () => undefined,
      () => undefined
    );
  await logPartnerAccess(db, {
    partnerId: selected.id,
    accountId: account.id,
    channel: 'web',
    action: 'group_inquiry_submit',
    detail: { batch_id: batchId, count: saved.length, inquiry_codes: saved.map((r) => r.inquiry_code) },
    ip: meta.ip
  });
  // 宿へ（施設ごとに1通）
  for (const [fid, ctx] of ctxs) {
    const own = saved.filter((r) => r.facility_id === fid);
    if (own.length) await sendGroupSubmittedMail(db, ctx, own, meta.origin).catch(() => false);
  }
  return { ok: true, batchId, inquiries: saved.map((r) => ({ id: r.id, inquiryCode: r.inquiry_code, quoteStatus: r.quote_status })), warnings: v.warnings };
}

async function quoteItem(db: SupabaseClient, ctx: PartnerContext, it: GroupDraftItem) {
  const base = {
    roomName: null as string | null,
    mealType: null as string | null,
    rooms: null as GroupPriceRoom[] | null,
    total: null as number | null,
    bathTax: null as number | null,
    remaining: null as number | null,
    credit: null as PartnerQuoteCredit | null,
    priceMode: null as string | null
  };
  try {
    const q = await quotePartnerBooking(
      db,
      ctx,
      { roomCode: it.roomCode, planCode: it.planCode, planName: it.planName, checkIn: it.checkIn, nights: it.nights, rooms: it.rooms },
      { credit: true }
    );
    if (!q.ok) return { ...base, status: groupQuoteStatusOf(q.message) as GroupQuoteStatus, message: q.message };
    return {
      status: 'ok' as GroupQuoteStatus,
      message: null as string | null,
      roomName: q.roomName,
      mealType: q.mealType,
      rooms: q.rooms.map((r) => ({ adults: r.adults, nights: r.nights, subtotal: r.subtotal })),
      total: q.total,
      bathTax: q.bathTax,
      remaining: q.remaining,
      credit: q.credit,
      // 料金の出どころ（precomputed＝RMS の先計算／live＝その場の計算）。管理画面の「自動計算: …」に出す
      priceMode: (q.priceMode ?? null) as string | null
    };
  } catch (e) {
    console.error('[group-inquiry] 自動計算に失敗しました:', e instanceof Error ? e.message : e);
    return { ...base, status: 'error' as GroupQuoteStatus, message: '料金を読み込めませんでした。' };
  }
}

// ---------------------------------------------------------------------------
// 取引先の操作: 取り下げ・辞退・承諾
// ---------------------------------------------------------------------------

async function addEvent(db: SupabaseClient, inquiryId: string, kind: string, actorKind: GroupInquiryEvent['actor_kind'], actorLabel: string | null, detail: Record<string, unknown> | null) {
  await db
    .from(EVENTS)
    .insert({ inquiry_id: inquiryId, kind, actor_kind: actorKind, actor_label: actorLabel, detail })
    .then(
      () => undefined,
      () => undefined
    );
}

async function contextOf(db: SupabaseClient, row: GroupInquiryRow): Promise<PartnerContext | null> {
  return row.partner_id ? loadPartnerContextAt(db, row.partner_id, row.facility_id).catch(() => null) : null;
}

/** 取り下げ（回答待ち・回答あり）。送信した本人かマスタだけ（§7.9）。宿へ1通（N8） */
export async function withdrawGroupInquiry(
  db: SupabaseClient,
  partner: PartnerContext,
  account: { id: string; login_id: string; is_master?: boolean },
  id: string,
  meta: { ip: string | null; origin: string; reason?: string }
): Promise<GroupInquiryRow> {
  const row = await getGroupInquiryRow(db, id, { partnerId: partner.id });
  if (!row) throw new PartnerStoreError('照会が見つかりません。', 404, 'not_found');
  if (!canWithdrawBy(row, account)) {
    throw new PartnerStoreError(
      row.status === 'submitted' || row.status === 'offered' ? '取り下げられるのは、照会を送ったご本人かマスタユーザーだけです。' : 'この照会は取り下げられません。',
      403
    );
  }
  const reason = String(meta.reason ?? '').trim().slice(0, 500) || null;
  const { data, error } = await db
    .from(TABLE)
    .update({ status: 'withdrawn', closed_at: new Date().toISOString(), closed_reason: reason ?? 'withdrawn' })
    .eq('id', row.id)
    .eq('partner_id', partner.id)
    .in('status', ['submitted', 'offered'])
    .select(COLUMNS)
    .maybeSingle();
  if (error) dbError(error, '取り下げできませんでした。');
  if (!data) throw new PartnerStoreError('照会の状態が変わりました。画面を読み直してください。', 409, 'conflict');
  const after = data as GroupInquiryRow;
  await addEvent(db, row.id, 'withdrawn', 'partner', account.login_id, reason ? { reason } : null);
  await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'group_inquiry_withdraw', detail: { inquiry_code: row.inquiry_code }, ip: meta.ip });
  const ctx = await contextOf(db, after);
  if (ctx) await sendGroupClosedMail(db, ctx, after, 'withdrawn', meta.origin).catch(() => false);
  return after;
}

/** 辞退（回答あり）。宿へ1通（N8） */
export async function rejectGroupInquiry(
  db: SupabaseClient,
  partner: PartnerContext,
  account: { id: string; login_id: string },
  id: string,
  meta: { ip: string | null; origin: string; reason?: string }
): Promise<GroupInquiryRow> {
  const row = await getGroupInquiryRow(db, id, { partnerId: partner.id });
  if (!row) throw new PartnerStoreError('照会が見つかりません。', 404, 'not_found');
  if (!canReject(row)) throw new PartnerStoreError('この照会は辞退できません（回答あり の照会だけ）。', 409, 'conflict');
  const reason = String(meta.reason ?? '').trim().slice(0, 500) || null;
  const { data, error } = await db
    .from(TABLE)
    .update({ status: 'rejected', closed_at: new Date().toISOString(), closed_reason: reason ?? 'rejected' })
    .eq('id', row.id)
    .eq('partner_id', partner.id)
    .eq('status', 'offered')
    .select(COLUMNS)
    .maybeSingle();
  if (error) dbError(error, '辞退できませんでした。');
  if (!data) throw new PartnerStoreError('照会の状態が変わりました。画面を読み直してください。', 409, 'conflict');
  const after = data as GroupInquiryRow;
  await addEvent(db, row.id, 'rejected', 'partner', account.login_id, reason ? { reason } : null);
  await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'group_inquiry_reject', detail: { inquiry_code: row.inquiry_code }, ip: meta.ip });
  const ctx = await contextOf(db, after);
  if (ctx) await sendGroupClosedMail(db, ctx, after, 'rejected', meta.origin).catch(() => false);
  return after;
}

/** 承諾の失敗の理由（取引先に見せる文言と、宿・events に残す短い理由） */
export function groupAcceptFailure(message: string): { partnerMessage: string; reason: string } {
  if (/sold_out:/.test(message)) return { partnerMessage: '満室のため確定できませんでした。宿からご連絡します。', reason: `残室不足（${friendlyRpcError(message)}）` };
  if (message.includes('credit_over_requires_deposit')) return { partnerMessage: '受付枠を超えるため、宿が確認中です。宿からご連絡します。', reason: '受付枠（与信）の超過' };
  if (message.includes('invalid_room_count')) return { partnerMessage: 'ご予約を確定できませんでした。宿からご連絡します。', reason: '室数が上限を超えています' };
  return { partnerMessage: friendlyRpcError(message), reason: friendlyRpcError(message) };
}

export type AcceptedGroupInquiry = { inquiryId: string; bookingId: string; bookingCode: string };

/**
 * 承諾（§7.6・§5.4）: 回答額で既存の RPC rms_partner_create_booking を呼び、台帳・PMS に予約を作る。
 * 楽観ロック: 先に status を offered → accepted に（1 行取れなければ 409）→ RPC → 失敗なら offered に戻す。
 * 見積はやり直さない（料金は宿の回答＝約束・承諾までに料金が変わっても追随しない）。aal2 は求めない（N14）。
 */
export async function acceptGroupInquiry(
  db: SupabaseClient,
  partner: PartnerContext,
  account: { id: string; login_id: string },
  id: string,
  meta: {
    ip: string | null;
    origin: string;
    /** 取引先が画面で見ていた照会の updated_at（承諾フォームの hidden）。違えば宿が回答を直したとして止める */
    expectedUpdatedAt?: string | null;
  }
): Promise<AcceptedGroupInquiry> {
  const row = await getGroupInquiryRow(db, id, { partnerId: partner.id });
  if (!row) throw new PartnerStoreError('照会が見つかりません。', 404, 'not_found');
  if (!canAccept(row)) throw acceptBlocked(row);
  // 画面を開いた後に宿が回答を直していたら、見ていない料金・条件で確定しない
  if (meta.expectedUpdatedAt && !sameTimestamp(meta.expectedUpdatedAt, row.updated_at)) throw answerChanged();
  if (!isValidPriceRooms(row.answer_rooms ?? row.quote_rooms, row.rooms, groupNightDates(row.check_in_date, row.nights))) {
    throw new PartnerStoreError('料金が決まっていないため承諾できません。宿へお問い合わせください。', 409, 'no_price');
  }
  const ctx = await loadPartnerContextAt(db, partner.id, row.facility_id);
  if (!ctx || !ctx.facility_available || !ctx.booking_enabled) throw new PartnerStoreError('現在ご予約を受け付けていません。宿へお問い合わせください。', 409);

  // 楽観ロック（二重承諾の防止・§5.4）。読んだ時点の updated_at も条件に入れ、その間に宿が回答を直した行はロックしない。
  // RPC に渡す料金・予約者・付帯情報・入湯税・受付枠の承認は、ロックで返った行（ロック後の値）から組む
  const nowIso = new Date().toISOString();
  const { data: lockedData, error: lockError } = await db
    .from(TABLE)
    .update({ status: 'accepted', accepted_at: nowIso, accepted_by: account.login_id })
    .eq('id', row.id)
    .eq('partner_id', partner.id)
    .eq('status', 'offered')
    .eq('updated_at', row.updated_at)
    .is('booking_id', null)
    .or(`answer_expires_at.is.null,answer_expires_at.gt.${nowIso}`)
    .select(COLUMNS)
    .maybeSingle();
  if (lockError) dbError(lockError, '承諾できませんでした。時間をおいてお試しください。');
  if (!lockedData) {
    // ロックできなかった理由を読み直して返す（期限切れ・回答の更新・それ以外の状態の変化）
    const fresh = await getGroupInquiryRow(db, row.id, { partnerId: partner.id }).catch(() => null);
    if (fresh && isExpiredNow(fresh)) throw expiredError();
    if (fresh && fresh.status === 'offered' && !sameTimestamp(fresh.updated_at, row.updated_at)) throw answerChanged();
    throw new PartnerStoreError('照会の状態が変わりました。画面を読み直してください。', 409, 'conflict');
  }
  const locked = lockedData as GroupInquiryRow;
  const priced = locked.answer_rooms ?? locked.quote_rooms;
  if (!isValidPriceRooms(priced, locked.rooms, groupNightDates(locked.check_in_date, locked.nights))) {
    // 念のため（updated_at が同じなので通常は起きない）: 回答ありに戻す
    await revertAccepted(db, locked);
    throw new PartnerStoreError('料金が決まっていないため承諾できません。宿へお問い合わせください。', 409, 'no_price');
  }

  const booker = normalizeBooker(locked.booker);
  const extras = buildBookingExtras(booker, locked.extras?.transport?.value ?? '', []);
  const dinner = locked.extras?.dinnerTime?.value ?? '';
  const options = [...extraOptionRows(extras), ...(dinner ? [{ label: '夕食開始時間', value: dinner }] : [])];
  const notes = [locked.extras?.note ?? '', locked.answer_message ? `宿からの回答: ${locked.answer_message}` : ''].filter(Boolean).join('\n').slice(0, 1000);
  // 名義（N5）: 旅行会社名義なら代表者は旅行会社（RPC が決める）・部屋別の名前は団体名。宿泊者名義なら「団体名 御一行」
  const partnerName = ctx.booking_name_mode === 'partner' && !!ctx.pms_guest_id;
  const { data, error } = await db.rpc('rms_partner_create_booking', {
    p: {
      partner_id: ctx.id,
      facility_id: ctx.facility_id,
      account_id: account.id,
      booked_by: account.login_id,
      room_code: locked.room_code,
      room_name: locked.room_name,
      plan_code: locked.plan_code,
      plan_name: locked.plan_name,
      meal_type: locked.meal_type,
      check_in: locked.check_in_date,
      check_out: locked.check_out_date,
      rooms: priced!.map((r) => ({ adults: r.adults, nights: r.nights.map((n) => ({ date: n.date, unit_price: n.unit_price })) })),
      guest: {
        family_name: locked.group_name,
        given_name: partnerName ? '' : '御一行',
        family_name_kana: '',
        given_name_kana: '',
        phone: booker.phone,
        email: '',
        zip_code: '',
        address: '',
        allergies: ''
      },
      arrival: '',
      options,
      notes,
      payment_option: locked.payment_option,
      payment_label: locked.payment_label,
      bath_tax: locked.answer_bath_tax ?? locked.quote_bath_tax ?? 0,
      prepay_discount: 0,
      await_payment: false,
      group: { inquiry_id: locked.id, inquiry_code: locked.inquiry_code, group_name: locked.group_name, batch_id: locked.batch_id },
      credit_override: locked.credit_override === true
    }
  });
  if (error) {
    const f = groupAcceptFailure(error.message);
    // 照会は回答ありのまま（offered に戻す）
    await revertAccepted(db, locked);
    await addEvent(db, locked.id, 'accept_failed', 'partner', account.login_id, { reason: f.reason });
    await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'group_inquiry_accept_failed', detail: { inquiry_code: locked.inquiry_code, reason: f.reason }, ip: meta.ip });
    await sendGroupAcceptFailedMail(db, ctx, locked, f.reason, meta.origin).catch(() => false);
    throw new PartnerStoreError(f.partnerMessage, 409, 'accept_failed');
  }
  const created = data as { id: string; booking_code: string };
  // 結べなかった（bindError）・ここで処理が止まったときは、cron の recoverStuckGroupAccepts が予約を逆引きして結び直す
  const { error: bindError } = await db.from(TABLE).update({ booking_id: created.id }).eq('id', locked.id).eq('partner_id', partner.id);
  if (bindError) console.error('[group-inquiry] 予約を照会に結べませんでした:', locked.inquiry_code, created.booking_code, bindError.message);
  await attachBookingExtras(db, ctx.id, created.id, extras, locked.plan_display_name || partnerPlanName(ctx.booking_settings.planNames, locked.plan_code, locked.plan_name));
  await snapshotCancelPolicy(db, ctx.facility_id, created.id, locked.plan_code, locked.plan_name).catch(() => undefined);
  await addEvent(db, locked.id, 'accepted', 'partner', account.login_id, { booking_code: created.booking_code });
  await logPartnerAccess(db, { partnerId: partner.id, accountId: account.id, channel: 'web', action: 'group_inquiry_accept', detail: { inquiry_code: locked.inquiry_code, booking_code: created.booking_code }, ip: meta.ip });
  const booking = await getPartnerBooking(db, ctx.id, created.id);
  if (booking) await sendBookingMails(db, ctx, booking, 'new', meta.origin, account.id).catch(() => false);
  return { inquiryId: locked.id, bookingId: created.id, bookingCode: created.booking_code };
}

/** timestamptz の文字列の一致（同じ文字列か、同じ時刻か） */
function sameTimestamp(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (a === b) return true;
  const ta = Date.parse(a);
  return Number.isFinite(ta) && ta === Date.parse(b);
}

/** 期限切れか（expired・または offered で期限を過ぎた） */
const isExpiredNow = (r: Pick<GroupInquiryRow, 'status' | 'answer_expires_at'>) =>
  r.status === 'expired' || (r.status === 'offered' && !!r.answer_expires_at && new Date(r.answer_expires_at).getTime() <= Date.now());

const expiredError = () => new PartnerStoreError('ご回答の期限が過ぎました。「同じ条件でもう一度」から照会し直してください。', 409, 'expired');
const answerChanged = () => new PartnerStoreError('宿の回答が更新されました。内容をご確認のうえ、あらためて承諾してください。', 409, 'conflict');

/** 承諾できない照会の理由（期限切れ・それ以外） */
function acceptBlocked(row: GroupInquiryRow): PartnerStoreError {
  if (isExpiredNow(row)) return expiredError();
  return new PartnerStoreError('この照会は承諾できません。画面を読み直してください。', 409, 'conflict');
}

/** 承諾のロック（accepted・予約なし）を回答ありに戻す。自分が取ったロックだけ（accepted_at で絞る） */
async function revertAccepted(db: SupabaseClient, locked: Pick<GroupInquiryRow, 'id' | 'accepted_at'>) {
  let q = db.from(TABLE).update({ status: 'offered', accepted_at: null, accepted_by: null }).eq('id', locked.id).eq('status', 'accepted').is('booking_id', null);
  if (locked.accepted_at) q = q.eq('accepted_at', locked.accepted_at);
  const { error } = await q;
  if (error) console.error('[group-inquiry] 承諾のロックを戻せませんでした:', locked.id, error.message);
}

// ---------------------------------------------------------------------------
// 宿の回答
// ---------------------------------------------------------------------------

/**
 * 回答の料金の決め方（§7.2）:
 *   auto  … 自動計算額のまま（quote_status=ok のときだけ）
 *   keep  … 今の回答額のまま（回答済みの修正で、期限・一言だけ変えるとき。回答額が無ければ auto と同じ）
 *   unit  … 人数の段ごとの1名単価で上書き（管理者のみ）
 *   total … 合計を直接入力 → 人泊で均等割（管理者のみ）
 */
export type GroupPriceMode = 'auto' | 'keep' | 'unit' | 'total';

export type GroupAnswerInput = {
  answer: GroupAnswer;
  message: string;
  /** 回答の有効期限（YYYY-MM-DD・その日の 23:59 JST まで）。空なら既定（groupAnswerDays 日後・回答済みの修正は今の期限） */
  expiresOn: string | null;
  priceMode: GroupPriceMode;
  /** priceMode=unit: 人数の段（'1'〜'6'）→ 1名1泊の単価（税込・入湯税別） */
  unitPrices: Record<string, number>;
  /** priceMode=total: 宿泊料金の合計（税込・入湯税別） */
  total: number | null;
  /** 受付枠を超えても受ける（管理者のみ） */
  creditOverride: boolean;
};

export type GroupStaff = { userId: string | null; name: string; isAdmin: boolean };

/** 管理画面のフォーム（FormData）から回答の入力を読む */
export function parseGroupAnswerForm(fd: FormData): GroupAnswerInput {
  const str = (k: string) => String(fd.get(k) ?? '').trim();
  const answer = str('answer');
  const priceMode = str('priceMode');
  const unitPrices: Record<string, number> = {};
  for (let n = 1; n <= 20; n += 1) {
    const v = str(`unit_${n}`).replace(/[,，円\s]/g, '');
    if (v) unitPrices[String(n)] = Math.round(Number(v));
  }
  const totalRaw = str('total').replace(/[,，円\s]/g, '');
  return {
    answer: answer === 'ok' || answer === 'conditional' || answer === 'declined' ? answer : ('' as GroupAnswer),
    message: str('message').slice(0, MAX_GROUP_ANSWER_MESSAGE_LENGTH),
    // 形・実在の検証は answerGroupInquiry（不正なら 400）。空なら既定
    expiresOn: str('expiresOn').slice(0, 20) || null,
    priceMode: priceMode === 'unit' || priceMode === 'total' || priceMode === 'keep' ? priceMode : 'auto',
    unitPrices,
    total: totalRaw ? Math.round(Number(totalRaw)) : null,
    creditOverride: ['on', 'true', '1'].includes(str('creditOverride'))
  };
}

/** 回答の料金を組み立てる（純粋な部分は lib/partner-group.ts）。返り値の rooms は承諾時に RPC へ渡す形 */
async function answerPrice(db: SupabaseClient, row: GroupInquiryRow, input: GroupAnswerInput, staff: GroupStaff) {
  const dates = groupNightDates(row.check_in_date, row.nights);
  const mode: GroupPriceMode = input.priceMode === 'keep' && !row.answer_rooms ? 'auto' : input.priceMode;
  if ((mode === 'unit' || mode === 'total') && !staff.isAdmin) throw new PartnerStoreError('料金を変えられるのは管理者だけです。自動計算額のまま回答するか、管理者に依頼してください。', 403, 'forbidden');
  let rooms: GroupPriceRoom[] | null = null;
  if (mode === 'keep') rooms = row.answer_rooms;
  else if (mode === 'auto') {
    if (row.quote_status !== 'ok' || !row.quote_rooms) {
      throw new PartnerStoreError('自動計算の料金がありません（料金の無い日・人数を含みます）。料金を入力して回答してください（管理者）。', 400);
    }
    rooms = withSubtotals(row.quote_rooms);
  } else if (mode === 'unit') {
    // 入力された単価の桁違い（上限超え・数でない値）は、自動計算の単価に黙って戻さず 400
    if (Object.values(input.unitPrices).some((v) => !Number.isFinite(v) || v > GROUP_MAX_UNIT_PRICE)) {
      throw new PartnerStoreError(`1名1泊あたりの料金は ${GROUP_MAX_UNIT_PRICE.toLocaleString('ja-JP')} 円以下の数で入力してください。`, 400);
    }
    rooms = overrideUnitPrices(row.rooms, dates, input.unitPrices, row.quote_rooms);
    if (!rooms) throw new PartnerStoreError('すべての人数の段の1名単価を入力してください（自動計算の料金が無い段があります）。', 400);
  } else {
    if (input.total != null && Number.isFinite(input.total) && input.total >= GROUP_MAX_TOTAL_EXCLUSIVE) {
      throw new PartnerStoreError(`合計（宿泊料金）は ${GROUP_MAX_TOTAL_EXCLUSIVE.toLocaleString('ja-JP')} 円未満にしてください。`, 400);
    }
    const spread = input.total != null ? spreadTotalOverRooms(row.rooms, dates, input.total) : null;
    if (!spread) throw new PartnerStoreError('合計（宿泊料金）を正しく入力してください（1名1泊あたり1円以上）。', 400);
    rooms = spread.rooms;
  }
  if (!isValidPriceRooms(rooms, row.rooms, dates)) throw new PartnerStoreError('料金の内訳が照会の内容と合いません。画面を読み直してください。', 409);
  // 桁違いの入力・DB の integer を超える額は 400（1名1泊 1,000,000 円以下・合計 2,000,000,000 円未満）
  const limit = groupPriceLimitError(rooms);
  if (limit) throw new PartnerStoreError(limit, 400);
  // 入湯税: 照会時点の額があればそれ。無い（自動計算できなかった）ときは今の施設の規則で（個人予約と同じ式）
  let bathTax = row.quote_bath_tax;
  if (bathTax == null) {
    const rule = await bathTaxRule(db, row.facility_id);
    bathTax = rule.enabled ? rule.amount * row.adult_total * row.nights : 0;
  }
  if (mode === 'keep' && row.answer_bath_tax != null) bathTax = row.answer_bath_tax;
  return { rooms: rooms!, total: groupRoomsTotal(rooms!), bathTax, changed: mode === 'unit' || mode === 'total' || (mode === 'keep' && row.answer_total !== row.quote_total) };
}

/**
 * 宿の回答（新着・回答済みの修正）。権限: 呼び出し側で施設のアクセスを確かめること。料金の変更・受付枠超過の承認は管理者だけ（N2）。
 * opts.notify=false なら取引先へのメールを送らない（束の一括回答で1通にまとめるとき）。
 * 返り値の mailed: 取引先へ回答のメールを実際に送ったか（通知オフ・宛先なし・送信の失敗・notify=false は false）
 */
export async function answerGroupInquiry(
  db: SupabaseClient,
  staff: GroupStaff,
  row: GroupInquiryRow,
  input: GroupAnswerInput,
  opts: { origin: string; notify?: boolean; now?: Date }
): Promise<{ row: GroupInquiryRow; mailed: boolean }> {
  if (!canAnswer(row)) throw new PartnerStoreError('この照会には回答できません（承諾済み・終了した照会）。', 409, 'conflict');
  if (!input.answer) throw new PartnerStoreError('回答（受けられる／条件付き／受けられない）を選んでください。', 400);
  // 回答の期限は実在する日付だけ（2026-02-30・2026-13-01 等は 400。日付の計算で 500 にしない）
  if (input.expiresOn && !isRealIsoDate(input.expiresOn)) throw new PartnerStoreError('回答の有効期限の日付が正しくありません。', 400);
  if (input.creditOverride && !staff.isAdmin) throw new PartnerStoreError('受付枠を超えて受けると決められるのは管理者だけです。', 403, 'forbidden');
  const now = opts.now ?? new Date();
  const message = input.message.trim().slice(0, MAX_GROUP_ANSWER_MESSAGE_LENGTH);
  const base = { answer: input.answer, answer_message: message || null, answered_at: now.toISOString(), answered_by: staff.userId, answered_by_name: staff.name.slice(0, 120) || null };
  let patch: Record<string, unknown>;
  let detail: Record<string, unknown>;
  if (input.answer === 'declined') {
    patch = { ...base, status: 'declined', answer_rooms: null, answer_total: null, answer_bath_tax: null, answer_expires_at: null, credit_override: false, closed_at: now.toISOString(), closed_reason: 'declined' };
    detail = { answer: 'declined', message: message || null };
  } else {
    if (input.answer === 'conditional' && !message) throw new PartnerStoreError('条件付きのときは、取引先への一言（条件）を入力してください。', 400);
    const price = await answerPrice(db, row, input, staff);
    let expires: Date;
    if (input.expiresOn) expires = endOfDayJst(input.expiresOn);
    else if (row.status === 'offered' && row.answer_expires_at && new Date(row.answer_expires_at).getTime() > now.getTime()) expires = new Date(row.answer_expires_at);
    else {
      const ctx = await contextOf(db, row);
      const days = ctx?.booking_settings.groupAnswerDays ?? normalizePartnerBookingSettings({}).groupAnswerDays;
      expires = defaultAnswerExpiry(now, days, row.check_in_date);
    }
    if (expires.getTime() <= now.getTime()) throw new PartnerStoreError('回答の有効期限は今日以降の日付にしてください。', 400);
    if (expires.getTime() > endOfDayJst(row.check_in_date).getTime()) throw new PartnerStoreError('回答の有効期限はチェックイン日までにしてください。', 400);
    // 受付枠の超過の承認は管理者の明示（既存の承認を、スタッフの修正では外さない）
    const creditOverride = staff.isAdmin ? input.creditOverride : row.credit_override;
    patch = {
      ...base,
      status: 'offered',
      answer_rooms: price.rooms,
      answer_total: price.total,
      answer_bath_tax: price.bathTax,
      answer_expires_at: expires.toISOString(),
      credit_override: creditOverride,
      closed_at: null,
      closed_reason: null
    };
    detail = { answer: input.answer, message: message || null, total: price.total, bath_tax: price.bathTax, price_changed: price.changed, credit_override: creditOverride, expires_at: expires.toISOString() };
  }
  const { data, error } = await db.from(TABLE).update(patch).eq('id', row.id).eq('tenant_id', row.tenant_id).in('status', ['submitted', 'offered']).select(COLUMNS).maybeSingle();
  if (error) dbError(error, '回答を保存できませんでした。');
  if (!data) throw new PartnerStoreError('照会の状態が変わりました。画面を読み直してください。', 409, 'conflict');
  const after = data as GroupInquiryRow;
  await addEvent(db, row.id, 'answered', 'staff', staff.name || null, { ...detail, revised: row.status === 'offered' });
  if (row.partner_id) {
    await logPartnerAccess(db, {
      partnerId: row.partner_id,
      channel: 'admin',
      action: 'group_inquiry_answer',
      detail: { inquiry_code: row.inquiry_code, answer: input.answer, price_changed: detail.price_changed ?? false, credit_override: detail.credit_override ?? false, by: staff.name }
    });
  }
  let mailed = false;
  if (opts.notify !== false) {
    const ctx = await contextOf(db, after);
    if (ctx) mailed = await sendGroupAnswerMail(db, ctx, [after], opts.origin).catch(() => false);
  }
  return { row: after, mailed };
}

/**
 * 束の一括回答（§8.3「全件を受けられるにする」）: 束の中の新着（submitted）で自動計算できた件を、自動計算額のまま
 * 「受けられる」にする。料金の無い件・施設アクセスの無い件は飛ばす。取引先へのメールは取引先 × 施設ごとに1通（N9）。
 */
export async function answerGroupBatch(
  db: SupabaseClient,
  staff: GroupStaff,
  scope: { tenantId: string; facilityIds: string[] },
  batchId: string,
  input: Pick<GroupAnswerInput, 'message' | 'expiresOn'>,
  opts: { origin: string }
): Promise<{ answered: GroupInquiryRow[]; skipped: { inquiryCode: string; reason: string }[]; mailed: number }> {
  if (!isGroupInquiryId(batchId)) throw new PartnerStoreError('束が見つかりません。', 404, 'not_found');
  if (input.expiresOn && !isRealIsoDate(input.expiresOn)) throw new PartnerStoreError('回答の有効期限の日付が正しくありません。', 400);
  const { data, error } = await db.from(TABLE).select(COLUMNS).eq('batch_id', batchId).eq('tenant_id', scope.tenantId).order('batch_seq');
  if (error) dbError(error, '束を読み込めませんでした。');
  const rows = (data ?? []) as GroupInquiryRow[];
  if (!rows.length) throw new PartnerStoreError('束が見つかりません。', 404, 'not_found');
  const answered: GroupInquiryRow[] = [];
  const skipped: { inquiryCode: string; reason: string }[] = [];
  for (const r of rows) {
    if (!scope.facilityIds.includes(r.facility_id)) {
      skipped.push({ inquiryCode: r.inquiry_code, reason: 'この施設を扱う権限がありません' });
      continue;
    }
    if (r.status !== 'submitted') {
      skipped.push({ inquiryCode: r.inquiry_code, reason: '回答待ちではありません' });
      continue;
    }
    if (r.quote_status !== 'ok') {
      skipped.push({ inquiryCode: r.inquiry_code, reason: '自動計算の料金がありません（個別に回答してください）' });
      continue;
    }
    try {
      const res = await answerGroupInquiry(
        db,
        staff,
        r,
        { answer: 'ok', message: input.message, expiresOn: input.expiresOn, priceMode: 'auto', unitPrices: {}, total: null, creditOverride: false },
        { origin: opts.origin, notify: false }
      );
      answered.push(res.row);
    } catch (e) {
      skipped.push({ inquiryCode: r.inquiry_code, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  // 取引先 × 施設ごとに1通
  const groups = new Map<string, GroupInquiryRow[]>();
  for (const r of answered) {
    const key = `${r.partner_id}|${r.facility_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  // mailed: メールを実際に送れた照会の件数（通知オフ・宛先なしの取引先の分は数えない）
  let mailed = 0;
  for (const list of groups.values()) {
    const ctx = await contextOf(db, list[0]);
    if (ctx && (await sendGroupAnswerMail(db, ctx, list, opts.origin).catch(() => false))) mailed += list.length;
  }
  return { answered, skipped, mailed };
}

// ---------------------------------------------------------------------------
// 管理画面の詳細: 泊ごとの残室・受付枠
// ---------------------------------------------------------------------------

/** 泊ごとの残室（PMS と同じ規則・rms_partner_room_type_remaining）。読めなければ [] */
export async function groupNightlyRemaining(db: SupabaseClient, row: GroupInquiryRow): Promise<{ date: string; remaining: number }[]> {
  if (!row.room_type_id) return [];
  const { data, error } = await db.rpc('rms_partner_room_type_remaining', {
    p_facility_id: row.facility_id,
    p_room_type_id: row.room_type_id,
    p_from: row.check_in_date,
    p_to: row.check_out_date
  });
  if (error || !Array.isArray(data)) return [];
  return (data as { night_date: string; remaining: number }[]).map((r) => ({ date: r.night_date, remaining: r.remaining }));
}

/** 今の受付枠（月別・この照会ぶんを足した後）。予約確定・終了した照会は足さない。与信の対象外・読めなければ null */
export async function groupInquiryCredit(db: SupabaseClient, row: GroupInquiryRow): Promise<PartnerQuoteCredit | null> {
  const ctx = await contextOf(db, row);
  if (!ctx) return null;
  const open = row.status === 'submitted' || row.status === 'offered';
  return partnerStayCredit(db, ctx, row.check_in_date, row.nights, open ? row.room_count : 0).catch(() => null);
}

// ---------------------------------------------------------------------------
// 定期処理（cron）
// ---------------------------------------------------------------------------

/** 承諾の後始末の対象にするまでの時間（承諾のロックから10分。RPC の途中の照会には触らない） */
const STUCK_ACCEPT_MS = 10 * 60 * 1000;

/**
 * 照会から作られた予約（取引先予約の台帳 rms_partner_bookings）を逆引きする。見つからなければ null、読めなければ undefined。
 * RPC rms_partner_create_booking は同じトランザクションで
 *   booking.bookings.metadata.rms_partner_group_inquiry_id（→ rms_partner_bookings.booking_id が booking.bookings.id）と
 *   rms_partner_bookings.detail.group.inquiry_id
 * の両方に照会の id を書く。先に booking.bookings を見て、booking スキーマを Data API で読めない環境では台帳の detail.group で引く。
 */
async function findGroupInquiryBooking(db: SupabaseClient, inquiryId: string): Promise<{ id: string; booking_code: string } | null | undefined> {
  const viaBookings = await (db as unknown as AnySchema)
    .schema('booking')
    .from('bookings')
    .select('id')
    .eq('metadata->>rms_partner_group_inquiry_id', inquiryId)
    .limit(1);
  if (!viaBookings.error) {
    const bk = ((viaBookings.data ?? []) as { id: string }[])[0];
    if (bk) {
      const { data, error } = await db.from('rms_partner_bookings').select('id, booking_code').eq('booking_id', bk.id).maybeSingle();
      if (!error && data) return data as { id: string; booking_code: string };
    }
  }
  const { data, error } = await db.from('rms_partner_bookings').select('id, booking_code').eq('detail->group->>inquiry_id', inquiryId).limit(1);
  if (error) {
    console.error('[group-inquiry] 照会の予約を逆引きできませんでした:', inquiryId, error.message);
    return undefined;
  }
  return ((data ?? []) as { id: string; booking_code: string }[])[0] ?? null;
}

/**
 * 承諾の途中で止まった照会の後始末（cron・expireGroupInquiries の前に呼ぶ）。
 * 承諾は「status を accepted に（楽観ロック）→ RPC で予約 → booking_id を結ぶ」の順なので、途中で落ちる（Worker の打ち切り・
 * 結び付けの失敗 bindError）と status=accepted・booking_id なしのまま残り、取引先も宿も操作できなくなる。
 * accepted_at が10分より前のその行を:
 *   - 予約ができていれば、その台帳の id を booking_id に結び直す（events に accepted・recovered）
 *   - できていなければ offered に戻す（events に accept_failed・reason: interrupted）。期限を過ぎていれば続く期限切れの処理で expired になる
 */
export async function recoverStuckGroupAccepts(db: SupabaseClient, now = new Date()): Promise<{ rebound: number; reverted: number }> {
  const cutoff = new Date(now.getTime() - STUCK_ACCEPT_MS).toISOString();
  const { data, error } = await db
    .from(TABLE)
    .select('id, inquiry_code, accepted_at')
    .eq('status', 'accepted')
    .is('booking_id', null)
    .lt('accepted_at', cutoff)
    .order('accepted_at')
    .limit(50);
  if (error) {
    // 表が無い（migration 未適用）環境でも cron を落とさない
    console.error('[group-inquiry] 承諾の後始末の対象を読めませんでした:', error.message);
    return { rebound: 0, reverted: 0 };
  }
  let rebound = 0;
  let reverted = 0;
  for (const row of (data ?? []) as { id: string; inquiry_code: string; accepted_at: string | null }[]) {
    const booking = await findGroupInquiryBooking(db, row.id);
    if (booking === undefined) continue; // 読めなかった → 次の cron で
    if (booking) {
      const { data: bound, error: bindError } = await db
        .from(TABLE)
        .update({ booking_id: booking.id })
        .eq('id', row.id)
        .eq('status', 'accepted')
        .is('booking_id', null)
        .select('id')
        .maybeSingle();
      if (bindError) {
        console.error('[group-inquiry] 予約を照会に結び直せませんでした:', row.inquiry_code, booking.booking_code, bindError.message);
        continue;
      }
      if (bound) {
        rebound += 1;
        await addEvent(db, row.id, 'accepted', 'system', 'cron', { booking_code: booking.booking_code, recovered: true });
      }
      continue;
    }
    let q = db.from(TABLE).update({ status: 'offered', accepted_at: null, accepted_by: null }).eq('id', row.id).eq('status', 'accepted').is('booking_id', null);
    if (row.accepted_at) q = q.eq('accepted_at', row.accepted_at);
    const { data: back, error: backError } = await q.select('id').maybeSingle();
    if (backError) {
      console.error('[group-inquiry] 承諾の途中の照会を回答ありに戻せませんでした:', row.inquiry_code, backError.message);
      continue;
    }
    if (back) {
      reverted += 1;
      await addEvent(db, row.id, 'accept_failed', 'system', 'cron', { reason: 'interrupted' });
    }
  }
  return { rebound, reverted };
}

/** 回答の期限が過ぎた照会（offered）を expired に（メールは送らない・N8） */
export async function expireGroupInquiries(db: SupabaseClient, now = new Date()): Promise<{ expired: number }> {
  const { data, error } = await db
    .from(TABLE)
    .update({ status: 'expired', closed_at: now.toISOString(), closed_reason: 'expired' })
    .eq('status', 'offered')
    .lt('answer_expires_at', now.toISOString())
    .select('id');
  if (error) {
    // 表が無い（migration 未適用）環境でも cron を落とさない
    console.error('[group-inquiry] 期限切れの処理に失敗しました:', error.message);
    return { expired: 0 };
  }
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length) {
    await db
      .from(EVENTS)
      .insert(ids.map((id) => ({ inquiry_id: id, kind: 'expired', actor_kind: 'system', actor_label: 'cron', detail: null })))
      .then(
        () => undefined,
        () => undefined
      );
  }
  return { expired: ids.length };
}
