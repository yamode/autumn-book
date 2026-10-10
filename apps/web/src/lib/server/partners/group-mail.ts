// 団体予約（照会 → 宿が回答 → 承諾で予約・docs/partner-group-booking.md §7.8）のメール本文の組み立てと送信。
//
//   束の受付（宿へ・束で1通）／回答（取引先へ・同時に回答した件は1通・N9）／承諾の失敗（宿へ）／辞退・取り下げ（宿へ・N8）。
//   期限切れは送らない（N8）。承諾の成功は既存の予約確認メール（booking.ts の sendBookingMails）が送る。
// 宛先は個人予約と同じ: 宿 = 施設の notifyEmails、取引先 = 予約者 → ログインIDのメール → 取引先の連絡先（宿泊者へは送らない）。
// 差出人は照会の施設（sendPartnerMail / sendFacilityNotice）。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  describeGroupStay,
  describeRoomAdults,
  GROUP_ANSWER_LABELS,
  GROUP_QUOTE_STATUS_TEXT,
  shortDateJa,
  type GroupInquiryExtras
} from '$lib/partner-group';
import { partnerMailRecipients } from './booking-extras';
import { partnerMailSender, sendFacilityNotice, sendPartnerMail } from './mail';
import type { PartnerContext } from './store';
import type { GroupInquiryRow } from './group-inquiries';

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pre = (lines: string[]) => `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(lines.join('\n'))}</pre>`;
const jst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/** 取引先ページの団体予約の一覧の URL（?f=<施設 slug> で照会の施設を選ぶ） */
export const partnerGroupUrl = (origin: string, partner: Pick<PartnerContext, 'url_token' | 'facility_slug'>, id?: string) =>
  `${origin}/p/${partner.url_token}/group${id ? `/${id}` : ''}${partner.facility_slug ? `?f=${encodeURIComponent(partner.facility_slug)}` : ''}`;

/** 管理画面の照会の詳細の URL */
export const adminGroupUrl = (origin: string, id?: string) => `${origin}/admin/group-inquiries${id ? `/${id}` : ''}`;

const extrasOf = (r: GroupInquiryRow): GroupInquiryExtras => {
  const x = (r.extras ?? {}) as Partial<GroupInquiryExtras>;
  return {
    transport: { choice: '', other: '', value: '', ...(x.transport ?? {}) },
    dinnerTime: { choice: '', other: '', value: '', ...(x.dinnerTime ?? {}) },
    note: String(x.note ?? '')
  };
};

/** 照会1件の本文の行（宿・取引先共通。audience=facility は PMS のプラン名を添え、受付枠・残室の目安を出す） */
export function groupInquirySummaryLines(r: GroupInquiryRow, audience: 'partner' | 'facility'): string[] {
  const x = extrasOf(r);
  const plan = r.plan_display_name || r.plan_name;
  const planLine = audience === 'facility' && r.plan_display_name && r.plan_display_name !== r.plan_name ? `${r.plan_name}（取引先向けの名前: ${r.plan_display_name}）` : plan;
  const rooms = (r.rooms ?? []) as { adults: number }[];
  const lines = [
    `照会番号: ${r.inquiry_code}`,
    `団体名: ${r.group_name}`,
    `日程: ${describeGroupStay(r.check_in_date, r.nights)}（${r.check_out_date} チェックアウト）`,
    `お部屋: ${r.room_name} × ${r.room_count}室`,
    `プラン: ${planLine}`,
    `人数: 大人${r.adult_total}名（${describeRoomAdults(rooms)}）`,
    ...(x.dinnerTime.value ? [`夕食開始時間: ${x.dinnerTime.value}`] : []),
    ...(x.transport.value ? [`交通機関: ${x.transport.value}`] : []),
    `お支払: ${r.payment_label}`,
    ...(x.note ? [`備考: ${x.note}`] : [])
  ];
  if (r.answer && r.answer !== 'declined' && r.answer_total != null) {
    lines.push(`料金（宿からの回答）: 宿泊料金 ${yen(r.answer_total)}（税込）${(r.answer_bath_tax ?? 0) > 0 ? `・入湯税 ${yen(r.answer_bath_tax ?? 0)}` : ''}`);
  } else if (r.quote_status === 'ok' && r.quote_total != null) {
    lines.push(`自動計算額: 宿泊料金 ${yen(r.quote_total)}（税込）${(r.quote_bath_tax ?? 0) > 0 ? `・入湯税 ${yen(r.quote_bath_tax ?? 0)}` : ''}`);
  } else {
    lines.push(`料金: ${GROUP_QUOTE_STATUS_TEXT[r.quote_status] || '宿からの回答でご案内します'}`);
  }
  if (audience === 'facility') {
    if (r.quote_remaining != null) lines.push(`残室の目安（照会時点）: 残り ${r.quote_remaining} 室`);
    const over = (r.quote_credit as { over?: boolean } | null)?.over;
    if (over) lines.push('受付枠（与信）: この照会で受付枠を超えます');
  }
  return lines;
}

// ---------------------------------------------------------------------------
// 束の受付（宿へ・束で1通）
// ---------------------------------------------------------------------------

export async function sendGroupSubmittedMail(db: SupabaseClient, ctx: PartnerContext, rows: GroupInquiryRow[], origin: string): Promise<boolean> {
  const to = ctx.booking_settings.notifyEmails;
  if (!to.length || !rows.length) return false;
  const names = [...new Set(rows.map((r) => r.group_name))].join('・');
  const dates = [...new Set(rows.map((r) => shortDateJa(r.check_in_date).replace(/（.）/, '')))].join('・');
  const subject = `【団体照会】${names} ${rows.length}件（${dates}）${ctx.name}`;
  const head = `取引先「${ctx.name}」から団体予約の照会が ${rows.length} 件届きました。管理画面の「団体照会」から回答してください。`;
  const blocks = rows.map((r, i) => [`■ ${i + 1}件目`, ...groupInquirySummaryLines(r, 'facility'), `回答: ${adminGroupUrl(origin, r.id)}`]);
  const text = [head, '', ...blocks.flatMap((b) => [...b, '']), `一覧: ${adminGroupUrl(origin)}`].join('\n');
  const html = `<p>${escapeHtml(head)}</p>${blocks.map(pre).join('')}<p>一覧: <a href="${escapeHtml(adminGroupUrl(origin))}">${escapeHtml(adminGroupUrl(origin))}</a></p>`;
  const r = await sendFacilityNotice(db, ctx.facility_id, { to, subject, html, text }).catch(() => ({ sent: false }));
  return r.sent;
}

// ---------------------------------------------------------------------------
// 回答（取引先へ・同時に回答した件は1通・N9）
// ---------------------------------------------------------------------------

async function partnerRecipientsOf(db: SupabaseClient, ctx: PartnerContext, rows: GroupInquiryRow[]): Promise<string[]> {
  const accountIds = [...new Set(rows.map((r) => r.account_id).filter((id): id is string => !!id))];
  let accountEmails: string[] = [];
  if (accountIds.length) {
    // partner_id でも絞る（service_role で読むため、別の取引先のアカウントのメールを拾わない）
    const { data } = await db.from('rms_partner_accounts').select('email').in('id', accountIds).eq('partner_id', ctx.id);
    accountEmails = ((data ?? []) as { email: string | null }[]).map((a) => a.email ?? '').filter(Boolean);
  }
  const bookers = rows.map((r) => String((r.booker as { email?: string } | null)?.email ?? ''));
  return partnerMailRecipients([...bookers, ...accountEmails, ctx.contact_email]);
}

export async function sendGroupAnswerMail(db: SupabaseClient, ctx: PartnerContext, rows: GroupInquiryRow[], origin: string): Promise<boolean> {
  if (!rows.length || !ctx.booking_settings.notifyPartner) return false;
  const to = await partnerRecipientsOf(db, ctx, rows);
  if (!to.length) return false;
  const facilityName = ctx.facility_name || (await partnerMailSender(db, ctx.facility_id)).fromName;
  const subject = `【${facilityName}】団体予約のお問い合わせへのご回答（${rows.length > 1 ? `${rows[0].inquiry_code} ほか${rows.length - 1}件` : rows[0].inquiry_code}）`;
  const lead = `${facilityName} です。団体予約のお問い合わせにご回答しました。内容をご確認のうえ、団体予約の画面から「承諾」または「辞退」をお選びください（承諾でご予約が確定します）。`;
  const blocks = rows.map((r) => [
    `■ ${GROUP_ANSWER_LABELS[r.answer ?? 'declined']}`,
    ...groupInquirySummaryLines(r, 'partner'),
    ...(r.answer_message ? [`宿からの一言: ${r.answer_message}`] : []),
    ...(r.answer !== 'declined' && r.answer_expires_at ? [`ご回答の期限: ${jst(r.answer_expires_at)} まで`] : [])
  ]);
  const url = partnerGroupUrl(origin, ctx);
  const text = [`${ctx.name} 様`, '', lead, '', ...blocks.flatMap((b) => [...b, '']), `団体予約: ${url}`].join('\n');
  const html = `<p>${escapeHtml(ctx.name)} 様</p><p>${escapeHtml(lead)}</p>${blocks.map(pre).join('')}<p>団体予約: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`;
  const r = await sendPartnerMail(db, ctx.facility_id, { to, subject, html, text }).catch(() => ({ sent: false }));
  return r.sent;
}

// ---------------------------------------------------------------------------
// 承諾の失敗・辞退・取り下げ（宿へ）
// ---------------------------------------------------------------------------

export async function sendGroupAcceptFailedMail(db: SupabaseClient, ctx: PartnerContext, row: GroupInquiryRow, reason: string, origin: string): Promise<boolean> {
  const to = ctx.booking_settings.notifyEmails;
  if (!to.length) return false;
  const head = `取引先「${ctx.name}」が団体照会（${row.inquiry_code}）を承諾しましたが、予約を確定できませんでした（${reason}）。照会は「回答済み」のままです。回答を「受けられない」に変えるか、取引先へご連絡ください。`;
  const lines = [...groupInquirySummaryLines(row, 'facility'), `回答: ${adminGroupUrl(origin, row.id)}`];
  const r = await sendFacilityNotice(db, ctx.facility_id, {
    to,
    subject: `【団体照会】承諾できませんでした ${row.group_name} ${row.check_in_date}（${row.inquiry_code}）`,
    html: `<p>${escapeHtml(head)}</p>${pre(lines)}`,
    text: [head, '', ...lines].join('\n')
  }).catch(() => ({ sent: false }));
  return r.sent;
}

export async function sendGroupClosedMail(
  db: SupabaseClient,
  ctx: PartnerContext,
  row: GroupInquiryRow,
  kind: 'rejected' | 'withdrawn',
  origin: string
): Promise<boolean> {
  const to = ctx.booking_settings.notifyEmails;
  if (!to.length) return false;
  const what = kind === 'rejected' ? '辞退' : '取り下げ';
  const head = `取引先「${ctx.name}」が団体照会（${row.inquiry_code}）を${kind === 'rejected' ? '辞退しました' : '取り下げました'}。`;
  const lines = [...groupInquirySummaryLines(row, 'facility'), `詳細: ${adminGroupUrl(origin, row.id)}`];
  const r = await sendFacilityNotice(db, ctx.facility_id, {
    to,
    subject: `【団体照会・${what}】${row.group_name} ${row.check_in_date}（${row.inquiry_code}）${ctx.name}`,
    html: `<p>${escapeHtml(head)}</p>${pre(lines)}`,
    text: [head, '', ...lines].join('\n')
  }).catch(() => ({ sent: false }));
  return r.sent;
}
