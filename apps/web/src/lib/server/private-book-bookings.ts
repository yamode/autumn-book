// 公式マイページ（/account/reservations/**）から、プライベートブック（特別会員の専用ページ経由）の予約を操作するときの共通部品
// （docs/private-book.md「マイページ（予約後）」「安全」）。判定の純関数は lib/private-book-booking.ts。
//
//   読み取り: 会員の authenticated クライアントで my_reservations（本人の予約だけ）→ 予約の写しの partnerId を取る
//   操作:     service_role の入口 book.member_page_*（lib/server/partners/member-bookings.ts）。DB が「このページ経由・予約した本人」を確かめる
//   変更の関所: 日程・お部屋の変更とアレンジは、今ページを使える方だけ（rms_member_page_access・ページが公開中）。取消は見ない
import type { RequestEvent } from '@sveltejs/kit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbMyReservations, type MemberReservation } from '$lib/server/supabase-data';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { loadPartnerContextAt, memberPageAccess, todayJst, type PartnerContext } from '$lib/server/partners/store';
import { privateBookChangeBlock, privateBookRouteOf, type PrivateBookRoute, type PrivateBookWho } from '$lib/private-book-booking';

/** ログイン中の会員の予約を 1 件（my_reservations・本人の予約だけ）と、その操作の行き先。無ければ null */
export async function privateBookReservationOf(
  event: RequestEvent,
  code: string
): Promise<{ r: MemberReservation; route: PrivateBookRoute } | null> {
  const r = (await sbMyReservations(createSupabaseServerClient(event))).find((x) => x.code === code);
  if (!r) return null;
  return { r, route: privateBookRouteOf(r, event.locals.user?.role === 'member' ? event.locals.user.id : null) };
}

/**
 * 日程・お部屋の変更とアレンジの追加の前に呼ぶ: 今ページを使える方か（対象者・公開中）を確かめ、
 * 料金の計算に使う専用ページ（予約した施設で合成）を返す。だめなら { ok: false, message }（案内の文言）
 */
export async function privateBookChangeGate(
  who: PrivateBookWho,
  facilityUuid: string
): Promise<{ ok: true; db: SupabaseClient; partner: PartnerContext } | { ok: false; message: string }> {
  const db = partnerServiceClient();
  if (!db) return { ok: false, message: 'お手続きできませんでした。時間をおいてお試しください。' };
  const [access, partner] = await Promise.all([
    memberPageAccess(db, who.partnerId, who.memberUserId),
    loadPartnerContextAt(db, who.partnerId, facilityUuid).catch(() => null)
  ]);
  const block = privateBookChangeBlock({ access, page: partner }, todayJst());
  if (block || !partner) return { ok: false, message: block ?? 'お手続きできませんでした。' };
  return { ok: true, db, partner };
}

/** 予約詳細の画面に出すか（変更・アレンジのボタン）。読めなければ出さない */
export async function privateBookCanChange(who: PrivateBookWho, facilityUuid: string): Promise<boolean> {
  return (await privateBookChangeGate(who, facilityUuid).catch(() => ({ ok: false as const }))).ok;
}
