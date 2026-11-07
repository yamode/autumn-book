import { describe, expect, it } from 'vitest';
import { foldBathTax, inroomReceiptNo, normalizeAddressee, renderInroomReceiptHtml, receiptDateJa } from './inroom-receipt';

describe('客室案内の領収書', () => {
	it('領収書番号は決済ごとに固定（JST の日付＋台帳IDの先頭8桁）', () => {
		expect(inroomReceiptNo('abcdef12-0000-0000-0000-000000000000', '2026-11-06T16:30:00Z')).toBe('R20261107-ABCDEF12');
	});
	it('宛名は改行を除き、末尾の「様」は外す', () => {
		expect(normalizeAddressee(' 山田\n太郎 様 ')).toBe('山田 太郎');
		expect(normalizeAddressee(null)).toBe('');
	});
	it('日付は和暦でなく西暦の日本語表記', () => {
		expect(receiptDateJa('2026-11-06T16:30:00Z')).toBe('2026年11月7日');
	});
	it('紙面は宛名・金額をエスケープして出し、宛名が空なら「上様」', () => {
		const base = { receiptNo: 'R1', amount: 12345, paidAt: '2026-11-07T01:00:00Z', proviso: '宿泊料金として', facilityName: '山人-oga-', room: null, issuerName: '株式会社山人', issuerAddress: '住所', issuerTel: '0185', registrationNumber: 'T1' };
		expect(renderInroomReceiptHtml({ ...base, addressee: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
		expect(renderInroomReceiptHtml({ ...base, addressee: '' })).toContain('上　様');
		expect(renderInroomReceiptHtml({ ...base, addressee: '' })).toContain('¥12,345');
	});
});

describe('領収書 2ページ目のご利用明細', () => {
	const base = { receiptNo: 'R1', addressee: '山田 太郎', amount: 12000, paidAt: '2026-11-07T01:00:00Z', proviso: '宿泊料金として', facilityName: '山人-yamado-', room: '雪椿', issuerName: '株式会社山人', issuerAddress: '住所', issuerTel: '0197', registrationNumber: 'T1' };
	it('入湯税の行は1行に畳み、単価が同じなら単価と延べ人泊を出す', () => {
		const r = foldBathTax([
			{ name: '宿泊料', unitPrice: 10000, quantity: 1, amount: 10000 },
			{ name: '入湯税', unitPrice: 150, quantity: 2, amount: 300 },
			{ name: '入湯税', unitPrice: 150, quantity: 2, amount: 300 }
		]);
		expect(r.items).toHaveLength(1);
		expect(r.bathTax).toEqual({ unitPrice: 150, quantity: 4, amount: 600 });
		expect(foldBathTax([{ name: '宿泊料', unitPrice: 1, quantity: 1, amount: 1 }]).bathTax).toBeNull();
	});
	it('明細があれば2ページ目を出し、無ければ出さない', () => {
		const st = { stayFrom: '2026-11-07', stayTo: '2026-11-08', bills: [{ billNo: 3, items: [{ date: '2026-11-07', name: '宿泊料', unitPrice: 10000, quantity: 1, amount: 10000 }], bathTax: { unitPrice: 150, quantity: 2, amount: 300 }, total: 10300, payments: [{ date: '2026-11-07', method: '客室内オンライン決済', amount: 10300 }] }] };
		const withSt = renderInroomReceiptHtml({ ...base, statement: st });
		expect(withSt).toContain('ご利用明細書');
		expect(withSt).toContain('10,300');
		expect(withSt).toContain('150円 × 延べ2人泊');
		expect(withSt).toContain('<td class="d">11/7</td>');
		expect(withSt).toContain('2026年11月7日 〜 2026年11月8日');
		expect(renderInroomReceiptHtml({ ...base, statement: null })).not.toContain('ご利用明細書');
	});
	it('明朝体を指定している', () => {
		expect(renderInroomReceiptHtml(base)).toContain('Noto Serif JP');
	});
});
