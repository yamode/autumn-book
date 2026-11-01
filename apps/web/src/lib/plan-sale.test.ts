// プランの販売状態の判定（DB の book.plan_on_sale と同じ）。`pnpm --filter @autumn-book/web test`
import { describe, expect, it } from 'vitest';
import { planSaleFromForm, planSaleState, todayJstDate } from './plan-sale';

describe('planSaleState', () => {
	const today = '2026-12-01';
	it('スイッチが停止中なら期間に関係なく off', () => {
		expect(planSaleState(false, null, null, today)).toBe('off');
		expect(planSaleState(false, '2026-11-01', '2026-12-31', today)).toBe('off');
	});
	it('期間の前後と当日', () => {
		expect(planSaleState(true, '2026-12-02', null, today)).toBe('before');
		expect(planSaleState(true, null, '2026-11-30', today)).toBe('ended');
		expect(planSaleState(true, '2026-12-01', '2026-12-01', today)).toBe('on');
		expect(planSaleState(true, null, null, today)).toBe('on');
	});
});

describe('todayJstDate', () => {
	it('日本時間で日付が変わる（UTC 15:00 が翌日の 0:00）', () => {
		expect(todayJstDate(new Date('2026-11-30T14:59:00Z'))).toBe('2026-11-30');
		expect(todayJstDate(new Date('2026-11-30T15:00:00Z'))).toBe('2026-12-01');
	});
});

describe('planSaleFromForm', () => {
	const form = (o: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(o)) f.set(k, v);
		return f;
	};
	it('空欄は制限なし・チェックで販売中', () => {
		expect(planSaleFromForm(form({ on_sale: 'on' }))).toEqual({ onSale: true, bookingStart: null, bookingEnd: null });
		expect(planSaleFromForm(form({}))).toEqual({ onSale: false, bookingStart: null, bookingEnd: null });
	});
	it('開始日が終了日より後・不正な日付は理由を返す', () => {
		expect(planSaleFromForm(form({ booking_start: '2026-12-10', booking_end: '2026-12-01' }))).toHaveProperty('error');
		expect(planSaleFromForm(form({ booking_start: '2026/12/10' }))).toHaveProperty('error');
	});
});
