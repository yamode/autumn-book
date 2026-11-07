import { describe, expect, it } from 'vitest';
import { inroomReceiptNo, normalizeAddressee, renderInroomReceiptHtml, receiptDateJa } from './inroom-receipt';

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
