import { describe, expect, it } from 'vitest';
import { buildInroomPaidMail } from './inroom-payment-notify';

// 施設の共有ID への決済のお知らせ（2026-10-17）
describe('決済のお知らせメール', () => {
	const row = {
		id: 'p1',
		facility_id: 'f',
		amount: 1700,
		room_code: '201',
		guest_name: '山人 太郎',
		payment_intent_id: 'pi_123',
		paid_at: '2026-10-17T05:46:00Z'
	};
	it('件名に部屋と金額、本文にお客様・決済番号・PMS に入れたこと', () => {
		const m = buildInroomPaidMail(row, 'paid', '山人 -yamado-');
		expect(m.subject).toBe('【客室案内】オンライン決済がありました（201・¥1,700）');
		expect(m.text).toContain('お客様: 山人 太郎 様');
		expect(m.text).toContain('pi_123');
		expect(m.text).toContain('客室内オンライン決済');
	});
	it('テスト決済は件名に【テスト】、PMS に入れていない旨', () => {
		const m = buildInroomPaidMail(row, 'test', '山人 -yamado-');
		expect(m.subject.startsWith('【テスト】')).toBe(true);
		expect(m.text).toContain('PMS には入れていません');
	});
	it('HTML に入る文字はエスケープする', () => {
		const m = buildInroomPaidMail({ ...row, guest_name: '<b>x</b>' }, 'paid', '');
		expect(m.html).not.toContain('<b>x</b>');
	});
});
