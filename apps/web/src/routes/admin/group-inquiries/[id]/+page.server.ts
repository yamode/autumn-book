// 管理画面: 団体照会の詳細と回答（docs/partner-group-booking.md §8.3・§7.2・§7.3・§7.5）。
// 見られるのは照会の施設にアクセスできるスタッフ（テナントも一致）。回答は admin / staff、料金の変更（1名単価・合計）と
// 「受付枠を超えても受ける」は管理者だけ（N2・answerGroupInquiry が確かめる）。承諾済み・終了した照会は回答できない。
import { error, type RequestEvent } from '@sveltejs/kit';
import {
  canAnswer,
  defaultAnswerExpiry,
  GROUP_ANSWER_LABELS,
  GROUP_EVENT_LABELS,
  GROUP_QUOTE_STATUS_TEXT,
  GROUP_STATUS_LABELS_STAFF,
  unitPricesByAdults
} from '$lib/partner-group';
import { normalizePartnerBookingSettings, partnerNightLines } from '$lib/partner-booking';
import {
  answerGroupInquiry,
  getGroupInquiryRow,
  groupInquiryCredit,
  groupNightlyRemaining,
  listGroupInquiryEvents,
  listStaffGroupInquiries,
  parseGroupAnswerForm
} from '$lib/server/partners/group-inquiries';
import { staffGroupScope } from '$lib/server/partners/group-staff';
import { actionFailure, StaffScopeError } from '$lib/server/partners/staff';
import { PartnerStoreError } from '$lib/server/partners/store';
import type { Actions, PageServerLoad } from './$types';

async function inquiryForStaff(event: RequestEvent) {
  const ctx = await staffGroupScope(event);
  const row = await getGroupInquiryRow(ctx.scope.db, event.params.id ?? '', { tenantId: ctx.scope.tenantId });
  if (!row || !ctx.facilities.some((f) => f.id === row.facility_id)) throw new PartnerStoreError('照会が見つかりません。', 404, 'not_found');
  return { ...ctx, row };
}

export const load: PageServerLoad = async (event) => {
  try {
    const { scope, facilities, staff, row } = await inquiryForStaff(event);
    const db = scope.db;
    const [events, nightly, credit, siblings, partnerRow] = await Promise.all([
      listGroupInquiryEvents(db, row.id, 'staff').catch(() => []),
      groupNightlyRemaining(db, row).catch(() => []),
      groupInquiryCredit(db, row).catch(() => null),
      // 同じ束の照会（束の帯・一括回答の対象の確認）。batch_id で直接取る（施設アクセスの範囲・テナントで絞る）
      listStaffGroupInquiries(db, { tenantId: scope.tenantId, facilityIds: facilities.map((f) => f.id), batchId: row.batch_id, limit: 100 }).then(
        (all) => all.filter((r) => r.id !== row.id),
        () => []
      ),
      row.partner_id ? db.from('rms_partners').select('booking_settings').eq('id', row.partner_id).maybeSingle() : Promise.resolve({ data: null })
    ]);
    const settings = normalizePartnerBookingSettings((partnerRow.data as { booking_settings?: unknown } | null)?.booking_settings);
    const priced = row.answer_rooms ?? row.quote_rooms;
    const { data: booking } = row.booking_id
      ? await db.from('rms_partner_bookings').select('booking_code, status').eq('id', row.booking_id).maybeSingle()
      : { data: null };
    return {
      live: true,
      error: null as string | null,
      inquiry: { ...row, facilityName: facilities.find((f) => f.id === row.facility_id)?.name ?? '', bookingCode: (booking?.booking_code as string | undefined) ?? null, bookingStatus: (booking?.status as string | undefined) ?? null },
      events,
      // 泊ごとの残室（PMS と同じ規則・いまの値）
      nightly,
      // 受付枠（月別・この照会ぶんを足した後。与信の対象外は null）
      credit,
      siblings,
      // 料金の明細（1泊1行）と、回答フォームの初期値
      nightLines: priced ? partnerNightLines(priced) : [],
      form: {
        canAnswer: canAnswer(row),
        isAdmin: staff.isAdmin,
        // 人数の段ごとの1名単価（自動計算 → 回答額の順で上書き）。料金の無い段は出ない
        unitPrices: { ...unitPricesByAdults(row.quote_rooms), ...unitPricesByAdults(row.answer_rooms) },
        adultsSteps: [...new Set(row.rooms.map((r) => r.adults))].sort((a, b) => a - b),
        // 回答の有効期限の既定（YYYY-MM-DD・JST）
        defaultExpiresOn: (row.answer_expires_at ? new Date(row.answer_expires_at) : defaultAnswerExpiry(new Date(), settings.groupAnswerDays, row.check_in_date))
          .toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
        // 回答済みの修正では「今の回答額のまま」（keep）を既定に。新着は自動計算（料金が無ければ管理者が入力）
        defaultPriceMode: row.answer_rooms ? 'keep' : row.quote_status === 'ok' ? 'auto' : 'unit'
      },
      labels: { status: GROUP_STATUS_LABELS_STAFF, answer: GROUP_ANSWER_LABELS, event: GROUP_EVENT_LABELS, quote: GROUP_QUOTE_STATUS_TEXT }
    };
  } catch (e) {
    if (e instanceof PartnerStoreError && e.status === 404) throw error(404, e.message);
    if (e instanceof StaffScopeError || e instanceof PartnerStoreError) {
      const live = !(e instanceof StaffScopeError && (e.code === 'not_live' || e.code === 'service_unconfigured'));
      return { live, error: e.message, inquiry: null, events: [], nightly: [], credit: null, siblings: [], nightLines: [], form: null, labels: null };
    }
    throw e;
  }
};

export const actions: Actions = {
  // 回答（新着・回答済みの修正）。fields（parseGroupAnswerForm）:
  //   answer = ok / conditional / declined、message（条件付きは必須・最大 1000 字）、expiresOn（YYYY-MM-DD・空なら既定）、
  //   priceMode = auto / keep / unit / total（unit・total は管理者のみ）、unit_<人数>（priceMode=unit の1名1泊単価）、
  //   total（priceMode=total の宿泊料金の合計）、creditOverride = on（管理者のみ）
  // 返り値 { answered: true, status, mailed }（mailed: 取引先へメールを実際に送ったか）
  answer: async (event) => {
    try {
      const { scope, staff, row } = await inquiryForStaff(event);
      const input = parseGroupAnswerForm(await event.request.formData());
      const res = await answerGroupInquiry(scope.db, staff, row, input, { origin: event.url.origin });
      return { answered: true as const, status: res.row.status, mailed: res.mailed };
    } catch (e) {
      return actionFailure(e);
    }
  }
};
