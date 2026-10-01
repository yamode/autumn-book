// 取引先予約の月次請求書（利用明細書＋適格請求書）の発行・送信・取消・ダウンロード（2026-10-01 ユーザー指示）。
//
//   - チェックアウト基準・月末締め。金額は予約時の金額（rms_partner_bookings）。計算と紙面は $lib/partner-invoice（純関数）。
//   - 月末日の 15:00〜15:50 JST に pg_cron が /api/cron/partner-invoices を10分おきに呼び、issueMonthEndInvoices が施設ごとに発行・送信する。
//     1回の呼び出しは時間予算（約20秒）内で処理できる分だけ進め、残りは次の呼び出しで続ける（発行済み・送信済みは飛ばす＝冪等）。
//   - 紙面の全内容は rms_partner_invoices.document に固定する。PDF は毎回 document から作り直す（保存しない）。
//     発行後に発行元設定や予約を変えても、発行済みの紙面は変わらない（直すときは取り消して発行し直す）。
//
// すべて service_role クライアント（./admin-client.ts）で動く。呼び出し側（管理画面・取引先ページ・cron）が権限を確認済みの前提で、
// ここでは必ず partner_id / facility_id で絞って読み書きする（別の取引先の請求書を ID だけで触らせない）。
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildInvoiceLines,
  invoiceCutoffDate,
  invoiceFileName,
  invoiceTotals,
  isChargeFailed,
  isInvoiceTarget,
  isLastDayOfMonth,
  MAX_INVOICE_SEND_ATTEMPTS,
  periodLabel,
  periodOf,
  renderInvoiceHtml,
  sendFailureCount,
  sendFailureMessage,
  type InvoiceBookingSource,
  type InvoiceDocument,
  type InvoiceIssuer
} from '$lib/partner-invoice';
import {
  DEFAULT_INVOICE_DUE,
  invoiceDueDate,
  normalizePartnerBookingSettings,
  type PartnerInvoiceDue
} from '$lib/partner-booking';
import { FACILITY_UUID, reverseFacilityUuid } from '$lib/server/supabase-data';
import { fitsAttachmentLimit, type MailAttachment } from '$lib/server/mail-attachments';
import { sendFacilityNotice, sendPartnerMail } from './mail';
import { renderInvoicePdf, type RenderInvoicePdfOptions } from './invoice-pdf';
import { isMissingTableError, PartnerStoreError, todayJst, type PartnerRow } from './store';

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export type PartnerInvoiceRow = {
  id: string;
  tenant_id: string;
  facility_id: string;
  partner_id: string | null;
  partner_name: string;
  period: string; // YYYY-MM-01
  invoice_no: string;
  issue_date: string;
  due_date: string;
  status: 'issued' | 'void';
  booking_ids: string[];
  usage_total: number;
  paid_total: number;
  billed_total: number;
  taxable_10: number;
  tax_10: number;
  non_taxable: number;
  document: InvoiceDocument;
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

/** 請求書の発行・送信に要る取引先の項目（PartnerRow / PartnerContext のどちらでも渡せる）。 */
export type InvoicePartner = Pick<PartnerRow, 'id' | 'tenant_id' | 'facility_id' | 'name' | 'contact_email' | 'url_token' | 'booking_settings'>;

const INVOICE_COLUMNS =
  'id, tenant_id, facility_id, partner_id, partner_name, period, invoice_no, issue_date, due_date, status, booking_ids, usage_total, paid_total, billed_total, taxable_10, tax_10, non_taxable, document, issued_by, issued_by_staff, sent_at, sent_to, send_error, voided_at, voided_by, void_reason, created_at, updated_at';

const BOOKING_SOURCE_COLUMNS =
  'id, booking_code, status, check_in_date, check_out_date, nights, room_name, room_count, adult_total, plan_name, guest_name, booked_by, total_amount, bath_tax_amount, prepay_discount_amount, payment_option, payment_method_name, payment_status, detail';

const PERIOD_RE = /^\d{4}-\d{2}-01$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function raise(error: { code?: string; message?: string } | null, fallback: string): never {
  if (isMissingTableError(error)) {
    throw new PartnerStoreError('請求書の DB（autumn-shared migration 20261001083643）が未適用です。', 503, 'migration_missing');
  }
  throw new PartnerStoreError(`${fallback}${error?.message ? `（${error.message}）` : ''}`, 500, 'db_error');
}

/** 'YYYY-MM' / 'YYYY-MM-DD' を対象月（その月の1日）にする。読めなければ null。 */
export function normalizePeriod(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(s);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const p = `${m[1]}-${m[2]}-01`;
  return PERIOD_RE.test(p) ? p : null;
}

// ---------------------------------------------------------------------------
// 一覧・取得・ダウンロード
// ---------------------------------------------------------------------------

/** 取引先の請求書（新しい順・取消済みを含む）。 */
export async function listPartnerInvoices(db: SupabaseClient, partnerId: string): Promise<PartnerInvoiceRow[]> {
  if (!UUID_RE.test(partnerId)) return [];
  const { data, error } = await db
    .from('rms_partner_invoices')
    .select(INVOICE_COLUMNS)
    .eq('partner_id', partnerId)
    .order('period', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) raise(error, '請求書を読み込めませんでした。');
  return (data ?? []) as PartnerInvoiceRow[];
}

/** 取引先の請求書を1枚（その取引先のものでなければ null）。 */
export async function getPartnerInvoice(db: SupabaseClient, partnerId: string, invoiceId: string): Promise<PartnerInvoiceRow | null> {
  if (!UUID_RE.test(partnerId) || !UUID_RE.test(invoiceId)) return null;
  const { data, error } = await db
    .from('rms_partner_invoices')
    .select(INVOICE_COLUMNS)
    .eq('id', invoiceId)
    .eq('partner_id', partnerId)
    .maybeSingle();
  if (error) raise(error, '請求書を読み込めませんでした。');
  return (data as PartnerInvoiceRow | null) ?? null;
}

// RFC 5987 の値（encodeURIComponent が残す !'()* も %XX にする）
const rfc5987 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const asciiFallback = (s: string) => s.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');

/** content-disposition（日本語ファイル名は filename* で渡す）。 */
export function contentDisposition(kind: 'attachment' | 'inline', fileName: string): string {
  return `${kind}; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${rfc5987(fileName)}`;
}

// HTML（印刷用）を同一オリジンで開くので、スクリプトを一切動かさない CSP を付ける
const HTML_CSP =
  "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; base-uri 'none'; form-action 'none'";

/**
 * 請求書のダウンロード応答。pdf が作れなければ HTML（ブラウザで開いて印刷できる）に切り替える。
 * 切り替えたかどうかは x-invoice-format（pdf / html）で分かる。
 */
export async function invoiceDownloadResponse(
  row: PartnerInvoiceRow,
  format: 'pdf' | 'html',
  headers?: Record<string, string>
): Promise<Response> {
  const doc = row.document;
  const common = {
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-store',
    ...(headers ?? {})
  };
  if (format === 'pdf') {
    const pdf = await renderInvoicePdf(doc);
    if (pdf) {
      return new Response(new Uint8Array(pdf), {
        headers: {
          ...common,
          'content-type': 'application/pdf',
          'content-length': String(pdf.byteLength),
          'content-disposition': contentDisposition('attachment', invoiceFileName(doc, 'pdf')),
          'x-invoice-format': 'pdf'
        }
      });
    }
  }
  const html = renderInvoiceHtml(doc);
  return new Response(html, {
    headers: {
      ...common,
      'content-type': 'text/html; charset=utf-8',
      // 開いてそのまま印刷できるよう inline（保存したいときはブラウザの保存で .html になる）
      'content-disposition': contentDisposition('inline', invoiceFileName(doc, 'html')),
      'content-security-policy': HTML_CSP,
      'x-invoice-format': 'html'
    }
  });
}

// ---------------------------------------------------------------------------
// 発行元の設定（施設ごと）
// ---------------------------------------------------------------------------

export const DEFAULT_ISSUER_NAME = '株式会社山人';
export const DEFAULT_REGISTRATION_NUMBER = 'T3400001006564';
export const DEFAULT_INVOICE_NOTE = '振込手数料は貴社にてご負担ください。';
export const REGISTRATION_NUMBER_RE = /^T\d{13}$/;

const FACILITY_DEFAULTS: Record<'nishiwaga' | 'oga', { address: string; tel: string }> = {
  nishiwaga: { address: '〒029-5514 岩手県和賀郡西和賀町湯川52-71-10', tel: '0197-82-2222' },
  oga: { address: '〒010-0531 秋田県男鹿市船川港台島字鵜ノ崎62-29', tel: '0185-47-7776' }
};

export type PartnerBillingSettings = {
  facilityId: string;
  facilityName: string;
  issuerName: string;
  issuerAddress: string;
  issuerTel: string;
  registrationNumber: string;
  bankAccount: string; // 空 = 未設定（自動発行しない）
  note: string;
  autoIssue: boolean;
  /** 設定が DB に保存済みか（false = 既定値を表示しているだけ） */
  saved: boolean;
  updatedAt: string | null;
};

export type BillingSettingsInput = {
  issuerName: string;
  issuerAddress: string;
  issuerTel: string;
  registrationNumber: string;
  bankAccount: string;
  note: string;
  autoIssue: boolean;
};

// Book の施設 ID（FACILITY_UUID の逆引き）→ 無ければ core.facilities.slug で西和賀／男鹿を見分ける
function facilityKind(facilityId: string, slug: string | null): 'nishiwaga' | 'oga' {
  const book = reverseFacilityUuid(facilityId);
  if (book === 'f-oga') return 'oga';
  if (book === 'f-nishiwaga') return 'nishiwaga';
  return /oga/i.test(slug ?? '') ? 'oga' : 'nishiwaga';
}

export async function loadBillingSettings(db: SupabaseClient, facilityId: string): Promise<PartnerBillingSettings> {
  const [fac, row] = await Promise.all([
    db.schema('core').from('facilities').select('name, slug').eq('id', facilityId).maybeSingle(),
    db
      .from('rms_partner_billing_settings')
      .select('issuer_name, issuer_address, issuer_tel, registration_number, bank_account, note, auto_issue, updated_at')
      .eq('facility_id', facilityId)
      .maybeSingle()
  ]);
  if (row.error) raise(row.error, '請求書の設定を読み込めませんでした。');
  const f = fac.data as { name?: string | null; slug?: string | null } | null;
  const def = FACILITY_DEFAULTS[facilityKind(facilityId, f?.slug ?? null)];
  const r = row.data as {
    issuer_name: string | null;
    issuer_address: string | null;
    issuer_tel: string | null;
    registration_number: string | null;
    bank_account: string | null;
    note: string | null;
    auto_issue: boolean;
    updated_at: string;
  } | null;
  // null = 未設定 → 既定値。空文字は「あえて空にした」とみなしてそのまま（備考・振込先・電話番号）
  return {
    facilityId,
    facilityName: String(f?.name ?? '').trim(),
    issuerName: r?.issuer_name?.trim() || DEFAULT_ISSUER_NAME,
    issuerAddress: r?.issuer_address?.trim() || def.address,
    // 電話番号は空文字＝あえて載せない（null＝未設定だけ既定値）
    issuerTel: r ? (r.issuer_tel ?? def.tel).trim() : def.tel,
    registrationNumber: r?.registration_number?.trim() || DEFAULT_REGISTRATION_NUMBER,
    bankAccount: (r?.bank_account ?? '').trim(),
    note: r ? (r.note ?? DEFAULT_INVOICE_NOTE) : DEFAULT_INVOICE_NOTE,
    autoIssue: r ? r.auto_issue !== false : true,
    saved: !!r,
    updatedAt: r?.updated_at ?? null
  };
}

/** 登録番号の入力を揃える（全角→半角・ハイフンや空白を除く・t→T）。 */
export function normalizeRegistrationNumber(raw: string): string {
  return raw
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s\-‐－ー]/g, '')
    .toUpperCase();
}

/** 管理画面のフォームから設定を読む。 */
export function parseBillingSettingsForm(fd: FormData): BillingSettingsInput {
  const s = (k: string) => String(fd.get(k) ?? '').replace(/\r\n/g, '\n').trim();
  return {
    issuerName: s('issuer_name'),
    issuerAddress: s('issuer_address'),
    issuerTel: s('issuer_tel'),
    registrationNumber: normalizeRegistrationNumber(s('registration_number')),
    bankAccount: s('bank_account'),
    note: s('note'),
    autoIssue: fd.get('auto_issue') !== null
  };
}

export async function saveBillingSettings(
  db: SupabaseClient,
  facilityId: string,
  tenantId: string,
  input: BillingSettingsInput,
  userId: string | null
): Promise<PartnerBillingSettings> {
  if (!input.issuerName) throw new PartnerStoreError('発行者名を入力してください。');
  if (input.issuerName.length > 80) throw new PartnerStoreError('発行者名は80文字以内にしてください。');
  if (!input.issuerAddress) throw new PartnerStoreError('住所を入力してください。');
  if (input.issuerAddress.length > 200) throw new PartnerStoreError('住所は200文字以内にしてください。');
  if (input.issuerTel.length > 30) throw new PartnerStoreError('電話番号は30文字以内にしてください。');
  const regNo = normalizeRegistrationNumber(input.registrationNumber);
  if (!REGISTRATION_NUMBER_RE.test(regNo)) {
    throw new PartnerStoreError('登録番号は「T」＋13桁の数字で入力してください（例: T3400001006564）。');
  }
  if (input.bankAccount.length > 300) throw new PartnerStoreError('振込先は300文字以内にしてください。');
  if (input.note.length > 500) throw new PartnerStoreError('備考は500文字以内にしてください。');
  const { error } = await db.from('rms_partner_billing_settings').upsert(
    {
      facility_id: facilityId,
      tenant_id: tenantId,
      issuer_name: input.issuerName,
      issuer_address: input.issuerAddress,
      registration_number: regNo,
      // 空文字で保存する（null だと既定値に戻ってしまうため）
      issuer_tel: input.issuerTel,
      bank_account: input.bankAccount,
      note: input.note,
      auto_issue: input.autoIssue,
      updated_by: userId
    },
    { onConflict: 'facility_id' }
  );
  if (error) raise(error, '請求書の設定を保存できませんでした。');
  return loadBillingSettings(db, facilityId);
}

const issuerOf = (s: PartnerBillingSettings): InvoiceIssuer => ({
  name: s.issuerName,
  facilityName: s.facilityName,
  address: s.issuerAddress,
  tel: s.issuerTel,
  registrationNumber: s.registrationNumber,
  bankAccount: s.bankAccount,
  note: s.note
});

// ---------------------------------------------------------------------------
// プレビュー・発行
// ---------------------------------------------------------------------------

// 対象予約: 確定済みで、チェックアウトが対象月の1日〜min(月末, 今日 JST)。
// 月の途中で発行しても、まだチェックアウトしていない予約は請求しない。
async function loadTargetBookings(
  db: SupabaseClient,
  partner: InvoicePartner,
  period: string,
  today: string
): Promise<InvoiceBookingSource[]> {
  const { data, error } = await db
    .from('rms_partner_bookings')
    .select(BOOKING_SOURCE_COLUMNS)
    .eq('partner_id', partner.id)
    .eq('facility_id', partner.facility_id)
    .eq('status', 'confirmed')
    .gte('check_out_date', period)
    .lte('check_out_date', invoiceCutoffDate(period, today));
  if (error) raise(error, '予約を読み込めませんでした。');
  return ((data ?? []) as InvoiceBookingSource[]).filter((b) => isInvoiceTarget(b, period, today));
}

// カード決済（チェックイン日）が失敗したままの予約の予約番号（請求はしない。管理画面で警告を出す）
const chargeFailedCodes = (bookings: InvoiceBookingSource[]) => bookings.filter(isChargeFailed).map((b) => b.booking_code);

// お支払期限は取引先ごとの規則（翌月末 / 翌月 N 日）。過去の月をあとから発行すると期限が発行日より前になるので、
// そのときは発行月を基準に同じ規則で計算する（例: 翌月25日 → 発行日の翌月25日）
export function dueDateFor(period: string, issueDate: string, rule: PartnerInvoiceDue = DEFAULT_INVOICE_DUE): string {
  const due = invoiceDueDate(period, rule);
  return due >= issueDate ? due : invoiceDueDate(periodOf(issueDate), rule);
}

function buildDocument(
  partner: InvoicePartner,
  period: string,
  bookings: InvoiceBookingSource[],
  settings: PartnerBillingSettings,
  invoiceNo: string,
  issueDate: string
): InvoiceDocument {
  const booking = normalizePartnerBookingSettings(partner.booking_settings);
  const lines = buildInvoiceLines(bookings, booking);
  return {
    version: 1,
    invoiceNo,
    period,
    issueDate,
    dueDate: dueDateFor(period, issueDate, booking.invoiceDue),
    // 宛名は正式社名（未設定なら取引先名）
    recipient: { name: booking.invoiceRecipientName || partner.name },
    issuer: issuerOf(settings),
    lines,
    totals: invoiceTotals(lines)
  };
}

/** 発行せずに紙面を組み立てる（管理画面のプレビュー用。番号は「未発行」）。 */
export async function previewPartnerInvoice(
  db: SupabaseClient,
  partner: InvoicePartner,
  period: string
): Promise<{ document: InvoiceDocument; bookingCount: number; settings: PartnerBillingSettings; chargeFailed: string[] }> {
  if (!PERIOD_RE.test(period)) throw new PartnerStoreError('対象月が正しくありません。');
  const today = todayJst();
  const [bookings, settings] = await Promise.all([loadTargetBookings(db, partner, period, today), loadBillingSettings(db, partner.facility_id)]);
  return {
    document: buildDocument(partner, period, bookings, settings, '（未発行）', today),
    bookingCount: bookings.length,
    settings,
    chargeFailed: chargeFailedCodes(bookings)
  };
}

async function findIssued(db: SupabaseClient, partnerId: string, period: string): Promise<PartnerInvoiceRow | null> {
  const { data, error } = await db
    .from('rms_partner_invoices')
    .select(INVOICE_COLUMNS)
    .eq('partner_id', partnerId)
    .eq('period', period)
    .eq('status', 'issued')
    .maybeSingle();
  if (error) raise(error, '請求書を読み込めませんでした。');
  return (data as PartnerInvoiceRow | null) ?? null;
}

export type IssueInvoiceResult = {
  invoice: PartnerInvoiceRow;
  /** false = 発行済みのものを返した（二重発行しない） */
  created: boolean;
  /** send:true で送ったときの結果 */
  mail: SendInvoiceMailResult | null;
  /** 載せた予約のうちカード決済が失敗したままのもの（予約番号・請求はしていない）。既存を返したときは空 */
  chargeFailed: string[];
};

/**
 * 取引先×月の請求書を発行する。対象予約（確定済み・チェックアウトがその月かつ今日まで）が0件なら発行しない（null）。
 * 発行済み（有効な1枚）があればそれを返す（created:false・送信もしない）。
 *   today … 「今日」（JST）。cron のテスト用の日付上書きで渡す。省くと todayJst()
 *   pdf   … 送信時の PDF 生成の待ち方（cron は短く）
 */
export async function issuePartnerInvoice(
  db: SupabaseClient,
  partner: InvoicePartner,
  period: string,
  opts: { by: 'auto' | 'staff'; staffId?: string | null; send: boolean; origin: string; today?: string; pdf?: RenderInvoicePdfOptions }
): Promise<IssueInvoiceResult | null> {
  if (!PERIOD_RE.test(period)) throw new PartnerStoreError('対象月が正しくありません。');
  const today = opts.today ?? todayJst();
  if (period > periodOf(today)) throw new PartnerStoreError('これからの月の請求書は発行できません。');

  const existing = await findIssued(db, partner.id, period);
  if (existing) return { invoice: existing, created: false, mail: null, chargeFailed: [] };

  const [bookings, settings] = await Promise.all([loadTargetBookings(db, partner, period, today), loadBillingSettings(db, partner.facility_id)]);
  if (!bookings.length) return null;

  const { data: no, error: noError } = await db.rpc('rms_partner_next_invoice_no', { p_period: period });
  if (noError || typeof no !== 'string') raise(noError, '請求書番号を採番できませんでした。');

  const doc = buildDocument(partner, period, bookings, settings, no, today);
  const t = doc.totals;
  const { data, error } = await db
    .from('rms_partner_invoices')
    .insert({
      tenant_id: partner.tenant_id,
      facility_id: partner.facility_id,
      partner_id: partner.id,
      partner_name: partner.name,
      period,
      invoice_no: doc.invoiceNo,
      issue_date: doc.issueDate,
      due_date: doc.dueDate,
      status: 'issued',
      booking_ids: doc.lines.map((l) => l.bookingId),
      usage_total: t.usageTotal,
      paid_total: t.paidTotal,
      billed_total: t.billedTotal,
      taxable_10: t.taxable10,
      tax_10: t.tax10,
      non_taxable: t.nonTaxable,
      document: doc,
      issued_by: opts.by,
      issued_by_staff: opts.by === 'staff' ? (opts.staffId ?? null) : null
    })
    .select(INVOICE_COLUMNS)
    .single();
  if (error) {
    // 同時に発行された（cron とスタッフが重なった等）→ 先に入った1枚を返す
    if (error.code === '23505') {
      const won = await findIssued(db, partner.id, period);
      if (won) return { invoice: won, created: false, mail: null, chargeFailed: [] };
    }
    raise(error, '請求書を発行できませんでした。');
  }
  let invoice = data as PartnerInvoiceRow;
  let mail: SendInvoiceMailResult | null = null;
  if (opts.send) {
    mail = await sendPartnerInvoiceMail(db, partner, invoice, opts.origin, { pdf: opts.pdf });
    invoice = mail.invoice;
  }
  return { invoice, created: true, mail, chargeFailed: chargeFailedCodes(bookings) };
}

// ---------------------------------------------------------------------------
// メール送信
// ---------------------------------------------------------------------------

export type SendInvoiceMailResult = {
  sent: boolean;
  to: string[];
  attachedPdf: boolean;
  reason: string | null;
  invoice: PartnerInvoiceRow;
};

/** 送信先: 取引先の連絡先メール ＋ マスタユーザー（有効）のメールとご予約者情報のメール。大文字小文字を無視して重複を除く。 */
async function invoiceRecipients(db: SupabaseClient, partner: InvoicePartner): Promise<string[]> {
  const list: string[] = [];
  if (partner.contact_email) list.push(partner.contact_email);
  const { data, error } = await db
    .from('rms_partner_accounts')
    .select('email, booker_profile, is_master, is_active')
    .eq('partner_id', partner.id);
  if (error) raise(error, 'ログインアカウントを読み込めませんでした。');
  for (const a of (data ?? []) as { email: string | null; booker_profile: unknown; is_master: boolean | null; is_active: boolean }[]) {
    if (a.is_master === false || !a.is_active) continue;
    if (a.email) list.push(a.email);
    const bp = a.booker_profile && typeof a.booker_profile === 'object' ? (a.booker_profile as Record<string, unknown>) : null;
    if (typeof bp?.email === 'string') list.push(bp.email);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const e = raw.trim();
    if (!EMAIL_RE.test(e) || seen.has(e.toLowerCase())) continue;
    seen.add(e.toLowerCase());
    out.push(e);
  }
  return out.slice(0, 20);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const ymd = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;

/** 件名（ご請求 0 円ならご利用明細書だけ）。 */
export function invoiceMailSubject(doc: Pick<InvoiceDocument, 'invoiceNo' | 'period' | 'totals' | 'issuer'>): string {
  const what = doc.totals.billedTotal > 0 ? 'ご請求書・ご利用明細書' : 'ご利用明細書';
  const facility = doc.issuer.facilityName || doc.issuer.name;
  return `【${facility}】${periodLabel(doc.period)}ご利用分 ${what}（${doc.invoiceNo}）`;
}

export function invoiceMailBody(doc: InvoiceDocument, pageUrl: string, attached: boolean): { text: string; html: string } {
  const t = doc.totals;
  const billed = t.billedTotal > 0;
  const facility = doc.issuer.facilityName || doc.issuer.name;
  const lines = [
    `${doc.recipient.name} 御中`,
    '',
    `いつも${facility}をご利用いただき、ありがとうございます。`,
    `${periodLabel(doc.period)}ご利用分（チェックアウト日基準）の${billed ? 'ご請求書・ご利用明細書' : 'ご利用明細書'}をお送りします。`,
    '',
    `請求書番号: ${doc.invoiceNo}`,
    `ご利用件数: ${doc.lines.length}件　ご利用総額: ${yen(t.usageTotal)}`,
    ...(billed
      ? [
          `ご請求額: ${yen(t.billedTotal)}（うち消費税 ${yen(t.tax10)}・入湯税 ${yen(t.nonTaxable)}）`,
          `お支払期限: ${ymd(doc.dueDate)}`,
          ...(doc.issuer.bankAccount ? ['お振込先:', ...doc.issuer.bankAccount.split('\n').map((l) => `　${l}`)] : []),
          ...(doc.issuer.note ? ['', doc.issuer.note] : [])
        ]
      : ['今月のご請求はありません（オンライン決済済み・別途精算のご予約のみ）。']),
    '',
    attached ? 'PDF を添付しています。' : '書類は下記のページからダウンロードできます。',
    `取引先ページ「アカウント → ご請求書」: ${pageUrl}`,
    '（ログインが必要です。過去のご請求書もいつでもダウンロードできます）',
    '',
    `${doc.issuer.name}　${facility}`,
    ...(doc.issuer.tel ? [`TEL ${doc.issuer.tel}`] : [])
  ];
  const text = lines.join('\n');
  const html = `<div style="font-family:sans-serif;line-height:1.7">${lines
    .map((l) => (l.includes(pageUrl) ? `取引先ページ「アカウント → ご請求書」: <a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a>` : escapeHtml(l)))
    .join('<br>')}</div>`;
  return { text, html };
}

/** 取引先ページの請求書一覧の URL。 */
export const partnerInvoicesUrl = (origin: string, urlToken: string) => `${origin}/p/${urlToken}/account/invoices`;

/**
 * 請求書を取引先へメールで送る（PDF を添付。作れない・大きすぎるときは添付なしでページへ案内）。
 * 結果は sent_at / sent_to / send_error に記録する。ご宿泊者のメールには送らない。
 * 失敗したときは send_error の先頭に「[送信失敗 N回目]」を付けて回数を数える（cron は MAX_INVOICE_SEND_ATTEMPTS 回で諦める）。
 */
export async function sendPartnerInvoiceMail(
  db: SupabaseClient,
  partner: InvoicePartner,
  row: PartnerInvoiceRow,
  origin: string,
  opts: { pdf?: RenderInvoicePdfOptions } = {}
): Promise<SendInvoiceMailResult> {
  if (row.partner_id !== partner.id || row.facility_id !== partner.facility_id) {
    throw new PartnerStoreError('請求書が見つかりません。', 404, 'not_found');
  }
  if (row.status !== 'issued') throw new PartnerStoreError('取り消した請求書は送信できません。', 409, 'void');

  const doc = row.document;
  const to = await invoiceRecipients(db, partner);
  let sent = false;
  let reason: string | null = null;
  let attachedPdf = false;
  if (!to.length) {
    reason = '送信先がありません（取引先の連絡先メール・マスタユーザーのメールが未登録）';
  } else {
    const pdf = await renderInvoicePdf(doc, opts.pdf);
    const attachments: MailAttachment[] = pdf ? [{ filename: invoiceFileName(doc, 'pdf'), type: 'application/pdf', content: pdf }] : [];
    attachedPdf = attachments.length > 0 && fitsAttachmentLimit(attachments);
    const body = invoiceMailBody(doc, partnerInvoicesUrl(origin, partner.url_token), attachedPdf);
    const result = await sendPartnerMail(db, partner.facility_id, {
      to,
      subject: invoiceMailSubject(doc),
      html: body.html,
      text: body.text,
      attachments: attachedPdf ? attachments : undefined
    });
    sent = result.sent;
    reason = result.sent ? null : (result.reason ?? '送信できませんでした');
  }

  const patch = sent
    ? { sent_at: new Date().toISOString(), sent_to: to, send_error: null }
    : { send_error: sendFailureMessage(row.send_error, reason ?? '送信できませんでした') };
  const { data, error } = await db
    .from('rms_partner_invoices')
    .update(patch)
    .eq('id', row.id)
    .eq('partner_id', partner.id)
    .select(INVOICE_COLUMNS)
    .single();
  if (error) console.error('[partner-invoice] 送信結果を記録できませんでした:', error.message);
  return { sent, to, attachedPdf, reason, invoice: (data as PartnerInvoiceRow | null) ?? { ...row, ...patch } };
}

// ---------------------------------------------------------------------------
// 取消
// ---------------------------------------------------------------------------

/** 請求書を取り消す（理由必須）。取り消すと同じ月を発行し直せる。番号は欠番になる。 */
export async function voidPartnerInvoice(
  db: SupabaseClient,
  partner: InvoicePartner,
  invoiceId: string,
  reason: string,
  staffId: string | null
): Promise<PartnerInvoiceRow> {
  const why = reason.trim().slice(0, 300);
  if (!why) throw new PartnerStoreError('取消の理由を入力してください。');
  const row = await getPartnerInvoice(db, partner.id, invoiceId);
  if (!row || row.facility_id !== partner.facility_id) throw new PartnerStoreError('請求書が見つかりません。', 404, 'not_found');
  if (row.status === 'void') throw new PartnerStoreError('この請求書は取消済みです。', 409, 'void');
  const { data, error } = await db
    .from('rms_partner_invoices')
    .update({ status: 'void', voided_at: new Date().toISOString(), voided_by: staffId, void_reason: why })
    .eq('id', row.id)
    .eq('partner_id', partner.id)
    .eq('status', 'issued')
    .select(INVOICE_COLUMNS)
    .maybeSingle();
  if (error) raise(error, '請求書を取り消せませんでした。');
  if (!data) throw new PartnerStoreError('この請求書は取消済みです。', 409, 'void');
  return data as PartnerInvoiceRow;
}

// ---------------------------------------------------------------------------
// 月末の自動発行（cron）
// ---------------------------------------------------------------------------

export type MonthEndFacilityResult = {
  facilityId: string;
  facilityName: string;
  /** pending = 時間予算が尽きてこの呼び出しでは処理しきれていない（次の呼び出しで続ける） */
  status: 'done' | 'auto_off' | 'no_bank_account' | 'error' | 'pending';
  partners: number; // 対象予約のある取引先
  issued: number; // この呼び出しで発行した
  existing: number; // 発行済みだった
  sent: number; // この呼び出しで送信できた（新規発行・再試行とも）
  sendFailed: number; // この呼び出しで送信に失敗した（次の呼び出しで再試行する）
  gaveUp: number; // 送信失敗が上限回数に達して諦めた（管理画面から再送する）
  failed: { partnerId: string; name: string; error: string }[];
  error?: string;
};

export type MonthEndResult =
  | { skipped: 'not_month_end'; today: string }
  | {
      today: string;
      period: string;
      /** true = 時間予算が尽きて途中で返した（残りは次の呼び出しで続ける） */
      partial: boolean;
      /** この呼び出しで確認できなかった取引先の数（partial のときだけ 0 以外） */
      remaining: number;
      elapsedMs: number;
      facilities: MonthEndFacilityResult[];
    };

export type MonthEndOptions = {
  /** 「今日」（JST）。テスト用の上書き。省くと todayJst() */
  today?: string;
  /** 1回の呼び出しの時間予算（ミリ秒）。超えたら次の取引先に進まず返す。既定 20 秒 */
  budgetMs?: number;
  /** 振込先が未設定のとき施設の通知先へ知らせるか（1日に何度も呼ぶので最初の呼び出しだけ true にする）。既定 true */
  notifyMissingBankAccount?: boolean;
};

const MONTH_END_BUDGET_MS = 20_000;
// cron 経路の PDF 生成: 1回 15 秒で諦め、レート制限でも待たない（作れなければ添付なし＋ページ案内で送る）
const CRON_PDF_OPTIONS: RenderInvoicePdfOptions = { timeoutMs: 15_000, backoff: false };

type PartnerSourceRow = InvoicePartner & { booking_enabled: boolean };

/** 施設の取引先のうち、その月（今日まで）にチェックアウトの確定予約があるもの。 */
async function partnersWithBookings(db: SupabaseClient, facilityId: string, period: string, today: string): Promise<PartnerSourceRow[]> {
  const { data: rows, error } = await db
    .from('rms_partner_bookings')
    .select('partner_id')
    .eq('facility_id', facilityId)
    .eq('status', 'confirmed')
    .gte('check_out_date', period)
    .lte('check_out_date', invoiceCutoffDate(period, today));
  if (error) raise(error, '予約を読み込めませんでした。');
  const ids = [...new Set(((rows ?? []) as { partner_id: string | null }[]).map((r) => r.partner_id).filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const { data, error: pErr } = await db
    .from('rms_partners')
    .select('id, tenant_id, facility_id, name, contact_email, url_token, booking_settings, booking_enabled')
    .eq('facility_id', facilityId)
    .in('id', ids)
    .order('name');
  if (pErr) raise(pErr, '取引先を読み込めませんでした。');
  return ((data ?? []) as Record<string, unknown>[]).map((p) => ({
    ...(p as unknown as PartnerSourceRow),
    booking_settings: normalizePartnerBookingSettings(p.booking_settings),
    booking_enabled: p.booking_enabled === true
  }));
}

async function notifyMissingBankAccount(db: SupabaseClient, facilityId: string, facilityName: string, period: string, partners: PartnerSourceRow[]) {
  const to = [...new Set(partners.flatMap((p) => p.booking_settings.notifyEmails.map((e) => e.trim().toLowerCase())).filter((e) => EMAIL_RE.test(e)))];
  if (!to.length) {
    console.error(`[partner-invoice] ${facilityName}: 振込先が未設定で自動発行できず、通知先もありません`);
    return;
  }
  const names = partners.map((p) => `・${p.name}`).join('\n');
  const text = [
    `${periodLabel(period)}ご利用分の取引先のご請求書を自動発行できませんでした。`,
    '理由: ご請求書の振込先が未設定です。',
    '',
    '管理画面「取引先」の「請求書の設定」で振込先を登録し、各取引先の画面の「ご請求書」から発行・送信してください。',
    '',
    '対象の取引先:',
    names
  ].join('\n');
  await sendFacilityNotice(db, facilityId, {
    to,
    subject: `【${facilityName}】振込先が未設定のためご請求書を自動発行できませんでした（${periodLabel(period)}分）`,
    text,
    html: `<div style="font-family:sans-serif;line-height:1.7">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`
  }).catch((e) => console.error('[partner-invoice] 通知を送れませんでした:', e instanceof Error ? e.message : e));
}

const emptyFacilityResult = (facilityId: string): MonthEndFacilityResult => ({
  facilityId,
  facilityName: '',
  status: 'done',
  partners: 0,
  issued: 0,
  existing: 0,
  sent: 0,
  sendFailed: 0,
  gaveUp: 0,
  failed: []
});

/**
 * 月末日なら、その月の取引先の請求書を施設ごとに発行して送る（cron 用）。月末日でなければ何もしない。
 * 自動発行が OFF・振込先が未設定の施設は発行しない（未設定なら施設の通知先へ知らせる）。1取引先の失敗で全体を止めない。
 *
 * 冪等・再開可能（月末日に10分おきに数回呼ばれる前提）:
 *   - 発行済みの取引先は発行し直さない。自動発行したもので未送信（sent_at が空）なら送信を試みる
 *     （送信失敗は send_error に回数を残し、MAX_INVOICE_SEND_ATTEMPTS 回失敗したら諦める＝管理画面から再送する）。
 *   - 時間予算（budgetMs）を使い切ったら次の取引先に進まず partial:true で返す。残りは次の呼び出しで続ける。
 *     1社の処理（PDF 最大15秒＋メール）の途中では止めないので、1回の呼び出しは最長で「予算＋約20秒」かかる。
 */
export async function issueMonthEndInvoices(db: SupabaseClient, origin: string, opts: MonthEndOptions = {}): Promise<MonthEndResult> {
  const startedAt = Date.now();
  const today = opts.today ?? todayJst();
  if (!isLastDayOfMonth(today)) return { skipped: 'not_month_end', today };
  const period = periodOf(today);
  const budgetMs = opts.budgetMs ?? MONTH_END_BUDGET_MS;
  const overBudget = () => Date.now() - startedAt >= budgetMs;
  const facilities: MonthEndFacilityResult[] = [];
  let partial = false;
  let remaining = 0;

  for (const facilityId of Object.values(FACILITY_UUID)) {
    const r = emptyFacilityResult(facilityId);
    facilities.push(r);
    // 予算切れのあとの施設は、対象の取引先の数だけ数える（DB を読むだけ・発行も送信もしない）
    if (partial) {
      r.status = 'pending';
      try {
        r.partners = (await partnersWithBookings(db, facilityId, period, today)).length;
        remaining += r.partners;
      } catch (e) {
        r.error = e instanceof Error ? e.message : String(e);
      }
      continue;
    }
    try {
      const settings = await loadBillingSettings(db, facilityId);
      r.facilityName = settings.facilityName;
      if (!settings.autoIssue) {
        r.status = 'auto_off';
        continue;
      }
      const partners = await partnersWithBookings(db, facilityId, period, today);
      r.partners = partners.length;
      if (!partners.length) continue;
      if (!settings.bankAccount) {
        r.status = 'no_bank_account';
        if (opts.notifyMissingBankAccount !== false) {
          await notifyMissingBankAccount(db, facilityId, settings.facilityName || '山人', period, partners);
        }
        continue;
      }
      // PDF 生成（Browser Rendering）はレート制限があるので、1社ずつ順に
      for (let i = 0; i < partners.length; i++) {
        if (overBudget()) {
          partial = true;
          remaining += partners.length - i;
          r.status = 'pending';
          break;
        }
        const p = partners[i];
        try {
          const res = await issuePartnerInvoice(db, p, period, { by: 'auto', send: true, origin, today, pdf: CRON_PDF_OPTIONS });
          if (!res) continue;
          if (res.created) {
            r.issued += 1;
            if (res.mail?.sent) r.sent += 1;
            else r.sendFailed += 1;
            continue;
          }
          r.existing += 1;
          const inv = res.invoice;
          // スタッフが発行したもの（送るかどうかはスタッフが決める）・送信済みは触らない
          if (inv.issued_by !== 'auto' || inv.sent_at) continue;
          if (sendFailureCount(inv.send_error) >= MAX_INVOICE_SEND_ATTEMPTS) {
            r.gaveUp += 1;
            continue;
          }
          const mail = await sendPartnerInvoiceMail(db, p, inv, origin, { pdf: CRON_PDF_OPTIONS });
          if (mail.sent) r.sent += 1;
          else r.sendFailed += 1;
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error(`[partner-invoice] ${p.name} の発行に失敗:`, message);
          r.failed.push({ partnerId: p.id, name: p.name, error: message.slice(0, 300) });
        }
      }
    } catch (e) {
      r.status = 'error';
      r.error = e instanceof Error ? e.message : String(e);
      console.error(`[partner-invoice] 施設 ${facilityId} の処理に失敗:`, r.error);
    }
  }
  return { today, period, partial, remaining, elapsedMs: Date.now() - startedAt, facilities };
}
