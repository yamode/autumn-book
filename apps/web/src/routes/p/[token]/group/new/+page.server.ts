// 取引先ページ: 団体予約の照会の入力（束に積んで一括送信・docs/partner-group-booking.md §8.1）。
// 送信は POST ../submit（JSON）。自動計算額は既存の POST ../../book/quote（JSON）をそのまま使う（団体用の見積 API は作らない・§7.1）。
// フォームの施設は選んでいる施設（hidden facility_id）。施設を変えるときはヘッダーの切替から（部屋・プランが施設ごとのため）。
import { error } from '@sveltejs/kit';
import {
  describeGroupDeadline,
  GROUP_CHOICE_OTHER,
  groupInquiryAvailable,
  groupInquiryBlockReason,
  groupPaymentChoices,
  groupSettingsOf,
  MAX_GROUP_NAME_LENGTH,
  MAX_GROUP_NOTE_LENGTH
} from '$lib/partner-group';
import { normalizeBooker } from '$lib/partner-booking';
import { groupFormCatalog, latestGroupBatch } from '$lib/server/partners/group-inquiries';
import { getBookerProfile, todayJst } from '$lib/server/partners/store';
import { partnerPublicBounds } from '$lib/server/partners/rates';
import { portalHeader, PORTAL_HEADERS, requirePortalSession } from '$lib/server/partners/portal';

export const load = async (event) => {
  event.setHeaders(PORTAL_HEADERS);
  const { db, partner, session } = await requirePortalSession(event);
  if (!groupInquiryAvailable(partner)) throw error(404, 'ページが見つかりません。');
  const s = partner.booking_settings;
  const blockReason = groupInquiryBlockReason(partner);
  const [catalog, booker, latest] = await Promise.all([
    blockReason ? Promise.resolve([]) : groupFormCatalog(event, db, partner).catch(() => []),
    session.preview ? Promise.resolve(null) : getBookerProfile(db, partner.id, session.id).catch(() => null),
    // 「前回の内容を使う」の元（直近の送信の1件目・団体名は空）。無ければ null
    session.preview ? Promise.resolve(null) : latestGroupBatch(db, partner.id, session.id).catch(() => null)
  ]);
  const bounds = partnerPublicBounds(partner);
  return {
    portal: portalHeader(partner, session),
    // 選んでいる施設（照会の facilityId）
    facility: { id: partner.facility_id, name: partner.facility_name, slug: partner.facility_slug },
    blockReason,
    today: todayJst(),
    // チェックイン日に選べる範囲（公開範囲。締切は deadlineText と settings.groupLeadDays で画面でも案内）
    bounds: { earliest: bounds.earliest, latest: bounds.latest },
    deadlineText: describeGroupDeadline(s),
    settings: groupSettingsOf(s),
    paymentChoices: groupPaymentChoices(s),
    choiceOther: GROUP_CHOICE_OTHER,
    limits: { groupName: MAX_GROUP_NAME_LENGTH, note: MAX_GROUP_NOTE_LENGTH },
    // 部屋タイプ（定員つき）とその部屋で選べるプラン（planName は PMS の元の名前・displayName が取引先向け）
    catalog,
    // 空室の目安を見せる施設か（個人予約と同じ条件）
    showInventory: partner.show_inventory,
    booker: booker ?? normalizeBooker(null),
    latest,
    // localStorage の下書きのキー（§8.1）
    draftKey: `ab:group-draft:${event.params.token}`
  };
};
