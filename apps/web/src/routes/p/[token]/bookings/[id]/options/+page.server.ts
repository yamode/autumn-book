// 特別会員の専用ページ: 滞在アレンジ（オプション）の追加（/p/<token>/bookings/<予約番号>/options・docs/vip-member-page.md §13.4.3b）。
// 公式マイページの options と同じ画面・契約（部屋の選択・action ?/add）。追加は service_role の入口 book.member_page_add_booking_options。
import { error, fail, redirect } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbListOptionItems, sbMyReservations, sbRoomTypeByUuid } from '$lib/server/supabase-data';
import { memberPageHrefOf } from '$lib/partner-member-page';
import { memberPageAddOptions, memberPageReservations } from '$lib/server/partners/member-bookings';
import { deferTask, portalHeader, portalLogActor, PORTAL_HEADERS, requestMeta, requireMemberPortal, requirePortalSession } from '$lib/server/partners/portal';
import { logPartnerAccess, type PartnerContext, type PartnerSessionAccount } from '$lib/server/partners/store';
import type { RequestEvent } from '@sveltejs/kit';

// RPC の例外 → 文言（公式マイページの options と同じ考え方）
function optionErrorMessage(msg: string): string {
  if (msg.includes('past_deadline')) return 'お申し込みの締切を過ぎています。';
  if (msg.includes('option_sold_out')) return '在庫がありません。';
  if (msg.includes('invalid_service_date')) return 'ご利用日を選び直してください。';
  if (msg.includes('invalid_quantity')) return '数量を確かめてください。';
  if (msg.includes('not_amendable')) return 'このご予約には現在アレンジを追加できません。';
  if (msg.includes('forbidden') || msg.includes('not_member_page_booking')) return 'このご予約はお手続きいただけません。';
  return 'アレンジを追加できませんでした。';
}

async function ownReservation(event: RequestEvent, partner: PartnerContext, session: PartnerSessionAccount, code: string) {
  if (!session.member) throw error(404, '確認モードではアレンジを追加できません。');
  const all = await sbMyReservations(createSupabaseServerClient(event)).catch(() => {
    throw error(503, 'ご予約を読み込めませんでした。時間をおいてお試しください。');
  });
  const r = memberPageReservations(all, partner.id, session.member.userId).find((x) => x.code === code);
  if (!r) throw error(404, 'ご予約が見つかりません。');
  return r;
}

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { partner, session } = await requirePortalSession(event);
  requireMemberPortal(partner);
  const r = await ownReservation(event, partner, session, event.params.id);
  if (r.status !== 'reserved') throw redirect(303, memberPageHrefOf(event.params.token, r.code));
  const items = await sbListOptionItems(r.facilityUuid, 'ja');
  // 複数室の予約: どのお部屋のアレンジかを選ぶ（生きている部屋だけ）
  const live = (r.rooms ?? []).filter((x) => !x.cancelled);
  const rooms =
    (r.rooms?.length ?? 0) > 1
      ? await Promise.all(
          live.map(async (x) => ({ index: x.index, roomName: (await sbRoomTypeByUuid(x.roomTypeId).catch(() => undefined))?.name ?? '', adults: x.adults }))
        )
      : [];
  return {
    portal: portalHeader(partner, session),
    code: r.code,
    checkin: r.checkin,
    checkout: r.checkout,
    items,
    rooms,
    hrefs: { back: memberPageHrefOf(event.params.token, r.code) }
  };
};

export const actions = {
  add: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    requireMemberPortal(partner);
    const r = await ownReservation(event, partner, session, event.params.id);
    const form = await event.request.formData();
    // カタログを読み直して optionId / requiresServiceDate を確定（フォーム値を信用しない）
    const catalog = await sbListOptionItems(r.facilityUuid);
    const items = catalog
      .map((o) => {
        const quantity = Number(form.get(`qty_${o.id}`) ?? 0) || 0;
        if (quantity < 1) return null;
        const serviceDate = o.requiresServiceDate ? String(form.get(`date_${o.id}`) ?? '') : '';
        const note = String(form.get(`note_${o.id}`) ?? '').trim();
        return { optionId: o.id, serviceDate: serviceDate || null, quantity, note: note || undefined };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (items.length === 0) return fail(400, { message: 'アレンジを選んでください。' });
    const roomIndexRaw = Number(form.get('roomIndex'));
    const roomIndex = Number.isInteger(roomIndexRaw) && roomIndexRaw >= 1 ? roomIndexRaw : null;
    try {
      await memberPageAddOptions(
        { partnerId: partner.id, memberUserId: session.member!.userId, code: r.code },
        items.map((i) => ({ ...i, roomIndex }))
      );
    } catch (e) {
      return fail(400, { message: optionErrorMessage(e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e)) });
    }
    deferTask(event, logPartnerAccess(db, { partnerId: partner.id, ...portalLogActor(session, { code: r.code, items: items.length }), channel: 'web', action: 'booking_options', ip: requestMeta(event).ip }));
    throw redirect(303, memberPageHrefOf(event.params.token, r.code));
  }
};
