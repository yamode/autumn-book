// 取引先予約の月次請求書（利用明細書＋適格請求書）の計算と紙面（サーバ・画面共通の純関数）。
//
// 2026-10-01 ユーザー指示:
//   - チェックアウト基準・月末締め。金額は予約時の金額（rms_partner_bookings）。PMS の会計実績は使わない。
//   - ご請求（振込を求める）のは「月末締め翌月末銀行振込」と、「請求書で精算」にした自由入力の支払方法。
//     利用明細書には当月チェックアウトの取引先予約をすべて載せる（オンライン決済済み等は「お支払い済み・別精算」）。
//   - 支払期限は翌月末。
// 適格請求書の記載事項（消費税法 57条の4）: 発行者の名称・登録番号／取引年月日／取引内容／
//   税率ごとに区分した対価の額（税込）と適用税率／税率ごとの消費税額（請求書1枚につき税率ごとに1回の端数処理）／受領者の名称。
// 宿泊料金は税込10%。入湯税は消費税の対象外（不課税）として別に区分する。
//
// 紙面（HTML）は Cloudflare Browser Rendering で PDF にする（lib/server/partners/invoice-pdf.ts）。
// PDF が作れない環境でも、同じ HTML をそのまま開いて印刷できる。
import { chargeAmountOf, type PartnerBookingSettings } from '$lib/partner-booking';

export const INVOICE_TAX_RATE = 10;

// 請求書の対象として読む予約の列（rms_partner_bookings の一部）
export type InvoiceBookingSource = {
  id: string;
  booking_code: string;
  status: string;
  check_in_date: string;
  check_out_date: string;
  nights: number;
  room_name: string | null;
  room_short_name?: string | null; // 部屋タイプの短縮名（紙面ではこちらを優先）
  room_count: number;
  adult_total: number;
  plan_name: string | null;
  guest_name: string;
  booked_by: string | null;
  total_amount: number;
  bath_tax_amount: number | null;
  prepay_discount_amount: number | null;
  payment_option: string | null;
  payment_method_name: string | null;
  payment_status: string;
  detail?: { booker?: { name?: string } | null; plan_display_name?: string | null } | null;
};

export type InvoiceLine = {
  bookingId: string;
  bookingCode: string;
  checkIn: string;
  checkOut: string; // 取引年月日（チェックアウト日）
  nights: number;
  roomName: string;
  roomCount: number;
  adults: number;
  planName: string;
  guestName: string;
  bookerName: string;
  paymentLabel: string; // 旧形式（お支払方法＋状態）。2026-10-02 以降は paymentMethod / paymentNote も持つ
  paymentMethod?: string; // お支払方法の名前（ご利用明細書のグループ見出し）
  paymentNote?: string; // ご請求の対象外の理由（決済済み・別途精算など。対象なら ''）
  lodging: number; // 宿泊料金（税込10%・割引前）
  bathTax: number; // 入湯税（不課税）
  discount: number; // 予約時決済の割引
  usage: number; // ご利用額 = lodging + bathTax - discount
  billable: boolean;
  billed: number; // ご請求額（billable なら usage、それ以外 0）
};

export type InvoiceIssuer = {
  name: string;
  facilityName: string;
  address: string;
  tel: string;
  registrationNumber: string;
  bankAccount: string;
  note: string;
};

// 紙面の全内容（rms_partner_invoices.document に固定して持つ）
export type InvoiceDocument = {
  version: 1;
  invoiceNo: string;
  period: string; // YYYY-MM-01
  issueDate: string;
  dueDate: string;
  recipient: { name: string };
  issuer: InvoiceIssuer;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
};

export type InvoiceTotals = {
  usageTotal: number;
  paidTotal: number; // お支払い済み・別精算（ご請求の対象外）
  billedTotal: number;
  taxable10: number; // ご請求のうち 10% 対象（税込）
  tax10: number; // うち消費税
  nonTaxable: number; // ご請求のうち 入湯税（不課税）
};

// ---- 日付（JST の暦日として ISO 文字列で扱う） ----

const pad = (n: number) => String(n).padStart(2, '0');
export const periodOf = (isoDate: string) => `${isoDate.slice(0, 7)}-01`;
export function lastDayOfMonth(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${pad(m)}-${pad(d)}`;
}
export const isLastDayOfMonth = (isoDate: string) => lastDayOfMonth(periodOf(isoDate)) === isoDate;
export function nextMonthEnd(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(Date.UTC(y, m + 1, 0));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
export const periodLabel = (period: string) => `${Number(period.slice(0, 4))}年${Number(period.slice(5, 7))}月`;
const ymd = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

// ---- 対象・金額 ----

// ご請求（振込を求める）支払方法か。後払いは常に、自由入力は「請求書で精算」にしたものだけ。
export function isBillablePaymentOption(id: string | null | undefined, s: Pick<PartnerBookingSettings, 'customPaymentOptions'>): boolean {
  if (!id) return false;
  if (id === 'invoice_monthly') return true;
  return s.customPaymentOptions.some((o) => o.id === id && o.billable);
}

/**
 * 対象月のうち請求書に載せるチェックアウト日の上限。月末と今日（JST）の早いほう。
 * 月の途中で手動発行したとき、まだチェックアウトしていない予約を請求しないため。
 */
export const invoiceCutoffDate = (period: string, today?: string): string => {
  const end = lastDayOfMonth(period);
  return today && today < end ? today : end;
};

// 請求書に載せる予約か（確定済み・チェックアウト日が対象月かつ今日まで）。取消・支払待ち・期限切れは載せない。
// today を省くと月末まで（過去の月・月末の自動発行と同じ）。
export const isInvoiceTarget = (b: Pick<InvoiceBookingSource, 'status' | 'check_out_date'>, period: string, today?: string) =>
  b.status === 'confirmed' && b.check_out_date >= period && b.check_out_date <= invoiceCutoffDate(period, today);

// チェックイン日のカード決済が失敗したままの予約か（請求はしない・宿が確認する）
export const isChargeFailed = (b: Pick<InvoiceBookingSource, 'payment_status'>) => b.payment_status === 'charge_failed';

// ---- 送信の失敗回数（rms_partner_invoices.send_error の先頭に「[送信失敗 N回目]」として持つ・列は増やさない） ----

export const MAX_INVOICE_SEND_ATTEMPTS = 3;
const SEND_FAILURE_RE = /^\[送信失敗 (\d+)回目\]\s*/;

/** これまでの送信失敗回数。send_error が無ければ 0、回数の印が無い古い記録は 1。 */
export function sendFailureCount(sendError: string | null | undefined): number {
  if (!sendError) return 0;
  const m = SEND_FAILURE_RE.exec(sendError);
  return m ? Number(m[1]) : 1;
}

/** 送信失敗を記録する文言（前回までの回数に 1 を足して先頭に付ける）。 */
export function sendFailureMessage(previous: string | null | undefined, reason: string): string {
  const n = sendFailureCount(previous) + 1;
  return `[送信失敗 ${n}回目] ${reason.replace(SEND_FAILURE_RE, '')}`.slice(0, 500);
}

const paymentNote = (b: InvoiceBookingSource): string => {
  if (b.payment_status === 'paid') return 'オンライン決済済み';
  if (b.payment_status === 'charge_failed') return 'カード決済失敗（要確認）';
  if (b.payment_status === 'scheduled') return 'カード決済（チェックイン日）';
  return '別途精算';
};

export function buildInvoiceLines(bookings: InvoiceBookingSource[], s: Pick<PartnerBookingSettings, 'customPaymentOptions'>): InvoiceLine[] {
  return bookings
    .map((b): InvoiceLine => {
      const lodging = b.total_amount;
      const bathTax = b.bath_tax_amount ?? 0;
      const discount = b.prepay_discount_amount ?? 0;
      const usage = chargeAmountOf(b);
      const billable = isBillablePaymentOption(b.payment_option, s);
      return {
        bookingId: b.id,
        bookingCode: b.booking_code,
        checkIn: b.check_in_date,
        checkOut: b.check_out_date,
        nights: b.nights,
        roomName: (b.room_short_name ?? '').trim() || (b.room_name ?? ''),
        roomCount: b.room_count,
        adults: b.adult_total,
        // 取引先向けのプラン名（予約時点）。無い予約は元の名前
        planName: (b.detail?.plan_display_name ?? '').trim() || (b.plan_name ?? ''),
        guestName: b.guest_name,
        bookerName: (b.detail?.booker?.name ?? '').trim() || (b.booked_by ?? ''),
        paymentLabel: billable ? (b.payment_method_name ?? '') : `${b.payment_method_name ?? ''}（${paymentNote(b)}）`,
        paymentMethod: b.payment_method_name ?? '',
        paymentNote: billable ? '' : paymentNote(b),
        lodging,
        bathTax,
        discount,
        usage,
        billable,
        billed: billable ? usage : 0
      };
    })
    .sort((a, b) => a.checkOut.localeCompare(b.checkOut) || a.bookingCode.localeCompare(b.bookingCode));
}

export function invoiceTotals(lines: InvoiceLine[]): InvoiceTotals {
  const usageTotal = lines.reduce((s, l) => s + l.usage, 0);
  const billedLines = lines.filter((l) => l.billable);
  const billedTotal = billedLines.reduce((s, l) => s + l.billed, 0);
  const taxable10 = billedLines.reduce((s, l) => s + (l.lodging - l.discount), 0);
  const nonTaxable = billedLines.reduce((s, l) => s + l.bathTax, 0);
  return {
    usageTotal,
    paidTotal: usageTotal - billedTotal,
    billedTotal,
    taxable10,
    // 税込額から割り戻し、請求書1枚につき1回だけ切り捨て
    tax10: Math.floor((taxable10 * INVOICE_TAX_RATE) / (100 + INVOICE_TAX_RATE)),
    nonTaxable
  };
}

// ---- 紙面（HTML） ----

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');

const STYLE = `
@page { size: A4; margin: 13mm 13mm 15mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', 'Meiryo', sans-serif; color: #1c1917; font-size: 10pt; line-height: 1.5; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
h1 { font-size: 20pt; letter-spacing: .35em; text-align: center; margin: 0 0 1.5mm; font-weight: 700; }
.sub { text-align: center; font-size: 9pt; color: #57534e; margin-bottom: 6mm; }
.head { display: flex; justify-content: space-between; gap: 8mm; align-items: flex-start; }
.to { font-size: 14pt; border-bottom: 1px solid #1c1917; padding-bottom: 1mm; min-width: 85mm; }
.meta { font-size: 9pt; text-align: right; border-collapse: collapse; margin-left: auto; }
.meta td { padding: 0 0 0 4mm; white-space: nowrap; }
.issuer { margin-top: 3mm; font-size: 9pt; text-align: right; line-height: 1.55; }
.issuer b { font-size: 10.5pt; }
.amount { margin: 6mm 0 4mm; display: flex; align-items: baseline; gap: 6mm; border: 1.5px solid #1c1917; padding: 2.5mm 5mm; width: 115mm; }
.amount .l { font-size: 10.5pt; }
.amount .v { font-size: 19pt; font-weight: 700; }
table.t { width: 100%; border-collapse: collapse; font-size: 8.5pt; table-layout: fixed; }
table.t th, table.t td { border: 1px solid #a8a29e; padding: 1.2mm 1.6mm; vertical-align: top; }
table.t th { background: #f5f5f4; font-weight: 600; line-height: 1.3; }
table.t td.n, table.t th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
table.t .nw { white-space: nowrap; }
table.t td.n .wrap { white-space: normal; display: inline-block; text-align: right; }
table.t tr.sum td { font-weight: 700; background: #fafaf9; }
table.t tr.sub td { background: #fafaf9; }
.grp { margin: 5mm 0 1.5mm; font-size: 9.5pt; font-weight: 700; display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; border-left: 3px solid #1c1917; padding-left: 2mm; }
.grp small { font-weight: 400; color: #57534e; font-size: 8.5pt; white-space: nowrap; }
.box { margin-top: 5mm; border: 1px solid #a8a29e; padding: 3mm 4mm; font-size: 9.5pt; }
.box h3 { margin: 0 0 1mm; font-size: 9.5pt; }
.note { margin-top: 3mm; font-size: 8.5pt; color: #57534e; }
.muted { color: #78716c; }
.small { font-size: 7.5pt; }
`;

// 書類名（2026-10-02 指示:「ご請求書」「ご利用明細書」）
const DOC_INVOICE = 'ご請求書';
const DOC_STATEMENT = 'ご利用明細書';
// 予定請求書（正式発行前の試算・管理画面で確認する用。2026-10-02 指示）の書類名の後ろに付ける
const DRAFT_SUFFIX = '（予定）';

export type RenderInvoiceOptions = {
  /** true = 予定請求書（書類名に「（予定）」・上部の帯・「予定」の透かし・番号は未発行・発行日の欄は試算日）。doc.issueDate を試算日として扱う */
  draft?: boolean;
};

// 予定請求書だけに足す CSS（正式版の STYLE は変えない）
const DRAFT_STYLE = `
.draft-band { margin: 0 0 4mm; padding: 2mm 4mm; border: 1.5px solid #b45309; background: #fffbeb; color: #78350f; font-size: 9.5pt; font-weight: 700; text-align: center; }
.draft-wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 120pt; font-weight: 700; color: rgba(180, 83, 9, .08); transform: rotate(-30deg); pointer-events: none; z-index: 0; letter-spacing: .2em; }
`;

const draftBand = (doc: InvoiceDocument) =>
  `<div class="draft-band">予定請求書 — ${Number(doc.issueDate.slice(5, 7))}月${Number(doc.issueDate.slice(8, 10))}日時点の実績（チェックアウト済み）による試算です。正式なご請求書ではありません</div>`;

function headerBlock(doc: InvoiceDocument, title: string, sub: string, draft = false): string {
  const i = doc.issuer;
  return `${draft ? draftBand(doc) : ''}
<h1>${esc(draft ? title + DRAFT_SUFFIX : title)}</h1>
<div class="sub">${esc(sub)}</div>
<div class="head">
  <div><div class="to">${esc(doc.recipient.name)} 御中</div></div>
  <div>
    <table class="meta">
      <tr><td>請求書番号</td><td>${esc(draft ? '（未発行）' : doc.invoiceNo)}</td></tr>
      <tr><td>${draft ? '試算日' : '発行日'}</td><td>${ymd(doc.issueDate)}</td></tr>
    </table>
    <div class="issuer">
      <b>${esc(i.name)}</b><br>
      ${i.facilityName ? `${esc(i.facilityName)}<br>` : ''}
      ${i.address ? `${nl2br(i.address)}<br>` : ''}
      ${i.tel ? `TEL ${esc(i.tel)}<br>` : ''}
      ${i.registrationNumber ? `登録番号 ${esc(i.registrationNumber)}` : ''}
    </div>
  </div>
</div>`;
}

const periodSub = (doc: InvoiceDocument) =>
  `${periodLabel(doc.period)}ご利用分（${ymd(doc.period)}〜${ymd(lastDayOfMonth(doc.period))} チェックアウト）`;

// お部屋・人数の1行（例: 「オーシャンスイート57平米 1室・2名」）
const roomLine = (l: InvoiceLine) => `${esc(l.roomName)} ${l.roomCount}室・${l.adults}名`;

function invoicePage(doc: InvoiceDocument, draft = false): string {
  const t = doc.totals;
  const billed = doc.lines.filter((l) => l.billable);
  const rows = billed
    .map(
      (l) => `<tr>
  <td class="nw">${md(l.checkOut)}<br><span class="muted small">${esc(l.bookingCode)}</span></td>
  <td>ご宿泊 <span class="nw">${md(l.checkIn)}〜${l.nights}泊</span>　${roomLine(l)}<br><span class="muted">${esc(l.guestName)} 様</span></td>
  <td class="n">${yen(l.lodging - l.discount)}</td>
  <td class="n">${l.bathTax ? yen(l.bathTax) : '—'}</td>
  <td class="n">${yen(l.billed)}</td>
</tr>`
    )
    .join('');
  return `
<section class="page">
${headerBlock(doc, DOC_INVOICE, `適格請求書　${periodSub(doc)}`, draft)}
<div class="amount"><span class="l">ご請求金額（税込）</span><span class="v">${yen(t.billedTotal)}</span></div>
<table class="t" style="width:115mm;margin-bottom:5mm">
  <colgroup><col style="width:47mm"><col style="width:38mm"><col style="width:30mm"></colgroup>
  <tr><th>区分</th><th class="n">対象額（税込）</th><th class="n">消費税額</th></tr>
  <tr><td>10%対象（宿泊料金）</td><td class="n">${yen(t.taxable10)}</td><td class="n">${yen(t.tax10)}</td></tr>
  <tr><td>不課税（入湯税）</td><td class="n">${yen(t.nonTaxable)}</td><td class="n">—</td></tr>
  <tr class="sum"><td>合計</td><td class="n">${yen(t.billedTotal)}</td><td class="n">${yen(t.tax10)}</td></tr>
</table>
<table class="t">
  <colgroup><col style="width:25mm"><col><col style="width:21mm"><col style="width:15mm"><col style="width:21mm"></colgroup>
  <tr><th>取引日<span class="muted small">※</span><br><span class="muted small">予約番号</span></th><th>内容</th><th class="n">宿泊料金<br><span class="muted small">10%・税込</span></th><th class="n">入湯税<br><span class="muted small">不課税</span></th><th class="n">金額</th></tr>
  ${rows}
  <tr class="sum"><td colspan="2">合計（${billed.length}件）</td><td class="n">${yen(t.taxable10)}</td><td class="n">${yen(t.nonTaxable)}</td><td class="n">${yen(t.billedTotal)}</td></tr>
</table>
<div class="box">
  <h3>お支払期限　${ymd(doc.dueDate)}</h3>
  ${doc.issuer.bankAccount ? `<div>お振込先：${nl2br(doc.issuer.bankAccount)}</div>` : ''}
  ${doc.issuer.note ? `<div class="note">${nl2br(doc.issuer.note)}</div>` : ''}
</div>
<div class="note">※ 取引日はチェックアウト日です。ご利用の全予約の内訳は、次ページの${DOC_STATEMENT}をご覧ください。</div>
</section>`;
}

// ご利用明細書のグループ（お支払方法ごと。ご請求の対象を先に）。見出しを表の外に出して「お支払方法」の列を省く。
export type StatementGroup = { method: string; billable: boolean; lines: InvoiceLine[] };
export function groupStatementLines(lines: InvoiceLine[]): StatementGroup[] {
  const map = new Map<string, StatementGroup>();
  for (const l of lines) {
    // 旧形式（paymentMethod なし）は paymentLabel をそのまま見出しに
    const method = l.paymentMethod ?? l.paymentLabel;
    const key = `${l.billable ? 0 : 1}|${method}`;
    const g = map.get(key) ?? { method, billable: l.billable, lines: [] };
    g.lines.push(l);
    map.set(key, g);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, g]) => g);
}

function statementPage(doc: InvoiceDocument, draft = false): string {
  const t = doc.totals;
  const groups = groupStatementLines(doc.lines);
  const head = `<colgroup><col style="width:32mm"><col><col style="width:29mm"><col style="width:19mm"><col style="width:13mm"><col style="width:19mm"><col style="width:19mm"></colgroup>
  <tr><th>ご宿泊<br><span class="muted small">予約番号</span></th><th>お部屋・プラン</th><th>ご宿泊者</th><th class="n">宿泊料金<br><span class="muted small">税込</span></th><th class="n">入湯税</th><th class="n">ご利用額</th><th class="n">ご請求額</th></tr>`;
  const body = groups
    .map((g) => {
      const rows = g.lines
        .map(
          (l) => `<tr>
  <td class="nw">${md(l.checkIn)}〜${md(l.checkOut)}<span class="muted small">・${l.nights}泊</span><br><span class="muted small">${esc(l.bookingCode)}</span></td>
  <td>${roomLine(l)}<br><span class="muted">${esc(l.planName)}</span></td>
  <td>${esc(l.guestName)} 様${l.bookerName ? `<br><span class="muted small">ご予約者 ${esc(l.bookerName)}</span>` : ''}</td>
  <td class="n">${yen(l.lodging)}${l.discount ? `<br><span class="muted small">割引 −${yen(l.discount)}</span>` : ''}</td>
  <td class="n">${l.bathTax ? yen(l.bathTax) : '—'}</td>
  <td class="n">${yen(l.usage)}</td>
  <td class="n">${l.billable ? yen(l.billed) : `—${l.paymentNote ? `<br><span class="muted small wrap">${esc(l.paymentNote)}</span>` : ''}`}</td>
</tr>`
        )
        .join('');
      const usage = g.lines.reduce((s, l) => s + l.usage, 0);
      const billed = g.lines.reduce((s, l) => s + l.billed, 0);
      return `
<div class="grp"><span>お支払方法：${esc(g.method || '（未設定）')}</span><small>${g.billable ? 'ご請求の対象' : 'お支払い済み・別途精算（今回のご請求に含みません）'}・${g.lines.length}件</small></div>
<table class="t">
  ${head}
  ${rows}
  <tr class="sub"><td colspan="5">小計（${g.lines.length}件）</td><td class="n">${yen(usage)}</td><td class="n">${g.billable ? yen(billed) : '—'}</td></tr>
</table>`;
    })
    .join('');
  return `
<section class="page">
${headerBlock(doc, DOC_STATEMENT, periodSub(doc), draft)}
${body || '<p class="note">対象のご予約はありません。</p>'}
<table class="t" style="margin-top:4mm">
  <colgroup><col><col style="width:19mm"><col style="width:19mm"></colgroup>
  <tr class="sum"><td>合計（${doc.lines.length}件）</td><td class="n">${yen(t.usageTotal)}</td><td class="n">${yen(t.billedTotal)}</td></tr>
</table>
<div class="note">
  ご利用総額 ${yen(t.usageTotal)} のうち、お支払い済み・別途精算 ${yen(t.paidTotal)}、今回のご請求 ${yen(t.billedTotal)}。<br>
  金額はご予約時の料金です（宿泊料金は税込・入湯税は別）。ご宿泊時の追加のご利用は含みません。
</div>
</section>`;
}

// 書類名（ご請求額が 0 円ならご利用明細書だけ）
export const invoiceDocName = (doc: Pick<InvoiceDocument, 'totals'>) =>
  doc.totals.billedTotal > 0 ? `${DOC_INVOICE}・${DOC_STATEMENT}` : DOC_STATEMENT;

// 予定請求書の書類名（例: ご請求書（予定）／ご請求 0 円なら ご利用明細書（予定））
export const draftInvoiceDocName = (doc: Pick<InvoiceDocument, 'totals'>) =>
  (doc.totals.billedTotal > 0 ? DOC_INVOICE : DOC_STATEMENT) + DRAFT_SUFFIX;

// 紙面の HTML（1ファイル完結）。ご請求額が 0 円ならご利用明細書だけ。opts.draft で予定請求書。
export function renderInvoiceHtml(doc: InvoiceDocument, opts: RenderInvoiceOptions = {}): string {
  const draft = opts.draft === true;
  const pages = (doc.totals.billedTotal > 0 ? invoicePage(doc, draft) : '') + statementPage(doc, draft);
  const title = draft ? `${draftInvoiceDocName(doc)} ${doc.recipient.name} ${periodLabel(doc.period)}` : `${invoiceDocName(doc)} ${doc.invoiceNo}`;
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;600;700&display=block" rel="stylesheet">
<style>${STYLE}${draft ? DRAFT_STYLE : ''}</style></head><body>${draft ? '<div class="draft-wm" aria-hidden="true">予定</div>' : ''}${pages}</body></html>`;
}

// ダウンロード・添付のファイル名（例: ご請求書・ご利用明細書_PI-202610-00001_2026年10月.pdf）
export const invoiceFileName = (doc: Pick<InvoiceDocument, 'invoiceNo' | 'period' | 'totals'>, ext: 'pdf' | 'html') =>
  `${invoiceDocName(doc)}_${doc.invoiceNo}_${periodLabel(doc.period)}.${ext}`;

// 予定請求書のファイル名（例: ご請求書（予定）_○○トラベル_2026年10月.pdf）。ファイル名に使えない文字は全角に置き換える
const safeFilePart = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]/g,(c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, 60);
export const draftInvoiceFileName = (doc: Pick<InvoiceDocument, 'period' | 'totals'>, partnerName: string, ext: 'pdf' | 'html') =>
  `${draftInvoiceDocName(doc)}_${safeFilePart(partnerName) || '取引先'}_${periodLabel(doc.period)}.${ext}`;
