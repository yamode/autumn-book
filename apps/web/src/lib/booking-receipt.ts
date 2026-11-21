// 会員マイページの予約の領収書（2026-11-21）。公式サイトでカードの事前決済（予約時・チェックアウト日）を済ませた予約に、
// 山人名義の領収書を出す。紙面は客室案内の領収書（lib/inroom-receipt.ts）をそのまま使い、ここでは「出せるか」と
// 「金額・内訳・但し書き」を決める純関数だけを置く（サーバ側の組み立ては lib/server/booking-receipt.ts）。
//
// 出す条件: 決済が済んでいる（status = paid）・差引額（支払額 − 返金済み額）が 1 円以上。
//   全額返金・未決済・決済失敗・チェックアウト日の請求待ちは出さない。
// 内訳: 返金が無ければ「10%対象（内消費税）」と「入湯税（不課税）」を出す（適格簡易請求書の記載事項）。
//   一部返金があると返金分の税区分が分からないので、差引額と返金済みの旨だけを出す。
// 取消済みで差引額が残る（キャンセル料・返金しない割引分など）ときは、但し書きを「キャンセル料として」にする。
// 番号は台帳（book.direct_payments.hold_id）から毎回同じ値を作る（B+決済日+先頭8桁）ので、何度落としても同じ領収書になる。
import { inroomReceiptNo, RECEIPT_PROVISO, type ReceiptBreakdownLine } from './inroom-receipt';

export const BOOKING_RECEIPT_PREFIX = 'B';
export const BOOKING_PAYMENT_METHOD = 'クレジットカード（ご予約時のオンライン決済）';
export const CANCEL_PROVISO = 'キャンセル料として';
/** 宿泊料金の消費税率（10%・税込価格から内税を出す） */
const TAX_RATE = 10;

export type BookingReceiptPayment = {
	hold_id: string;
	status: string;
	amount: number;
	bath_tax_amount: number;
	refunded_amount: number;
	paid_at: string | null;
};

export type BookingReceiptFigures = {
	receiptNo: string;
	amount: number;
	paidAt: string;
	proviso: string;
	breakdown: ReceiptBreakdownLine[];
	notes: string[];
};

/** 領収書を出せる決済か（決済済み・差引額が残っている） */
export function bookingReceiptAvailable(pay: Pick<BookingReceiptPayment, 'status' | 'amount' | 'refunded_amount' | 'paid_at'> | null | undefined): boolean {
	if (!pay || pay.status !== 'paid' || !pay.paid_at) return false;
	return pay.amount - Math.max(0, pay.refunded_amount ?? 0) > 0;
}

/** 税込額に含まれる消費税（端数切り捨て） */
export const includedTax = (gross: number, rate = TAX_RATE) => Math.floor((Math.max(0, gross) * rate) / (100 + rate));

/** 領収書の金額・内訳・但し書き。出せなければ null */
export function bookingReceiptFigures(pay: BookingReceiptPayment | null | undefined, cancelled: boolean): BookingReceiptFigures | null {
	if (!pay || !bookingReceiptAvailable(pay)) return null;
	const refunded = Math.max(0, pay.refunded_amount ?? 0);
	const amount = pay.amount - refunded;
	const paidAt = pay.paid_at as string;
	const breakdown: ReceiptBreakdownLine[] = [];
	const notes: string[] = [];
	if (refunded > 0) {
		notes.push(`お支払い額 ${yen(pay.amount)} のうち ${yen(refunded)} はカードへ返金済みです。上記は返金後の金額です。`);
	} else if (!cancelled) {
		const bathTax = Math.min(Math.max(0, pay.bath_tax_amount ?? 0), amount);
		const lodging = amount - bathTax;
		if (lodging > 0) breakdown.push({ label: `${TAX_RATE}%対象`, amount: lodging, tax: includedTax(lodging) });
		if (bathTax > 0) breakdown.push({ label: '入湯税（不課税）', amount: bathTax });
	}
	return {
		receiptNo: inroomReceiptNo(pay.hold_id, paidAt, BOOKING_RECEIPT_PREFIX),
		amount,
		paidAt,
		proviso: cancelled ? CANCEL_PROVISO : RECEIPT_PROVISO,
		breakdown,
		notes
	};
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;

/** 「2026年12月1日 〜 12月2日」（年が変われば年も出す） */
export function stayLabelJa(checkin: string | null | undefined, checkout: string | null | undefined): string | null {
	const ok = (v: string | null | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}/.test(v);
	if (!ok(checkin)) return null;
	const ja = (v: string, withYear: boolean) => `${withYear ? `${v.slice(0, 4)}年` : ''}${Number(v.slice(5, 7))}月${Number(v.slice(8, 10))}日`;
	if (!ok(checkout) || checkout === checkin) return ja(checkin, true);
	return `${ja(checkin, true)} 〜 ${ja(checkout, checkout.slice(0, 4) !== checkin.slice(0, 4))}`;
}
