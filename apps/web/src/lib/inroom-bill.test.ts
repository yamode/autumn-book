import { describe, expect, it } from 'vitest';
import {
	anyBillFlag,
	billPayErrorKind,
	demoStayBill,
	EMPTY_NOTE,
	frontNoteFor,
	NO_FLAGS,
	normalizeStayBill,
	resolveBillFlags
} from './inroom-bill';

describe('精算案内の出し分け', () => {
	it('上書きが null なら施設の既定、値があればそれを使う', () => {
		const d = { items: true, front: false, online: true };
		expect(resolveBillFlags(d, null)).toEqual(d);
		expect(resolveBillFlags(d, { items: null, front: true, online: false })).toEqual({ items: true, front: true, online: false });
	});
	it('どれか1つでも出すならカードを出す', () => {
		expect(anyBillFlag(NO_FLAGS)).toBe(false);
		expect(anyBillFlag({ ...NO_FLAGS, front: true })).toBe(true);
	});
});

describe('フロント案内文の言語', () => {
	it('英語・繁体字が空なら日本語', () => {
		const note = { ja: '前日までにフロントへ', en: '', zh: '請至櫃檯' };
		expect(frontNoteFor(note, 'en')).toBe('前日までにフロントへ');
		expect(frontNoteFor(note, 'zh-TW')).toBe('請至櫃檯');
		expect(frontNoteFor(note, 'ja')).toBe('前日までにフロントへ');
	});
});

describe('RPC stay_bill の整形', () => {
	it('明細・入金・残額を読む', () => {
		const v = normalizeStayBill({
			ok: true,
			show_items: true,
			show_front: false,
			show_online: true,
			front_note: { ja: 'a', en: '', zh: '' },
			due_total: 1300,
			paid_online: 0,
			bills: [
				{
					id: 'b1',
					bill_no: 12,
					items_total: 54100,
					paid_total: 52800,
					due: 1300,
					items: [{ date: '2026-10-17', name: '生ビール', quantity: 2, unit_price: 650, amount: 1300 }, null],
					payments: [{ date: '2026-10-01', method: 'オンライン事前決済', amount: 52800, online: false }]
				},
				{ bad: true }
			]
		});
		expect(v?.flags).toEqual({ items: true, front: false, online: true });
		expect(v?.bills).toHaveLength(1);
		expect(v?.bills[0].items).toEqual([{ date: '2026-10-17', name: '生ビール', quantity: 2, unitPrice: 650, amount: 1300 }]);
		expect(v?.dueTotal).toBe(1300);
	});
	it('ok でなければ null・負の残額は 0', () => {
		expect(normalizeStayBill({ ok: false })).toBeNull();
		expect(normalizeStayBill(null)).toBeNull();
		expect(normalizeStayBill({ ok: true, due_total: -5 })?.dueTotal).toBe(0);
	});
});

describe('見本の明細', () => {
	it('明細の合計 − 入金 ＝ 残額', () => {
		const v = demoStayBill({ items: true, front: true, online: true }, EMPTY_NOTE);
		const b = v.bills[0];
		expect(b.itemsTotal - b.paidTotal).toBe(v.dueTotal);
		expect(v.isDemo).toBe(true);
		expect(v.dueTotal).toBeGreaterThan(0);
	});
});

describe('決済のエラーの種類', () => {
	it('DB の理由をお客様向けの種類に寄せる', () => {
		expect(billPayErrorKind(new Error('amount_changed'))).toBe('changed');
		expect(billPayErrorKind(new Error('nothing_due'))).toBe('nothing');
		expect(billPayErrorKind(new Error('online_disabled'))).toBe('unavailable');
		expect(billPayErrorKind(new Error('boom'))).toBe('generic');
	});
});

describe('プレビューの精算の見本（Cookie ab_preview_bill）', () => {
	it('値 → 出し分け。無い・空・読めないなら null（設定どおり）', async () => {
		const { parsePreviewBillFlags, previewBillCookieValue } = await import('./inroom-bill');
		expect(parsePreviewBillFlags('items,front,online')).toEqual({ items: true, front: true, online: true });
		expect(parsePreviewBillFlags('front')).toEqual({ items: false, front: true, online: false });
		expect(parsePreviewBillFlags('none')).toEqual({ items: false, front: false, online: false });
		expect(parsePreviewBillFlags(undefined)).toBeNull();
		expect(parsePreviewBillFlags('xxx')).toBeNull();
		expect(previewBillCookieValue({ items: true, front: false, online: true })).toBe('items,online');
		expect(previewBillCookieValue({ items: false, front: false, online: false })).toBe('none');
	});
});

describe('連結予約の請求書の並び（泊まった日の順）', () => {
	it('明細のいちばん早い日付で並べ、日付の無いものは後ろ', async () => {
		const { billStayDate, sortBillsByStay } = await import('./inroom-bill');
		const it_ = (date: string | null) => ({ date, name: 'x', quantity: 1, unitPrice: 1, amount: 1 });
		const cover = { id: 'cover', items: [it_('2026-10-21'), it_('2026-10-21')] };
		const a = { id: 'a', items: [it_('2026-10-16'), it_('2026-10-17')] };
		const b = { id: 'b', items: [it_('2026-10-17')] };
		const none = { id: 'none', items: [it_(null)] };
		expect(billStayDate(a)).toBe('2026-10-16');
		expect(billStayDate(none)).toBeNull();
		expect(sortBillsByStay([cover, none, b, a]).map((x) => x.id)).toEqual(['a', 'b', 'cover', 'none']);
	});
});

describe('請求内容チェックが済んだ請求書だけ公開（2026-10-17）', () => {
	it('published と泊まった日を読み、公開済みの枚数を数える', async () => {
		const { normalizeStayBill, billStayDate } = await import('./inroom-bill');
		const v = normalizeStayBill({
			ok: true,
			due_total: 1300,
			published_count: 1,
			bills: [
				{ id: 'a', published: true, due: 1300, items: [{ date: '2026-10-16', name: 'x', quantity: 1, unit_price: 1300, amount: 1300 }], payments: [] },
				{ id: 'b', published: false, stay_date: '2026-10-17', items: [], payments: [] }
			]
		});
		expect(v?.publishedCount).toBe(1);
		expect(v?.bills.map((b) => b.published)).toEqual([true, false]);
		expect(billStayDate(v!.bills[1])).toBe('2026-10-17');
	});
	it('published が無い（古い DB 関数）なら公開扱い', async () => {
		const { normalizeStayBill } = await import('./inroom-bill');
		const v = normalizeStayBill({ ok: true, bills: [{ id: 'a', items: [], payments: [] }] });
		expect(v?.bills[0].published).toBe(true);
		expect(v?.publishedCount).toBe(1);
	});
});

describe('請求書の見出し・宛名・選んで払う（2026-10-18）', () => {
	const it_ = (date: string | null) => ({ date, name: 'x', quantity: 1, unitPrice: 1, amount: 1 });
	it('明細の日付の範囲から泊数とご出発日を出す（連泊を1泊に見せない）', async () => {
		const { billStayRange } = await import('./inroom-bill');
		expect(billStayRange({ items: [it_('2026-10-16'), it_('2026-10-17')] })).toEqual({ from: '2026-10-16', checkout: '2026-10-18', nights: 2 });
		expect(billStayRange({ items: [it_('2026-10-16')] })).toEqual({ from: '2026-10-16', checkout: '2026-10-17', nights: 1 });
		// 未公開の請求書は明細が無く、DB が返した範囲を使う
		expect(billStayRange({ items: [], stayDate: '2026-10-19', stayDateTo: '2026-10-20' })?.nights).toBe(2);
		expect(billStayRange({ items: [it_(null)] })).toBeNull();
	});
	it('宛名はお客様名と違うときだけ（空白・様は無視）', async () => {
		const { billAddressee } = await import('./inroom-bill');
		expect(billAddressee({ name: '株式会社シンキ製作所' }, '塩津 広之')).toBe('株式会社シンキ製作所');
		expect(billAddressee({ name: '塩津広之 様' }, '塩津 広之')).toBeNull();
		expect(billAddressee({ name: '' }, '塩津 広之')).toBeNull();
	});
	it('払える請求書は公開済みで残額があるものだけ・泊まった日の順', async () => {
		const { payableBills } = await import('./inroom-bill');
		const bills = [
			{ id: 'late', items: [it_('2026-10-18')], published: true, due: 500 },
			{ id: 'paid', items: [it_('2026-10-15')], published: true, due: 0 },
			{ id: 'hidden', items: [], published: false, due: 0, stayDate: '2026-10-14' },
			{ id: 'early', items: [it_('2026-10-16')], published: true, due: 1200 }
		];
		expect(payableBills(bills).map((b) => b.id)).toEqual(['early', 'late']);
	});
});

describe('見本の請求書2枚（2026-10-18）', () => {
	it('連泊（2泊）と宛名違い（1泊）の2枚で、どちらも払える', async () => {
		const { demoStayBill, billStayRange, billAddressee, payableBills, NO_FLAGS, EMPTY_NOTE } = await import('./inroom-bill');
		const v = demoStayBill(NO_FLAGS, EMPTY_NOTE, new Date('2026-10-18T03:00:00Z'), 0, 2);
		expect(v.bills).toHaveLength(2);
		expect(billStayRange(v.bills[0])?.nights).toBe(2);
		expect(billStayRange(v.bills[1])?.nights).toBe(1);
		expect(billAddressee(v.bills[1], v.guestName)).toBe('株式会社見本商事');
		expect(payableBills(v.bills)).toHaveLength(2);
		expect(v.dueTotal).toBe(v.bills[0].due + v.bills[1].due);
	});
});
