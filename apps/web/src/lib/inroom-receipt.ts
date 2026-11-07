// 客室案内のオンライン決済の領収書（2026-11-07）。画面・サーバ共通の純関数。
// お客様が客室案内（/r/bill）で払った1回の決済につき1枚。紙面は1ファイル完結の HTML（CSS インライン・画像なし）で、
// PDF 化は renderHtmlPdf（Cloudflare Browser Rendering）に渡す。
// クレジットカード決済の領収書は収入印紙が不要（金銭の受取ではなくカード会社への債権）なので、その旨を添える。

export type InroomReceiptDoc = {
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

/** 領収書の紙面（A4縦・1枚）。 */
export function renderInroomReceiptHtml(doc: InroomReceiptDoc): string {
	const addressee = doc.addressee ? `${esc(doc.addressee)}　様` : '上　様';
	return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>領収書 ${esc(doc.receiptNo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=block" rel="stylesheet">
<style>
@page { size: A4; margin: 16mm; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Noto Sans JP', 'Noto Sans CJK JP', sans-serif; font-size: 10.5pt; color: #1c1917; line-height: 1.6; }
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
</body></html>`;
}
