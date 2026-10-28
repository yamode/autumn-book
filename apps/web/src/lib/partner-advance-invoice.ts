// 取引先予約の「前受金のご請求書」の組み立てと紙面（サーバ・画面共通の純関数）。
//
// 設計: docs/partner-prepayment.md §4 §5（2026-10-28 ユーザー指示・フェーズ3）。
//   - 銀行振込の事前支払（deposit_bank＝一部／advance_bank＝全額）の予約ごとに1枚。予約確定と同時に発行する。
//   - 月次の請求書（$lib/partner-invoice・rms_partner_invoices）とは別の書類・別の表（rms_partner_advance_invoices）。
//     紙面の体裁（フォント・色・A4）だけ月次と揃える（CSS は月次のものを共用）。
//   - 前受金は役務提供（ご宿泊）の前なので、消費税の区分・消費税額は載せない。ご宿泊後の月次のご請求書で示す。
//     ★ 税の扱いは経理の確認待ち。紙面・メールの文言は ADVANCE_INVOICE_TEXT の1か所にまとめてある（直すときはここだけ）。
//   - 紙面の全内容は rms_partner_advance_invoices.document に固定して持つ（発行後に予約・発行元を変えても紙面は変わらない）。
import {
  chargeAmountOf,
  DEPOSIT_BANK_OPTION,
  depositRemainderText,
  isAdvanceBankOption,
  isDepositRemainderBilled
} from '$lib/partner-booking';
import { INVOICE_DRAFT_STYLE, INVOICE_STYLE, type InvoiceIssuer } from '$lib/partner-invoice';

// ---- 文言（★ 税の扱いが決まったらここだけ直す） ----

export const ADVANCE_INVOICE_TEXT = {
  /** 書類名 */
  title: '前受金のご請求書',
  /** 題名の下の小見出し */
  sub: 'ご宿泊前のお振込みのお願い',
  /** ご請求金額の欄の見出し（消費税の区分は載せない） */
  amountLabel: 'ご請求金額（前受金）',
  /** 紙面の冒頭・メールの本文の注記（前受金は役務提供前のため消費税を載せない） */
  lead: 'ご宿泊料金の前受金として、下記の金額をお振込みください。',
  taxNote: '消費税の区分は、ご宿泊後の月次のご請求書でお示しします。',
  /** 宿泊料金の行の見出し（「税込」等の税の表記は付けない） */
  lodgingLabel: '宿泊料金',
  bathTaxLabel: '入湯税',
  /** 発行者欄に適格請求書発行事業者の登録番号を出すか（適格請求書ではないので既定は出さない） */
  showRegistrationNumber: false
} as const;

// ---- 型 ----

/** 前受金のご請求書の紙面（rms_partner_advance_invoices.document に固定して持つ） */
export type AdvanceInvoiceDocument = {
  version: 1;
  kind: 'advance';
  invoiceNo: string;
  issueDate: string; // 発行日（YYYY-MM-DD・JST）
  dueDate: string; // お振込期限（台帳の advance_due_date）
  recipient: { name: string };
  /** 発行元（月次と同じ形。振込先 bankAccount・備考 note を載せる。facilityName は使わない＝''） */
  issuer: InvoiceIssuer;
  booking: {
    bookingId: string;
    bookingCode: string;
    facilityName: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    roomName: string;
    roomCount: number;
    adults: number;
    planName: string;
    guestName: string;
    bookerName: string;
  };
  amounts: {
    lodging: number; // 宿泊料金（割引前）
    bathTax: number; // 入湯税
    discount: number; // 予約時決済の割引（銀行振込の事前支払には付かないので通常 0）
    usage: number; // ご利用総額 = lodging + bathTax − discount
    advance: number; // 前受金の額（今回のご請求）
    remainder: number; // 残額 = usage − advance（全額なら 0）
    partial: boolean; // true = 一部事前支払（deposit_bank）・false = 前受金（全額・advance_bank）
    /** 残額の精算先の文言（「月末の請求書で貴社へご請求」／「現地でご精算」）。全額なら '' */
    remainderNote: string;
  };
};

/** 前受金のご請求書を組み立てるのに読む台帳の列（rms_partner_bookings の一部） */
export type AdvanceInvoiceBookingSource = {
  id: string;
  booking_code: string;
  status: string;
  payment_option: string | null;
  payment_status: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  room_name: string | null;
  room_code?: string | null;
  room_count: number;
  adult_total: number;
  plan_name: string | null;
  guest_name: string;
  booked_by: string | null;
  total_amount: number;
  bath_tax_amount?: number | null;
  prepay_discount_amount?: number | null;
  advance_amount?: number | null;
  advance_due_date?: string | null;
  remainder_option?: string | null;
  detail?: { booker?: { name?: string } | null; plan_display_name?: string | null } | null;
};

// ---- 発行できるか ----

/**
 * 前受金のご請求書を発行できない理由（できるなら null）。
 * 銀行振込の事前支払（deposit_bank / advance_bank）・前受金の額と期限あり・確定済み・入金前（paid / 返金系でない）。
 */
export function advanceInvoiceProblem(b: Pick<AdvanceInvoiceBookingSource, 'payment_option' | 'advance_amount' | 'advance_due_date' | 'status' | 'payment_status'>): string | null {
  if (!isAdvanceBankOption(b.payment_option)) return '銀行振込の事前支払（一部事前支払・前受金）の予約ではありません。';
  if (!b.advance_amount || b.advance_amount <= 0 || !b.advance_due_date) return '前受金の額・お振込期限が台帳にありません。';
  if (b.status !== 'confirmed') return '確定済みの予約ではないため、前受金のご請求書を発行できません。';
  if (b.payment_status === 'paid') return '前受金は入金済みです。';
  if (b.payment_status === 'refunded' || b.payment_status === 'refund_failed') return '返金の手続きをした予約です。';
  return null;
}

// ---- 組み立て ----

/** 台帳の予約から紙面を組み立てる。advance_amount / advance_due_date が無い予約は呼ばない（advanceInvoiceProblem で弾く） */
export function buildAdvanceInvoiceDocument(input: {
  booking: AdvanceInvoiceBookingSource;
  issuer: InvoiceIssuer;
  recipientName: string;
  facilityName: string;
  invoiceNo: string;
  issueDate: string;
}): AdvanceInvoiceDocument {
  const b = input.booking;
  const lodging = b.total_amount;
  const bathTax = b.bath_tax_amount ?? 0;
  const discount = b.prepay_discount_amount ?? 0;
  const usage = chargeAmountOf(b);
  const advance = Math.max(0, Math.min(b.advance_amount ?? 0, usage));
  const partial = b.payment_option === DEPOSIT_BANK_OPTION;
  const remainder = partial ? Math.max(0, usage - advance) : 0;
  return {
    version: 1,
    kind: 'advance',
    invoiceNo: input.invoiceNo,
    issueDate: input.issueDate,
    dueDate: b.advance_due_date ?? input.issueDate,
    recipient: { name: input.recipientName },
    issuer: { ...input.issuer, facilityName: '' },
    booking: {
      bookingId: b.id,
      bookingCode: b.booking_code,
      facilityName: input.facilityName,
      checkIn: b.check_in_date,
      checkOut: b.check_out_date,
      nights: b.nights,
      roomName: (b.room_name ?? '').trim() || (b.room_code ?? ''),
      roomCount: b.room_count,
      adults: b.adult_total,
      // 取引先向けのプラン名（予約時点）。無い予約は元の名前
      planName: (b.detail?.plan_display_name ?? '').trim() || (b.plan_name ?? ''),
      guestName: b.guest_name,
      bookerName: (b.detail?.booker?.name ?? '').trim() || (b.booked_by ?? '')
    },
    amounts: {
      lodging,
      bathTax,
      discount,
      usage,
      advance,
      remainder,
      partial,
      remainderNote: partial ? depositRemainderText(isDepositRemainderBilled(b.remainder_option)) : ''
    }
  };
}

// ---- 紙面（HTML） ----

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');
export const advanceYmd = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
const ymd = advanceYmd;
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

const DRAFT_SUFFIX = '（予定）';

// 前受金の紙面だけに足す CSS（月次の STYLE の上に載せる）
const ADVANCE_STYLE = `
.lead { margin: 0 0 3mm; font-size: 10pt; }
table.t.kv th { width: 38mm; text-align: left; }
`;

export type RenderAdvanceInvoiceOptions = {
  /** true = 下書き（書類名に「（予定）」・上部の帯・「予定」の透かし・番号は未発行） */
  draft?: boolean;
};

/** 金額の内訳の行（一部事前支払は ご利用総額・前受金・残額、全額は ご利用総額・前受金） */
export function advanceAmountRows(a: AdvanceInvoiceDocument['amounts']): { label: string; value: number; note?: string; strong?: boolean }[] {
  const rows: { label: string; value: number; note?: string; strong?: boolean }[] = [
    { label: ADVANCE_INVOICE_TEXT.lodgingLabel, value: a.lodging },
    ...(a.bathTax ? [{ label: ADVANCE_INVOICE_TEXT.bathTaxLabel, value: a.bathTax }] : []),
    ...(a.discount ? [{ label: '割引', value: -a.discount }] : []),
    { label: 'ご利用総額', value: a.usage }
  ];
  if (a.partial) {
    rows.push({ label: '前受金（今回のご請求）', value: a.advance, strong: true });
    rows.push({ label: '残額', value: a.remainder, note: a.remainderNote });
  } else {
    rows.push({ label: '前受金（全額・今回のご請求）', value: a.advance, strong: true });
  }
  return rows;
}

/** 紙面の HTML（1ファイル完結・A4 縦1枚）。opts.draft で下書き。 */
export function renderAdvanceInvoiceHtml(doc: AdvanceInvoiceDocument, opts: RenderAdvanceInvoiceOptions = {}): string {
  const draft = opts.draft === true;
  const i = doc.issuer;
  const b = doc.booking;
  const a = doc.amounts;
  const title = draft ? ADVANCE_INVOICE_TEXT.title + DRAFT_SUFFIX : ADVANCE_INVOICE_TEXT.title;
  const amountRows = advanceAmountRows(a)
    .map(
      (r) =>
        `<tr${r.strong ? ' class="sum"' : ''}><td>${esc(r.label)}${r.note ? `<br><span class="muted small">${esc(r.note)}</span>` : ''}</td><td class="n">${r.value < 0 ? `−${yen(-r.value)}` : yen(r.value)}</td></tr>`
    )
    .join('');
  const page = `
<section class="page">
${draft ? `<div class="draft-band">下書き — 正式な${esc(ADVANCE_INVOICE_TEXT.title)}ではありません</div>` : ''}
<h1>${esc(title)}</h1>
<div class="sub">${esc(ADVANCE_INVOICE_TEXT.sub)}</div>
<div class="head">
  <div><div class="to">${esc(doc.recipient.name)} 御中</div></div>
  <div>
    <table class="meta">
      <tr><td>請求書番号</td><td>${esc(draft ? '（未発行）' : doc.invoiceNo)}</td></tr>
      <tr><td>発行日</td><td>${ymd(doc.issueDate)}</td></tr>
    </table>
    <div class="issuer">
      <b>${esc(i.name)}</b><br>
      ${i.address ? `${nl2br(i.address)}<br>` : ''}
      ${i.tel ? `TEL ${esc(i.tel)}<br>` : ''}
      ${ADVANCE_INVOICE_TEXT.showRegistrationNumber && i.registrationNumber ? `登録番号 ${esc(i.registrationNumber)}` : ''}
    </div>
  </div>
</div>
<div class="amount"><span class="l">${esc(ADVANCE_INVOICE_TEXT.amountLabel)}</span><span class="v">${yen(a.advance)}</span></div>
<p class="lead">${esc(ADVANCE_INVOICE_TEXT.lead)}</p>
<div class="box" style="margin-top:0;margin-bottom:5mm">
  <h3>お振込期限　${ymd(doc.dueDate)}</h3>
  ${i.bankAccount ? `<div>お振込先：${nl2br(i.bankAccount)}</div>` : ''}
  ${i.note ? `<div class="note">${nl2br(i.note)}</div>` : ''}
</div>
<div class="grp"><span>ご予約の内容</span><small>予約番号 ${esc(b.bookingCode)}</small></div>
<table class="t kv">
  <tr><th>施設</th><td>${esc(b.facilityName)}</td></tr>
  <tr><th>ご宿泊日</th><td>${ymd(b.checkIn)}〜${ymd(b.checkOut)}（${b.nights}泊）</td></tr>
  <tr><th>お部屋</th><td>${esc(b.roomName)} ${b.roomCount}室・${b.adults}名</td></tr>
  <tr><th>プラン</th><td>${esc(b.planName)}</td></tr>
  <tr><th>ご宿泊者</th><td>${esc(b.guestName)} 様</td></tr>
  ${b.bookerName ? `<tr><th>ご予約者</th><td>${esc(b.bookerName)}</td></tr>` : ''}
</table>
<div class="grp"><span>金額の内訳</span><small>${a.partial ? '一部事前支払（銀行振込）' : '前受金（全額・銀行振込）'}</small></div>
<table class="t" style="width:115mm">
  <colgroup><col><col style="width:38mm"></colgroup>
  ${amountRows}
</table>
<div class="note">
  ※ ${esc(ADVANCE_INVOICE_TEXT.taxNote)}<br>
  ※ 金額はご予約時の料金です。ご宿泊時の追加のご利用は含みません。${a.partial && a.remainder > 0 ? `<br>※ 残額 ${yen(a.remainder)} は${esc(a.remainderNote)}となります。` : ''}<br>
  ※ ご宿泊日 ${md(b.checkIn)} より前のお振込みをお願いいたします。
</div>
</section>`;
  const docTitle = draft ? `${title} ${doc.recipient.name} ${b.bookingCode}` : `${ADVANCE_INVOICE_TEXT.title} ${doc.invoiceNo}`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(docTitle)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=block" rel="stylesheet">
<style>${INVOICE_STYLE}${ADVANCE_STYLE}${draft ? INVOICE_DRAFT_STYLE : ''}</style></head><body>${draft ? '<div class="draft-wm" aria-hidden="true">予定</div>' : ''}${page}</body></html>`;
}

// ダウンロード・添付のファイル名（例: 前受金のご請求書_PA-202610-00001_PB-xxxx.pdf）
export const advanceInvoiceFileName = (doc: Pick<AdvanceInvoiceDocument, 'invoiceNo' | 'booking'>, ext: 'pdf' | 'html') =>
  `${ADVANCE_INVOICE_TEXT.title}_${doc.invoiceNo}_${doc.booking.bookingCode}.${ext}`;

// ---- メール（件名・本文） ----

/** 件名: 【施設名】前受金のご請求書（PA-…）お振込期限 YYYY年M月D日 */
export const advanceInvoiceMailSubject = (doc: Pick<AdvanceInvoiceDocument, 'invoiceNo' | 'dueDate' | 'booking' | 'issuer'>) =>
  `【${doc.booking.facilityName || doc.issuer.name}】${ADVANCE_INVOICE_TEXT.title}（${doc.invoiceNo}）お振込期限 ${ymd(doc.dueDate)}`;

export function advanceInvoiceMailBody(doc: AdvanceInvoiceDocument, pageUrl: string, attached: boolean): { text: string; html: string } {
  const b = doc.booking;
  const a = doc.amounts;
  const facility = b.facilityName || doc.issuer.name;
  const lines = [
    `${doc.recipient.name} 御中`,
    '',
    `いつも${facility}をご利用いただき、ありがとうございます。`,
    `ご予約（${b.bookingCode}）の${ADVANCE_INVOICE_TEXT.title}をお送りします。`,
    `${ADVANCE_INVOICE_TEXT.lead}${ADVANCE_INVOICE_TEXT.taxNote}`,
    '',
    `請求書番号: ${doc.invoiceNo}`,
    `ご宿泊: ${ymd(b.checkIn)}（${b.nights}泊）　${b.roomName} ${b.roomCount}室・${b.adults}名　${b.guestName} 様`,
    `ご利用総額: ${yen(a.usage)}`,
    a.partial ? `前受金（今回のご請求）: ${yen(a.advance)}` : `前受金（全額）: ${yen(a.advance)}`,
    ...(a.partial ? [`残額: ${yen(a.remainder)}（${a.remainderNote}）`] : []),
    `お振込期限: ${ymd(doc.dueDate)}`,
    ...(doc.issuer.bankAccount ? ['お振込先:', ...doc.issuer.bankAccount.split('\n').map((l) => `　${l}`)] : []),
    ...(doc.issuer.note ? ['', doc.issuer.note] : []),
    '',
    attached ? 'PDF を添付しています。' : '書類は下記のページからダウンロードできます。',
    `取引先ページ「アカウント → ご請求書」: ${pageUrl}`,
    '（ログインが必要です。ご請求書はいつでもダウンロードできます）',
    '',
    doc.issuer.name,
    ...(doc.issuer.tel ? [`TEL ${doc.issuer.tel}`] : [])
  ];
  const text = lines.join('\n');
  const html = `<div style="font-family:sans-serif;line-height:1.7">${lines
    .map((l) => (l.includes(pageUrl) ? `取引先ページ「アカウント → ご請求書」: <a href="${esc(pageUrl)}">${esc(pageUrl)}</a>` : esc(l)))
    .join('<br>')}</div>`;
  return { text, html };
}

/** 予約確認メールに足す1行（銀行振込の事前支払のときだけ。それ以外は null） */
export function advanceBookingMailLine(b: Pick<AdvanceInvoiceBookingSource, 'payment_option' | 'advance_amount' | 'advance_due_date'>): string | null {
  if (!isAdvanceBankOption(b.payment_option) || !b.advance_amount || b.advance_amount <= 0 || !b.advance_due_date) return null;
  return `前受金 ${yen(b.advance_amount)} を ${ymd(b.advance_due_date)}までにお振込みください（${ADVANCE_INVOICE_TEXT.title}は別メールでお送りします／取引先ページ「アカウント → ご請求書」からもダウンロードできます）。`;
}

// ---- 状態（取引先ページ・管理画面の表示） ----

export type AdvanceInvoiceState = 'waiting' | 'overdue' | 'paid' | 'void' | 'booking_cancelled';

/** 状態: 取消（void）→ ご予約取消 → 入金済み（台帳の payment_status='paid'）→ 期限超過 → 入金待ち */
export function advanceInvoiceStateOf(
  inv: { status: string; due_date: string },
  booking: { status: string; payment_status: string } | null,
  today: string
): AdvanceInvoiceState {
  if (inv.status === 'void') return 'void';
  if (booking?.status === 'cancelled') return 'booking_cancelled';
  if (booking?.payment_status === 'paid') return 'paid';
  return inv.due_date < today ? 'overdue' : 'waiting';
}

export const ADVANCE_INVOICE_STATE_LABEL: Record<AdvanceInvoiceState, string> = {
  waiting: '入金待ち',
  overdue: '入金待ち（期限超過）',
  paid: '入金済み',
  void: '取消',
  booking_cancelled: '取消（ご予約取消）'
};
