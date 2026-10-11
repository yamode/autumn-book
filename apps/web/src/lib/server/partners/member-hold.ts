// 特別会員の専用ページ（kind='member'）の予約: 専用料金（料金ルール・quotePartnerBooking）で泊明細を作り、
// 会員の公式予約の束（book.create_member_page_hold_group）として仮押さえする（docs/vip-member-page.md §13.4.3・§14）。
//
//   /p/<token>/book の POST（member のとき）→ memberPageHold → 303 /booking/hold?id=<束 id>（確認・確定・決済は公式の画面）
//
// 料金の正しさはサーバ（ここ）が持つ: 画面の金額は受け取らず、部屋タイプ・プランの組ごとに quotePartnerBooking を呼び直す。
// RPC は泊明細の形だけを検査する（取引先予約 rms_partner_create_booking と同じ流儀）。対象者は TS（resolvePortal）と RPC の両方で確かめる。
import type { SupabaseClient } from '@supabase/supabase-js';
import { canBookFor, perksForPlan } from '$lib/partner-booking';
import {
  groupMemberHoldRooms,
  memberMaxRooms,
  memberPageBookingOpen,
  memberPageInput,
  parseMemberHoldRooms,
  perksSnapshotOf,
  toHoldLines,
  type MemberHoldRoom,
  type MemberLine
} from '$lib/partner-member-page';
import { paymentMethodsOf } from '$lib/member-payment';
import { payCompatible } from '$lib/multi-room';
import { holdErrorKind } from '$lib/server/hold-rate-limit';
import { quotePartnerBooking } from './booking';
import { PartnerStoreError, todayJst, type PartnerContext, type PartnerSessionAccount } from './store';

/** 専用ページで予約できるプラン（公式サイトで公開しているプランだけ）と支払方法（会員の支払方法） */
export type MemberPagePlan = { ratePlanId: string; planCode: string; planLabel: string; pay: { onsite: boolean; prepay: boolean } };

/** キーは料金カレンダーの planCode■planName（= booking.rate_plans.code） */
export const memberPlanKey = (planCode: string, planName: string) => `${planCode}■${planName}`;

/** 施設の公開プラン（book.member_page_plans・service_role）。読めなければ空 */
export async function loadMemberPagePlans(db: SupabaseClient, facilityId: string): Promise<Map<string, MemberPagePlan>> {
  const { data, error } = await db.schema('book').rpc('member_page_plans', { p_facility_id: facilityId });
  const out = new Map<string, MemberPagePlan>();
  if (error || !Array.isArray(data)) return out;
  for (const r of data as Record<string, unknown>[]) {
    const pm = paymentMethodsOf(r.payment_method) ?? { onsite: true, prepay: false };
    const planCode = String(r.plan_code ?? '');
    const planLabel = String(r.plan_label ?? '');
    out.set(memberPlanKey(planCode, planLabel), { ratePlanId: String(r.rate_plan_id), planCode, planLabel, pay: { onsite: pm.onsite, prepay: pm.prepay } });
  }
  return out;
}

export type MemberHoldFailure = {
  status: number;
  message: string;
  code: 'sold_out' | 'rate_limited' | 'too_many_holds' | 'forbidden' | 'closed' | 'too_many_rooms' | 'mixed_payment' | 'invalid';
  /** 満室だった部屋（専用ページの識別: roomTypeId は部屋タイプのコード） */
  soldOut?: { roomTypeId: string; roomName: string }[];
};

export type MemberHoldResult = { ok: true; groupId: string; checkIn: string; nights: number; rooms: MemberHoldRoom[] } | ({ ok: false } & MemberHoldFailure);

const fail = (status: number, code: MemberHoldFailure['code'], message: string, soldOut?: MemberHoldFailure['soldOut']): MemberHoldResult => ({
  ok: false,
  status,
  code,
  message,
  ...(soldOut ? { soldOut } : {})
});

export const MEMBER_HOLD_RATE_LIMITED = 'お申し込みが集中しています。しばらく時間をおいてからお試しください。';
const TOO_MANY_ROOMS = (max: number) => `1回のご予約は${max}室までです。${max + 1}室以上はお電話でお問い合わせください。`;

/** 部屋ごとの専用料金の泊明細と特典（quotePartnerBooking を部屋タイプ・プランの組ごとに呼ぶ） */
export type MemberRoomQuote = MemberHoldRoom & { lines: MemberLine[]; total: number; roomName: string; perks: ReturnType<typeof perksSnapshotOf> };

/**
 * 部屋ごとの専用料金を出す（仮押さえ・確認画面で共用）。料金を出せない部屋があれば失敗（quotePartnerBooking の文言）。
 * 残室が足りない部屋タイプは sold_out（DB でも在庫を確かめる）
 */
export async function quoteMemberRooms(
  db: SupabaseClient,
  partner: PartnerContext,
  rooms: readonly MemberHoldRoom[],
  checkIn: string,
  nights: number,
  opts: { ignoreRemaining?: boolean } = {}
): Promise<{ ok: true; rooms: MemberRoomQuote[] } | ({ ok: false } & MemberHoldFailure)> {
  const out: (MemberRoomQuote | null)[] = rooms.map(() => null);
  const groups = groupMemberHoldRooms(rooms);
  const quotes = await Promise.all(
    groups.map((g) =>
      quotePartnerBooking(
        db,
        partner,
        { roomCode: g.roomCode, planCode: g.planCode, planName: g.planName, checkIn, nights, rooms: g.indexes.map((i) => ({ adults: rooms[i].adults })) },
        { credit: false }
      )
    )
  );
  for (let gi = 0; gi < groups.length; gi += 1) {
    const g = groups[gi];
    const q = quotes[gi];
    if (!q.ok) return { ok: false, status: 400, code: 'invalid', message: q.message };
    const sameType = rooms.filter((r) => r.roomCode === g.roomCode).length;
    if (!opts.ignoreRemaining && q.remaining !== null && q.remaining < sameType) {
      return { ok: false, status: 409, code: 'sold_out', message: 'ただいま満室になりました。お手数ですが別の日程をお試しください。', soldOut: [{ roomTypeId: g.roomCode, roomName: q.roomName }] };
    }
    const perks = perksSnapshotOf(perksForPlan(partner.booking_settings.perks, g.planCode), g.planCode);
    g.indexes.forEach((roomIdx, k) => {
      const qr = q.rooms[k];
      const lines = toHoldLines(qr);
      out[roomIdx] = { ...rooms[roomIdx], lines, total: lines.reduce((s, l) => s + l.subtotal, 0), roomName: q.roomName, perks };
    });
  }
  return { ok: true, rooms: out as MemberRoomQuote[] };
}

/** 確認画面・会員特典の「キャンセル方式」の表示（施設の設定） */
export function memberCancelSetting(partner: Pick<PartnerContext, 'booking_settings'>) {
  return { mode: partner.booking_settings.cancelPolicyMode, rules: partner.booking_settings.cancelRules };
}

/**
 * 専用ページの「予約へ進む」（POST /p/<token>/book・member のとき）。
 * fd: rooms（JSON `[{roomCode, planCode, planName, adults}]`）か 1 タップのフィールド（room / plan / name / guests / rooms=N）・
 *     checkin（または date）・nights・facility_id（画面を開いたときの施設）
 * 成功: 束 id。呼び出し側が HOLD_NAV_COOKIE を書いて 303 /booking/hold?id=<束 id>
 */
export async function memberPageHold(args: {
  db: SupabaseClient;
  /** 施設はフォームの施設で合成し直したもの（portalFacilityContext） */
  partner: PartnerContext;
  session: PartnerSessionAccount;
  fd: FormData;
  /** 公式と同じ仮押さえのセッション（cookie ab_book_sid・path /） */
  sessionId: string;
  clientKey: string;
  locale?: string;
}): Promise<MemberHoldResult> {
  const { db, partner, session, fd } = args;
  const member = session.member;
  if (!member || session.preview) return fail(403, 'forbidden', 'ご招待の会員さまでログインしてください。');
  if (!memberPageBookingOpen(partner)) return fail(400, 'closed', '現在ご予約を受け付けていません。');
  const s = partner.booking_settings;
  const maxRooms = memberMaxRooms(s);
  const parsed = parseMemberHoldRooms((k) => fd.get(k), maxRooms);
  if (!parsed.ok) {
    if (parsed.code === 'too_many_rooms') return fail(400, 'too_many_rooms', TOO_MANY_ROOMS(maxRooms));
    return fail(400, 'invalid', parsed.code === 'missing' ? 'お部屋・プランを選んでください。' : 'お部屋の選び方を確認してください。');
  }
  const rooms = parsed.rooms;
  const checkIn = String(fd.get('checkin') ?? fd.get('date') ?? '');
  const nights = Math.round(Number(fd.get('nights') ?? 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || checkIn < todayJst()) return fail(400, 'invalid', '宿泊日を選び直してください。');
  if (!Number.isInteger(nights) || nights < 1 || nights > s.maxNights) return fail(400, 'invalid', `泊数は1〜${s.maxNights}泊で選んでください。`);
  if (!canBookFor(checkIn, s)) return fail(400, 'closed', 'この日程のご予約の受付は締め切りました。');

  // 支払方法が両立しないプランは同じ予約にできない（公式と同じ・Q3）。公式サイトで公開していないプランは選べない（Q1）
  const plans = await loadMemberPagePlans(db, partner.facility_id);
  const picked = rooms.map((r) => plans.get(memberPlanKey(r.planCode, r.planName)));
  if (picked.some((p) => !p)) return fail(400, 'invalid', 'このプランは専用ページからご予約いただけません。日程やプランを選び直してください。');
  if (!payCompatible(picked.map((p) => p!.pay))) {
    return fail(400, 'mixed_payment', '現地払いだけのプランと事前決済だけのプランは、同じご予約にできません。');
  }

  const quoted = await quoteMemberRooms(db, partner, rooms, checkIn, nights);
  if (!quoted.ok) return quoted;

  const { data, error } = await db.schema('book').rpc('create_member_page_hold_group', {
    p_session_id: args.sessionId,
    p_member_user_id: member.userId,
    p_partner_id: partner.id,
    p_facility_id: partner.facility_id,
    p_checkin: checkIn,
    p_nights: nights,
    p_rooms: quoted.rooms.map((r) => ({
      rate_plan_code: memberPlanKey(r.planCode, r.planName),
      room_type_code: r.roomCode,
      adults: r.adults,
      lines: r.lines,
      member_perks: r.perks
    })),
    p_member_page: memberPageInput(partner.name, s.cancelPolicyMode, s.cancelRules),
    p_client_key: args.clientKey,
    p_locale: args.locale ?? 'ja'
  });
  if (error) {
    const msg = error.message ?? '';
    const kind = holdErrorKind(msg);
    if (kind === 'rate_limited' || kind === 'too_many_holds') return fail(429, kind, MEMBER_HOLD_RATE_LIMITED);
    if (kind === 'sold_out') {
      const id = /sold_out:([0-9a-f-]{36})/i.exec(msg)?.[1] ?? null;
      const roomName = id ? await roomNameOf(db, id) : '';
      const roomCode = id ? await roomCodeOf(db, id) : '';
      return fail(409, 'sold_out', 'ただいま満室になりました。お手数ですが別の日程をお試しください。', roomCode ? [{ roomTypeId: roomCode, roomName }] : []);
    }
    if (msg.includes('forbidden')) return fail(403, 'forbidden', 'このページはご招待の会員さま専用です。');
    if (msg.includes('page_unavailable')) return fail(400, 'closed', '現在ご予約を受け付けていません。');
    if (msg.includes('invalid_room_count')) return fail(400, 'too_many_rooms', TOO_MANY_ROOMS(maxRooms));
    if (msg.includes('invalid_lines')) {
      // サーバの計算と RPC の検査が合わない（不具合）。ログに残して 400
      console.error('[member-hold] invalid_lines', { partnerId: partner.id, checkIn, nights, rooms });
      return fail(400, 'invalid', '料金を確かめられませんでした。画面を読み直してください。');
    }
    if (/plan_not_found|room_not_found|not_sellable|min_stay|invalid_params/.test(msg)) {
      return fail(400, 'invalid', 'このプラン・お部屋は現在ご予約いただけません。日程や人数を選び直してください。');
    }
    throw new PartnerStoreError('仮押さえできませんでした。時間をおいてお試しください。', 500, 'db_error');
  }
  const groupId = String((data as { group_id?: string } | null)?.group_id ?? '');
  if (!groupId) throw new PartnerStoreError('仮押さえできませんでした。', 500, 'db_error');
  return { ok: true, groupId, checkIn, nights, rooms };
}

async function roomNameOf(db: SupabaseClient, roomTypeId: string): Promise<string> {
  const { data } = await db.schema('pms').from('room_types').select('name').eq('id', roomTypeId).maybeSingle();
  return String((data as { name?: string } | null)?.name ?? '');
}
async function roomCodeOf(db: SupabaseClient, roomTypeId: string): Promise<string> {
  const { data } = await db.schema('pms').from('room_types').select('code').eq('id', roomTypeId).maybeSingle();
  return String((data as { code?: string } | null)?.code ?? '');
}

/** 「選び直す」で専用ページへ戻る先（料金カレンダー・同じ日程・人数・室数・施設） */
export function memberHoldBack(token: string, partner: Pick<PartnerContext, 'facility_slug'>, checkIn: string, nights: number, rooms: readonly MemberHoldRoom[]): string {
  const q = new URLSearchParams({ date: checkIn, nights: String(nights), guests: String(rooms[0]?.adults ?? 2), f: partner.facility_slug });
  return `/p/${token}/calendar?${q.toString()}`;
}
