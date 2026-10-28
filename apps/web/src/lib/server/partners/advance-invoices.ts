// 取引先予約の「前受金のご請求書」の発行・取消・メール送信・ダウンロード（docs/partner-prepayment.md §4 §5・フェーズ3）。
//
//   - 銀行振込の事前支払（deposit_bank / advance_bank）の予約ごとに1枚（rms_partner_advance_invoices・autumn-shared 20261028105454）。
//     有効（status='issued'）な請求書は1予約に1枚（部分一意索引）。台帳 rms_partner_bookings.advance_invoice_id が今の1枚を指す。
//   - 予約確定（createPartnerBooking）で自動発行し、予約者へメールする。管理画面の予約詳細から取消・再発行できる。
//   - 紙面は $lib/partner-advance-invoice（純関数）。全内容を document に固定し、PDF は毎回 document から作り直す（保存しない）。
//   - 発行元・振込先・宛名は月次の請求書と同じ（loadInvoiceIssuer・invoiceRecipientName → 紐づけ先の正式名称 → 取引先名）。
//   - 月次の請求書（./invoices.ts・rms_partner_invoices）には触らない。
//
// すべて service_role クライアントで動く。呼び出し側（予約確定・取引先ページ・管理画面）が権限を確認済みの前提で、
// ここでは必ず partner_id / booking_id で絞って読み書きする（別の取引先の請求書を ID だけで触らせない）。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  advanceInvoiceFileName,
  advanceInvoiceMailBody,
  advanceInvoiceMailSubject,
  advanceInvoiceProblem,
  buildAdvanceInvoiceDocument,
  renderAdvanceInvoiceHtml,
  type AdvanceInvoiceBookingSource,
  type AdvanceInvoiceDocument
} from '$lib/partner-advance-invoice';
import { sendFailureMessage, type InvoiceIssuer } from '$lib/partner-invoice';
import { normalizePartnerBookingSettings, type PartnerBooker } from '$lib/partner-booking';
import { fitsAttachmentLimit, type MailAttachment } from '$lib/server/mail-attachments';
import { partnerMailSender, sendPartnerMail } from './mail';
import { renderHtmlPdf, type RenderInvoicePdfOptions } from './invoice-pdf';
import {
  contentDisposition,
  HTML_CSP,
  invoiceRecipients,
  linkedRecipientNames,
  loadInvoiceIssuer,
  partnerInvoicesUrl,
  type InvoicePartner
} from './invoices';
import { isMissingTableError, PartnerStoreError, todayJst } from './store';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type AdvanceInvoiceRow = {
  id: string;
  tenant_id: string;
  facility_id: string;
  partner_id: string | null;
  partner_name: string;
  booking_id: string;
  invoice_no: string;
  issue_date: string;
  due_date: string;
  amount: number;
  status: 'issued' | 'void';
  document: AdvanceInvoiceDocument;
  issued_by: 'auto' | 'staff';
  issued_by_staff: string | null;
  sent_at: string | null;
  sent_to: string[];
  send_error: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
};

/** 発行に要る台帳の予約（PartnerBookingRow の一部。booking.ts の行をそのまま渡せる） */
export type AdvanceInvoiceBooking = AdvanceInvoiceBookingSource & {
  tenant_id?: string;
  facility_id: string;
  partner_id: string | null;
  advance_invoice_id?: string | null;
  detail: (AdvanceInvoiceBookingSource['detail'] & { booker?: (Partial<PartnerBooker> & { name?: string }) | null }) | null;
};

const ADVANCE_COLUMNS =
  'id, tenant_id, facility_id, partner_id, partner_name, booking_id, invoice_no, issue_date, due_date, amount, status, document, issued_by, issued_by_staff, sent_at, sent_to, send_error, voided_at, voided_by, void_reason, created_at, updated_at';

const UUID_RE = /^[0-9a-f-]{36}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOG = '[partner-advance-invoice]';

function raise(error: { code?: string; message?: string } | null, fallback: string): never {
  if (isMissingTableError(error)) {
    throw new PartnerStoreError('前受金のご請求書の DB（autumn-shared migration 20261028105454）が未適用です。', 503, 'migration_missing');
  }
  throw new PartnerStoreError(`${fallback}${error?.message ? `（${error.message}）` : ''}`, 500, 'db_error');
}

// ---------------------------------------------------------------------------
// 一覧・取得
// ---------------------------------------------------------------------------

/** 取引先の前受金のご請求書（新しい順・取消済みを含む）。表が無い環境（migration 未適用）は空。 */
export async function listAdvanceInvoices(db: SupabaseClient, partnerId: string): Promise<AdvanceInvoiceRow[]> {
  if (!UUID_RE.test(partnerId)) return [];
  const { data, error } = await db
    .from('rms_partner_advance_invoices')
    .select(ADVANCE_COLUMNS)
    .eq('partner_id', partnerId)
    .order('issue_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) {
    // 月次の請求書の画面を前受金の表の有無で落とさない
    if (isMissingTableError(error)) return [];
    raise(error, '前受金のご請求書を読み込めませんでした。');
  }
  return (data ?? []) as AdvanceInvoiceRow[];
}

/** 取引先の前受金のご請求書を1枚（その取引先のものでなければ null）。 */
export async function getAdvanceInvoice(db: SupabaseClient, partnerId: string, invoiceId: string): Promise<AdvanceInvoiceRow | null> {
  if (!UUID_RE.test(partnerId) || !UUID_RE.test(invoiceId)) return null;
  const { data, error } = await db
    .from('rms_partner_advance_invoices')
    .select(ADVANCE_COLUMNS)
    .eq('id', invoiceId)
    .eq('partner_id', partnerId)
    .maybeSingle();
  if (error) raise(error, '前受金のご請求書を読み込めませんでした。');
  return (data as AdvanceInvoiceRow | null) ?? null;
}

/** 予約の有効な前受金のご請求書（無ければ null）。 */
export async function findIssuedAdvanceInvoice(db: SupabaseClient, bookingId: string): Promise<AdvanceInvoiceRow | null> {
  if (!UUID_RE.test(bookingId)) return null;
  const { data, error } = await db
    .from('rms_partner_advance_invoices')
    .select(ADVANCE_COLUMNS)
    .eq('booking_id', bookingId)
    .eq('status', 'issued')
    .maybeSingle();
  if (error) raise(error, '前受金のご請求書を読み込めませんでした。');
  return (data as AdvanceInvoiceRow | null) ?? null;
}

/** 予約の前受金のご請求書（新しい順・取消済みを含む）。管理画面の予約詳細用。 */
export async function listAdvanceInvoicesForBooking(db: SupabaseClient, partnerId: string, bookingId: string): Promise<AdvanceInvoiceRow[]> {
  if (!UUID_RE.test(partnerId) || !UUID_RE.test(bookingId)) return [];
  const { data, error } = await db
    .from('rms_partner_advance_invoices')
    .select(ADVANCE_COLUMNS)
    .eq('partner_id', partnerId)
    .eq('booking_id', bookingId)
    .order('created_at', { ascending: false });
  if (error) {
    if (isMissingTableError(error)) return [];
    raise(error, '前受金のご請求書を読み込めませんでした。');
  }
  return (data ?? []) as AdvanceInvoiceRow[];
}

// ---------------------------------------------------------------------------
// ダウンロード
// ---------------------------------------------------------------------------

/**
 * 前受金のご請求書のダウンロード応答。pdf が作れなければ HTML（ブラウザで開いて印刷できる）に切り替える。
 * 切り替えたかどうかは x-invoice-format（pdf / html）で分かる（月次の invoiceDownloadResponse と同じ）。
 */
export async function advanceInvoiceDownloadResponse(
  row: AdvanceInvoiceRow,
  format: 'pdf' | 'html',
  headers?: Record<string, string>
): Promise<Response> {
  const doc = row.document;
  const html = renderAdvanceInvoiceHtml(doc);
  const common = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-store', ...(headers ?? {}) };
  if (format === 'pdf') {
    const pdf = await renderHtmlPdf(html, doc.invoiceNo);
    if (pdf) {
      return new Response(new Uint8Array(pdf), {
        headers: {
          ...common,
          'content-type': 'application/pdf',
          'content-length': String(pdf.byteLength),
          'content-disposition': contentDisposition('attachment', advanceInvoiceFileName(doc, 'pdf')),
          'x-invoice-format': 'pdf'
        }
      });
    }
  }
  return new Response(html, {
    headers: {
      ...common,
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': contentDisposition('inline', advanceInvoiceFileName(doc, 'html')),
      'content-security-policy': HTML_CSP,
      'x-invoice-format': 'html'
    }
  });
}

// ---------------------------------------------------------------------------
// 発行
// ---------------------------------------------------------------------------

export type IssueAdvanceInvoiceResult = {
  invoice: AdvanceInvoiceRow;
  /** false = 有効な請求書が既にあったのでそれを返した（二重発行しない・送信もしない） */
  created: boolean;
  /** send:true で送ったときの結果 */
  mail: SendAdvanceInvoiceMailResult | null;
};

// 紙面の発行者欄（月次の issuerOf と同じ項目。施設名は予約の内容の欄に出す）
const issuerOf = (s: Awaited<ReturnType<typeof loadInvoiceIssuer>>): InvoiceIssuer => ({
  name: s.issuerName,
  facilityName: '',
  address: s.issuerAddress,
  tel: s.issuerTel,
  registrationNumber: s.registrationNumber,
  bankAccount: s.bankAccount,
  note: s.note
});

// 予約の施設名（core.facilities.name）。読めなければメールの差出人名（施設名）で代える
async function facilityNameOf(db: SupabaseClient, facilityId: string): Promise<string> {
  const { data } = await db.schema('core').from('facilities').select('name').eq('id', facilityId).maybeSingle();
  const name = String((data as { name?: string | null } | null)?.name ?? '').trim();
  return name || (await partnerMailSender(db, facilityId)).fromName;
}

/**
 * 予約の前受金のご請求書を発行する。発行できない予約（advanceInvoiceProblem）は 409。
 * 有効な請求書が既にあればそれを返す（created:false・冪等）。同時に発行された（一意制約 23505）ときは先に入った1枚を返す。
 * 発行したら台帳の advance_invoice_id を新しい請求書に向ける。send:true なら予約者へメールする（失敗しても発行は成り立つ）。
 */
export async function issueAdvanceInvoice(
  db: SupabaseClient,
  partner: InvoicePartner,
  booking: AdvanceInvoiceBooking,
  opts: { by: 'auto' | 'staff'; staffId?: string | null; send: boolean; origin: string; pdf?: RenderInvoicePdfOptions }
): Promise<IssueAdvanceInvoiceResult> {
  if (booking.partner_id !== partner.id) throw new PartnerStoreError('予約が見つかりません。', 404, 'not_found');
  const problem = advanceInvoiceProblem(booking);
  if (problem) throw new PartnerStoreError(problem, 409, 'not_advance');

  const existing = await findIssuedAdvanceInvoice(db, booking.id);
  if (existing) return { invoice: existing, created: false, mail: null };

  const [settings, facilityName, linked] = await Promise.all([
    loadInvoiceIssuer(db, partner.tenant_id),
    facilityNameOf(db, booking.facility_id),
    linkedRecipientNames(db, [partner])
  ]);
  const s = normalizePartnerBookingSettings(partner.booking_settings);
  // 宛名は月次と同じ: 正式社名 → 紐づけ先（PMS の顧客）の正式名称（法人格つき）→ 取引先名
  const recipientName = s.invoiceRecipientName || linked.get(partner.id) || partner.name;

  const { data: no, error: noError } = await db.rpc('rms_partner_next_advance_invoice_no');
  if (noError || typeof no !== 'string') raise(noError, '前受金のご請求書の番号を採番できませんでした。');

  const doc = buildAdvanceInvoiceDocument({
    booking,
    issuer: issuerOf(settings),
    recipientName,
    facilityName,
    invoiceNo: no,
    issueDate: todayJst()
  });
  const { data, error } = await db
    .from('rms_partner_advance_invoices')
    .insert({
      tenant_id: partner.tenant_id,
      facility_id: booking.facility_id,
      partner_id: partner.id,
      partner_name: partner.name,
      booking_id: booking.id,
      invoice_no: doc.invoiceNo,
      issue_date: doc.issueDate,
      due_date: doc.dueDate,
      amount: doc.amounts.advance,
      status: 'issued',
      document: doc,
      issued_by: opts.by,
      issued_by_staff: opts.by === 'staff' ? (opts.staffId ?? null) : null
    })
    .select(ADVANCE_COLUMNS)
    .single();
  if (error) {
    // 同時に発行された（予約確定と再発行が重なった等）→ 先に入った1枚を返す
    if (error.code === '23505') {
      const won = await findIssuedAdvanceInvoice(db, booking.id);
      if (won) return { invoice: won, created: false, mail: null };
    }
    raise(error, '前受金のご請求書を発行できませんでした。');
  }
  let invoice = data as AdvanceInvoiceRow;

  // 台帳から今の1枚を指す（取り消して作り直したときは新しい方）。失敗しても請求書は有効（予約詳細は booking_id で引ける）
  const { error: linkError } = await db
    .from('rms_partner_bookings')
    .update({ advance_invoice_id: invoice.id })
    .eq('id', booking.id)
    .eq('partner_id', partner.id);
  if (linkError) console.error(`${LOG} 台帳に請求書を結べませんでした（${booking.booking_code}）:`, linkError.message);

  let mail: SendAdvanceInvoiceMailResult | null = null;
  if (opts.send) {
    mail = await sendAdvanceInvoiceMail(db, partner, invoice, booking, opts.origin, { pdf: opts.pdf });
    invoice = mail.invoice;
  }
  return { invoice, created: true, mail };
}

// ---------------------------------------------------------------------------
// 取消
// ---------------------------------------------------------------------------

/**
 * 前受金のご請求書を取り消す（理由必須）。番号は欠番になる。取り消すと同じ予約に新しく発行できる。
 * 台帳の advance_invoice_id はそのまま（履歴として取り消した1枚を指す）。再発行すると新しい請求書を指す。
 * opts.partnerId を渡すとその取引先の請求書だけを取り消す（呼び出し側の確認と二重に絞る）。
 */
export async function voidAdvanceInvoice(
  db: SupabaseClient,
  invoiceId: string,
  opts: { reason: string; staffId?: string | null; partnerId?: string }
): Promise<AdvanceInvoiceRow> {
  const why = opts.reason.trim().slice(0, 300);
  if (!why) throw new PartnerStoreError('取消の理由を入力してください。');
  if (!UUID_RE.test(invoiceId)) throw new PartnerStoreError('前受金のご請求書が見つかりません。', 404, 'not_found');
  let q = db
    .from('rms_partner_advance_invoices')
    .update({ status: 'void', voided_at: new Date().toISOString(), voided_by: opts.staffId ?? null, void_reason: why })
    .eq('id', invoiceId)
    .eq('status', 'issued');
  if (opts.partnerId) q = q.eq('partner_id', opts.partnerId);
  const { data, error } = await q.select(ADVANCE_COLUMNS).maybeSingle();
  if (error) raise(error, '前受金のご請求書を取り消せませんでした。');
  if (!data) throw new PartnerStoreError('この前受金のご請求書は見つからないか、取消済みです。', 409, 'void');
  return data as AdvanceInvoiceRow;
}

// ---------------------------------------------------------------------------
// メール送信
// ---------------------------------------------------------------------------

export type SendAdvanceInvoiceMailResult = {
  sent: boolean;
  to: string[];
  attachedPdf: boolean;
  reason: string | null;
  invoice: AdvanceInvoiceRow;
};

/**
 * 送信先: 予約者（detail.booker.email）。無ければ月次の請求書と同じ宛先（取引先の連絡先メール＋マスタユーザー）。
 * ご宿泊者のメール（guest_email）には送らない。
 */
async function advanceInvoiceRecipients(db: SupabaseClient, partner: InvoicePartner, booking: AdvanceInvoiceBooking): Promise<string[]> {
  const booker = String(booking.detail?.booker?.email ?? '').trim();
  if (EMAIL_RE.test(booker)) return [booker];
  return invoiceRecipients(db, partner);
}

/**
 * 前受金のご請求書を予約者へメールで送る（PDF を添付。作れない・大きすぎるときは添付なしでページへ案内）。
 * 結果は sent_at / sent_to / send_error に記録する。失敗は例外にせず結果で返す（予約を失敗させない）。
 * 差出人・返信先は予約の施設（sendPartnerMail）。
 */
export async function sendAdvanceInvoiceMail(
  db: SupabaseClient,
  partner: InvoicePartner,
  row: AdvanceInvoiceRow,
  booking: AdvanceInvoiceBooking,
  origin: string,
  opts: { pdf?: RenderInvoicePdfOptions } = {}
): Promise<SendAdvanceInvoiceMailResult> {
  if (row.partner_id !== partner.id || row.booking_id !== booking.id) throw new PartnerStoreError('前受金のご請求書が見つかりません。', 404, 'not_found');
  if (row.status !== 'issued') throw new PartnerStoreError('取り消した前受金のご請求書は送信できません。', 409, 'void');

  const doc = row.document;
  let to: string[] = [];
  let sent = false;
  let reason: string | null = null;
  let attachedPdf = false;
  try {
    to = await advanceInvoiceRecipients(db, partner, booking);
    if (!to.length) {
      reason = '送信先がありません（予約者・取引先の連絡先メール・マスタユーザーのメールが未登録）';
    } else {
      const pdf = await renderHtmlPdf(renderAdvanceInvoiceHtml(doc), doc.invoiceNo, opts.pdf);
      const attachments: MailAttachment[] = pdf ? [{ filename: advanceInvoiceFileName(doc, 'pdf'), type: 'application/pdf', content: pdf }] : [];
      attachedPdf = attachments.length > 0 && fitsAttachmentLimit(attachments);
      const body = advanceInvoiceMailBody(doc, partnerInvoicesUrl(origin, partner.url_token), attachedPdf);
      const result = await sendPartnerMail(db, row.facility_id, {
        to,
        subject: advanceInvoiceMailSubject(doc),
        html: body.html,
        text: body.text,
        attachments: attachedPdf ? attachments : undefined
      });
      sent = result.sent;
      reason = result.sent ? null : (result.reason ?? '送信できませんでした');
    }
  } catch (e) {
    reason = e instanceof Error ? e.message : String(e);
  }

  const patch = sent
    ? { sent_at: new Date().toISOString(), sent_to: to, send_error: null }
    : { send_error: sendFailureMessage(row.send_error, reason ?? '送信できませんでした') };
  const { data, error } = await db
    .from('rms_partner_advance_invoices')
    .update(patch)
    .eq('id', row.id)
    .eq('partner_id', partner.id)
    .select(ADVANCE_COLUMNS)
    .single();
  if (error) console.error(`${LOG} 送信結果を記録できませんでした:`, error.message);
  if (!sent) console.error(`${LOG} ${row.invoice_no} 送信できませんでした: ${reason}`);
  return { sent, to, attachedPdf, reason, invoice: data ? (data as AdvanceInvoiceRow) : { ...row, ...patch } };
}
