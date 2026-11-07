// 客室案内のオンライン決済の領収書（2026-11-07）。画面・サーバ共通の純関数。
// お客様が客室案内（/r/bill）で払った1回の決済につき1枚。紙面は1ファイル完結の HTML（CSS インライン・画像なし）で、
// PDF 化は renderHtmlPdf（Cloudflare Browser Rendering）に渡す。
// クレジットカード決済の領収書は収入印紙が不要（金銭の受取ではなくカード会社への債権）なので、その旨を添える。

/** 2ページ目のご利用明細（請求書ごと）。入湯税は PMS の請求書と同じく1行に畳む */
export type ReceiptStatementBill = {
	billNo: number | null;
	items: Array<{ date: string | null; name: string; unitPrice: number; quantity: number; amount: number }>;
	/** 入湯税（明細の「入湯税」行をまとめたもの）。無ければ null */
	bathTax: { unitPrice: number | null; quantity: number; amount: number } | null;
	/** ご利用総額（明細＋入湯税） */
	total: number;
	/** お支払い済みの内訳（今回のお支払いを含む） */
	payments: Array<{ date: string | null; method: string; amount: number }>;
};
export type ReceiptStatement = {
	stayFrom: string | null;
	stayTo: string | null;
	bills: ReceiptStatementBill[];
};

export type InroomReceiptDoc = {
	/** 2ページ目のご利用明細。引けなかったときは省く（1ページ目だけ出す） */
	statement?: ReceiptStatement | null;
	/** 領収書番号（決済ごとに固定。R+決済日+台帳ID先頭8桁） */
	receiptNo: string;
	/** 宛名（お客様が入力・空なら滞在コードのお名前・それも無ければ「上様」） */
	addressee: string;
	amount: number;
	/** 領収日（決済日時・ISO） */
	paidAt: string;
	/** 但書 */
	proviso: string;
	facilityName: string;
	room: string | null;
	issuerName: string;
	issuerAddress: string;
	issuerTel: string;
	registrationNumber: string;
};

export const RECEIPT_PROVISO = '宿泊料金として';
export const MAX_ADDRESSEE_LENGTH = 60;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

/** 宛名の入力を整える（改行・制御文字を除き長さを切る。末尾の「様」「御中」は紙面側で付けるので外す） */
export function normalizeAddressee(raw: string | null | undefined): string {
	return (raw ?? '')
		.replace(/[\u0000-\u001f\u007f]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\s*(様|御中)$/u, '')
		.trim()
		.slice(0, MAX_ADDRESSEE_LENGTH);
}

const jstParts = (iso: string) => {
	const d = new Date(iso);
	const f = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
	const g = (t: string) => f.find((p) => p.type === t)?.value ?? '';
	return { y: g('year'), m: g('month'), d: g('day') };
};

/** 領収書番号。決済ごとに必ず同じ値（再発行しても番号が変わらない） */
export function inroomReceiptNo(paymentId: string, paidAtIso: string): string {
	const { y, m, d } = jstParts(paidAtIso);
	return `R${y}${m}${d}-${paymentId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

/** 「2026年11月7日」 */
export function receiptDateJa(iso: string): string {
	const { y, m, d } = jstParts(iso);
	return `${y}年${Number(m)}月${Number(d)}日`;
}

export function receiptFileName(doc: Pick<InroomReceiptDoc, 'receiptNo'>): string {
	return `領収書_${doc.receiptNo}.pdf`;
}

/** 「11/7」 */
const md = (ymd: string | null) => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}` : '');
const ymdJa = (ymd: string | null) => (ymd && /^\d{4}-\d{2}-\d{2}/.test(ymd) ? `${ymd.slice(0, 4)}年${Number(ymd.slice(5, 7))}月${Number(ymd.slice(8, 10))}日` : '');

/** 明細の「入湯税」行を1行にまとめる（PMS の請求書と同じ見せ方）。単価は全行同じときだけ出す */
export function foldBathTax<T extends { name: string; unitPrice: number; quantity: number; amount: number }>(
	items: T[]
): { items: T[]; bathTax: ReceiptStatementBill['bathTax'] } {
	const tax = items.filter((i) => i.name.includes('入湯税'));
	if (!tax.length) return { items, bathTax: null };
	const units = new Set(tax.map((i) => i.unitPrice));
	return {
		items: items.filter((i) => !i.name.includes('入湯税')),
		bathTax: { unitPrice: units.size === 1 ? tax[0].unitPrice : null, quantity: tax.reduce((a, i) => a + i.quantity, 0), amount: tax.reduce((a, i) => a + i.amount, 0) }
	};
}

function statementHtml(st: ReceiptStatement, doc: InroomReceiptDoc): string {
	const num = (n: number) => Math.round(n).toLocaleString('ja-JP');
	const stay = st.stayFrom ? `${ymdJa(st.stayFrom)}${st.stayTo && st.stayTo !== st.stayFrom ? ` 〜 ${ymdJa(st.stayTo)}` : ''}` : '';
	const multi = st.bills.length > 1;
	const bills = st.bills
		.map((b) => {
			const rows = b.items
				.map((i) => `<tr><td class="d">${esc(md(i.date))}</td><td>${esc(i.name)}</td><td class="n">${num(i.unitPrice)}</td><td class="n">${i.quantity}</td><td class="n">${num(i.amount)}</td></tr>`)
				.join('');
			const bath = b.bathTax
				? `<tr><td class="d"></td><td>入湯税${b.bathTax.unitPrice != null ? `<span class="sub">　${num(b.bathTax.unitPrice)}円 × 延べ${b.bathTax.quantity}人泊</span>` : ''}</td><td class="n"></td><td class="n"></td><td class="n">${num(b.bathTax.amount)}</td></tr>`
				: '';
			const pays = b.payments
				.map((p) => `<tr><td class="d">${esc(md(p.date))}</td><td colspan="3">${esc(p.method || 'お支払い')}</td><td class="n">${num(p.amount)}</td></tr>`)
				.join('');
			const paid = b.payments.reduce((a, p) => a + p.amount, 0);
			return `${multi ? `<p class="bh">請求書${b.billNo != null ? ` No.${b.billNo}` : ''}</p>` : ''}
<table class="st"><thead><tr><th class="d">日付</th><th>ご利用内容</th><th class="n">単価</th><th class="n">数量</th><th class="n">金額</th></tr></thead>
<tbody>${rows}${bath}<tr class="sum"><td class="d"></td><td>ご利用総額</td><td></td><td></td><td class="n">${num(b.total)}</td></tr></tbody></table>
${pays ? `<table class="st pay"><thead><tr><th class="d">日付</th><th colspan="3">お支払い</th><th class="n">金額</th></tr></thead><tbody>${pays}<tr class="sum"><td class="d"></td><td colspan="3">お支払い済み合計</td><td class="n">${num(paid)}</td></tr></tbody></table>` : ''}`;
		})
		.join('\n');
	return `<section class="stmt">
<div class="top"><h1 class="h2">ご利用明細書</h1><div class="meta">領収書番号　${esc(doc.receiptNo)}<br>${doc.room ? `お部屋　${esc(doc.room)}<br>` : ''}${stay ? `ご宿泊　${esc(stay)}` : ''}</div></div>
<div class="to2">${doc.addressee ? `${esc(doc.addressee)}　様` : '上　様'}</div>
${bills}
<div class="note">金額は税込です。上記は領収書（${esc(doc.receiptNo)}）に係るご利用明細です。</div>
</section>`;
}

/** 領収書の紙面（A4縦。1ページ目＝領収書、2ページ目＝ご利用明細）。 */
export function renderInroomReceiptHtml(doc: InroomReceiptDoc): string {
	const addressee = doc.addressee ? `${esc(doc.addressee)}　様` : '上　様';
	return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>領収書 ${esc(doc.receiptNo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400;700&display=block" rel="stylesheet">
<style>
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Noto Serif JP', '游明朝', 'Yu Mincho', YuMincho, 'Hiragino Mincho ProN', 'ヒラギノ明朝 ProN', 'MS 明朝', 'MS Mincho', 'Noto Serif CJK JP', serif; font-size: 10.5pt; color: #1c1917; line-height: 1.6; }
.top { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #1c1917; padding-bottom: 3mm; }
h1 { margin: 0; font-size: 24pt; letter-spacing: 0.6em; }
.meta { text-align: right; font-size: 9.5pt; color: #44403c; }
.to { margin-top: 12mm; font-size: 15pt; border-bottom: 1px solid #1c1917; padding-bottom: 1mm; display: inline-block; min-width: 100mm; }
.amount { margin-top: 10mm; display: flex; align-items: baseline; gap: 6mm; background: #f5f5f4; padding: 5mm 6mm; }
.amount .label { font-size: 11pt; }
.amount .value { font-size: 26pt; font-weight: 700; font-variant-numeric: tabular-nums; }
.amount .tax { font-size: 9.5pt; color: #57534e; }
dl { margin: 8mm 0 0; display: grid; grid-template-columns: 30mm 1fr; row-gap: 2.5mm; }
dt { color: #78716c; }
dd { margin: 0; }
.issuer { margin-top: 16mm; text-align: right; font-size: 10pt; line-height: 1.7; }
.issuer b { font-size: 12pt; }
.stmt { break-before: page; page-break-before: always; }
.stmt .top { border-bottom: 2px solid #1c1917; padding-bottom: 3mm; }
.h2 { margin: 0; font-size: 20pt; letter-spacing: 0.3em; }
.to2 { margin: 6mm 0 5mm; font-size: 12pt; }
.bh { margin: 6mm 0 1.5mm; font-weight: 700; }
table.st { width: 100%; border-collapse: collapse; margin-top: 1mm; font-size: 9.5pt; }
table.st th, table.st td { border: 1px solid #a8a29e; padding: 1.2mm 2mm; text-align: left; line-height: 1.5; }
table.st th { background: #f5f5f4; font-weight: 700; }
table.st .d { width: 14mm; text-align: center; }
table.st .n { text-align: right; font-variant-numeric: tabular-nums; width: 22mm; }
table.st tr { break-inside: avoid; page-break-inside: avoid; }
table.st tr.sum td { font-weight: 700; background: #fafaf9; }
table.st.pay { margin-top: 5mm; }
.sub { font-size: 8.5pt; color: #57534e; }
.note { margin-top: 14mm; font-size: 8.5pt; color: #57534e; border-top: 1px solid #d6d3d1; padding-top: 3mm; }
</style></head><body>
<div class="top"><h1>領収書</h1><div class="meta">領収書番号　${esc(doc.receiptNo)}<br>発行日　${esc(receiptDateJa(doc.paidAt))}</div></div>
<div class="to">${addressee}</div>
<div class="amount"><span class="label">領収金額</span><span class="value">${esc(yen(doc.amount))}</span><span class="tax">（税込）</span></div>
<dl>
<dt>但し書き</dt><dd>${esc(doc.proviso)}</dd>
<dt>領収日</dt><dd>${esc(receiptDateJa(doc.paidAt))}</dd>
<dt>お支払い方法</dt><dd>クレジットカード（客室案内でのオンライン決済）</dd>
${doc.room ? `<dt>お部屋</dt><dd>${esc(doc.room)}</dd>` : ''}
</dl>
<div class="issuer">
<b>${esc(doc.issuerName)}</b><br>
${doc.facilityName ? `${esc(doc.facilityName)}<br>` : ''}
${esc(doc.issuerAddress)}<br>
${doc.issuerTel ? `TEL ${esc(doc.issuerTel)}<br>` : ''}
${doc.registrationNumber ? `登録番号 ${esc(doc.registrationNumber)}` : ''}
</div>
<div class="note">上記金額を、クレジットカードのオンライン決済にて確かに領収いたしました。クレジットカード決済のため、収入印紙は不要です。</div>
${doc.statement && doc.statement.bills.length ? statementHtml(doc.statement, doc) : ''}
</body></html>`;
}
