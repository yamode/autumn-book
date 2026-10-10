// 取引先ページ: 団体予約の照会の詳細（条件・自動計算額・宿の回答・やりとり）と、承諾・辞退・取り下げ（form action）。
// docs/partner-group-booking.md §6・§7.6・§8.1。承諾で既存の予約（PB-…）ができ、以後は予約一覧側で扱う。
// 確認モード（管理画面の「確認ページを開く」）は requirePortalSession が POST を 403 にする。
import { error, fail } from '@sveltejs/kit';
import {
  canAccept,
  canReject,
  canWithdrawBy,
  GROUP_ANSWER_LABELS,
  GROUP_EVENT_LABELS,
  GROUP_QUOTE_STATUS_TEXT,
  GROUP_STATUS_LABELS_PARTNER,
  groupInquiryAvailable
} from '$lib/partner-group';
import { partnerNightLines } from '$lib/partner-booking';
import { acceptGroupInquiry, getPartnerGroupInquiry, listGroupInquiryEvents, rejectGroupInquiry, withdrawGroupInquiry } from '$lib/server/partners/group-inquiries';
import { partnerBookingAttachmentsEnabled } from '$lib/server/partners/booking-attachments';
import { PartnerStoreError } from '$lib/server/partners/store';
import { portalHeader, PORTAL_HEADERS, requestMeta, requirePortalSession } from '$lib/server/partners/portal';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  if (!groupInquiryAvailable(partner)) throw error(404, 'ページが見つかりません。');
  const inquiry = await getPartnerGroupInquiry(db, partner, event.params.id).catch(() => null);
  if (!inquiry) throw error(404, '照会が見つかりません。');
  const events = await listGroupInquiryEvents(db, inquiry.id, 'partner').catch(() => []);
  const viewer = { id: session.id, is_master: session.is_master === true };
  // 料金の明細（1泊1行・「1名あたり × 人数」）。回答額があればそれ、無ければ自動計算額
  const priced = inquiry.answer_rooms ?? inquiry.quote_rooms;
  return {
    portal: portalHeader(partner, session),
    inquiry,
    nightLines: priced ? partnerNightLines(priced) : [],
    events,
    labels: { status: GROUP_STATUS_LABELS_PARTNER, answer: GROUP_ANSWER_LABELS, event: GROUP_EVENT_LABELS, quote: GROUP_QUOTE_STATUS_TEXT },
    actions: {
      accept: !session.preview && canAccept(inquiry),
      reject: !session.preview && canReject(inquiry),
      withdraw: !session.preview && canWithdrawBy(inquiry, viewer)
    },
    // 承諾後の案内「名簿は予約一覧の添付ファイルからお送りください」（添付機能がオンのときだけ・§7.7）
    attachmentsEnabled: partnerBookingAttachmentsEnabled()
  };
};

const failOf = (e: unknown) => {
  if (e instanceof PartnerStoreError) return fail(e.status >= 400 && e.status < 600 ? e.status : 400, { message: e.message, code: e.code });
  throw e;
};

export const actions = {
  // 承諾 → 予約確定。返り値 { accepted: true, bookingCode, bookingId }
  accept: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    if (!groupInquiryAvailable(partner)) return fail(404, { message: 'ページが見つかりません。', code: 'not_found' });
    const fd = await event.request.formData().catch(() => null);
    try {
      const r = await acceptGroupInquiry(db, partner, { id: session.id, login_id: session.login_id }, event.params.id, {
        ip: requestMeta(event).ip,
        origin: event.url.origin,
        // 画面で見ていた照会の updated_at（宿が回答を直していたら 409）
        expectedUpdatedAt: String(fd?.get('updatedAt') ?? '').trim() || null
      });
      return { accepted: true as const, bookingCode: r.bookingCode, bookingId: r.bookingId };
    } catch (e) {
      return failOf(e);
    }
  },
  // 辞退（fields: reason 任意）。返り値 { rejected: true }
  reject: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    if (!groupInquiryAvailable(partner)) return fail(404, { message: 'ページが見つかりません。', code: 'not_found' });
    const fd = await event.request.formData();
    try {
      await rejectGroupInquiry(db, partner, { id: session.id, login_id: session.login_id }, event.params.id, {
        ip: requestMeta(event).ip,
        origin: event.url.origin,
        reason: String(fd.get('reason') ?? '')
      });
      return { rejected: true as const };
    } catch (e) {
      return failOf(e);
    }
  },
  // 取り下げ（fields: reason 任意・送った本人かマスタだけ）。返り値 { withdrawn: true }
  withdraw: async (event) => {
    const { db, partner, session } = await requirePortalSession(event);
    if (!groupInquiryAvailable(partner)) return fail(404, { message: 'ページが見つかりません。', code: 'not_found' });
    const fd = await event.request.formData();
    try {
      await withdrawGroupInquiry(db, partner, { id: session.id, login_id: session.login_id, is_master: session.is_master === true }, event.params.id, {
        ip: requestMeta(event).ip,
        origin: event.url.origin,
        reason: String(fd.get('reason') ?? '')
      });
      return { withdrawn: true as const };
    } catch (e) {
      return failOf(e);
    }
  }
};
