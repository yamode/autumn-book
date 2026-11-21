import { describe, expect, it } from 'vitest';
import { bookingReceiptAvailable, bookingReceiptFigures, includedTax, stayLabelJa } from './booking-receipt';
import { renderInroomReceiptHtml } from './inroom-receipt';

const pay = {
	hold_id: 'abcdef12-0000-0000-0000-000000000000',
	status: 'paid',
	amount: 22300,
	bath_tax_amount: 300,
	refunded_amount: 0,
	paid_at: '2026-11-20T16:30:00Z'
};

describe('会員マイページの予約の領収書', () => {
	it('決済済みで差引額が残るときだけ出す', () => {
		expect(bookingReceiptAvailable(pay)).toBe(true);
		expect(bookingReceiptAvailable({ ...pay, refunded_amount: 22300 })).toBe(false);
		expect(bookingReceiptAvailable({ ...pay, status: 'scheduled' })).toBe(false);
		expect(bookingReceiptAvailable({ ...pay, status: 'pending' })).toBe(false);
		expect(bookingReceiptAvailable({ ...pay, paid_at: null })).toBe(false);
		expect(bookingReceiptAvailable(null)).toBe(false);
	});
	it('番号は B＋決済日（JST）＋台帳IDの先頭8桁で、客室案内（R）と区別する', () => {
		expect(bookingReceiptFigures(pay, false)?.receiptNo).toBe('B20261121-ABCDEF12');
	});
	it('返金が無ければ 10%対象（内消費税・切り捨て）と入湯税（不課税）の内訳を出す', () => {
		const f = bookingReceiptFigures(pay, false)!;
		expect(f.amount).toBe(22300);
		expect(f.proviso).toBe('宿泊料金として');
		expect(f.breakdown).toEqual([
			{ label: '10%対象', amount: 22000, tax: 2000 },
			{ label: '入湯税（不課税）', amount: 300 }
		]);
		expect(includedTax(10001)).toBe(909);
	});
	it('一部返金があれば差引額と返金済みの旨だけ出し、内訳は出さない', () => {
		const f = bookingReceiptFigures({ ...pay, refunded_amount: 11150 }, false)!;
		expect(f.amount).toBe(11150);
		expect(f.breakdown).toEqual([]);
		expect(f.notes[0]).toContain('¥11,150 はカードへ返金済み');
	});
	it('取消済みで差引額が残れば、但し書きは「キャンセル料として」', () => {
		const f = bookingReceiptFigures({ ...pay, refunded_amount: 17840 }, true)!;
		expect(f.proviso).toBe('キャンセル料として');
		expect(f.amount).toBe(4460);
	});
	it('ご宿泊の日付は年をまたぐときだけ終わりにも年を付ける', () => {
		expect(stayLabelJa('2026-12-01', '2026-12-02')).toBe('2026年12月1日 〜 12月2日');
		expect(stayLabelJa('2026-12-31', '2027-01-01')).toBe('2026年12月31日 〜 2027年1月1日');
		expect(stayLabelJa(null, null)).toBeNull();
	});
	it('紙面に支払方法・予約番号・内訳が出て、客室案内の既定の文言は変わらない', () => {
		const base = { receiptNo: 'B1', addressee: '山田 太郎', amount: 22300, paidAt: pay.paid_at, proviso: '宿泊料金として', facilityName: '山人-yamado-', room: null, issuerName: '株式会社山人', issuerAddress: '住所', issuerTel: '0197', registrationNumber: 'T1' };
		const html = renderInroomReceiptHtml({ ...base, paymentMethod: 'クレジットカード（ご予約時のオンライン決済）', bookingCode: 'AB123', breakdown: bookingReceiptFigures(pay, false)!.breakdown });
		expect(html).toContain('ご予約時のオンライン決済');
		expect(html).toContain('AB123');
		expect(html).toContain('10%対象　¥22,000（内消費税 ¥2,000）');
		expect(renderInroomReceiptHtml(base)).toContain('客室案内でのオンライン決済');
	});
});
