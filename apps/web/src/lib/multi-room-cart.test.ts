// 複数室予約 M1 の純関数（予約かご・明細・支払方法）のテスト。`pnpm --filter @autumn-book/web test`
import { describe, expect, it } from 'vitest';
import {
	canAddToCart,
	cartGroups,
	cartIsFull,
	cartRoomsPayload,
	cartSummary,
	CART_STORAGE_KEY,
	combinePayments,
	combineQuotes,
	payCompatible,
	readCart,
	nightGroups,
	writeCart,
	type CartItem
} from './multi-room';

const ONSITE = { onsite: true, prepay: false };
const PREPAY = { onsite: false, prepay: true };
const BOTH = { onsite: true, prepay: true };

let n = 0;
const item = (o: Partial<CartItem> = {}): CartItem => ({
	key: `k${++n}`,
	facilityId: 'f1',
	brandSlug: 'yamado',
	facilitySlug: 'nishiwaga',
	checkin: '2026-11-20',
	nights: 1,
	planId: 'p1',
	planSlug: 'plan-1',
	planName: '朝夕食',
	roomTypeId: 'wa',
	roomName: '和室',
	adults: 2,
	total: 30000,
	pay: BOTH,
	remaining: null,
	...o
});

describe('payCompatible（支払方法の両立・Q3）', () => {
	it('全室で現地払い or 全室で予約時決済ができれば両立', () => {
		expect(payCompatible([ONSITE, BOTH])).toBe(true);
		expect(payCompatible([PREPAY, BOTH])).toBe(true);
		expect(payCompatible([BOTH, BOTH])).toBe(true);
		expect(payCompatible([])).toBe(true);
	});
	it('現地払いだけのプランと予約時決済だけのプランは両立しない', () => {
		expect(payCompatible([ONSITE, PREPAY])).toBe(false);
		expect(payCompatible([ONSITE, BOTH, PREPAY])).toBe(false);
	});
});

describe('canAddToCart（かごに足せるか）', () => {
	it('空のかごには足せる', () => {
		expect(canAddToCart([], item())).toEqual({ ok: true });
	});
	it('施設・チェックイン日・泊数のどれかが違えば other_stay（かごを空にしますか）', () => {
		const cart = [item()];
		expect(canAddToCart(cart, item({ facilityId: 'f2' }))).toEqual({ ok: false, reason: 'other_stay' });
		expect(canAddToCart(cart, item({ checkin: '2026-11-21' }))).toEqual({ ok: false, reason: 'other_stay' });
		expect(canAddToCart(cart, item({ nights: 2 }))).toEqual({ ok: false, reason: 'other_stay' });
	});
	it('4 室入っていれば full（5 室目は入らない）', () => {
		const cart = [item(), item(), item(), item()];
		expect(cartIsFull(cart)).toBe(true);
		expect(canAddToCart(cart, item())).toEqual({ ok: false, reason: 'full' });
		expect(cartIsFull(cart.slice(0, 3))).toBe(false);
		expect(canAddToCart(cart.slice(0, 3), item())).toEqual({ ok: true });
	});
	it('支払方法が両立しないプランは mixed_payment', () => {
		expect(canAddToCart([item({ pay: ONSITE })], item({ pay: PREPAY }))).toEqual({ ok: false, reason: 'mixed_payment' });
		expect(canAddToCart([item({ pay: ONSITE })], item({ pay: BOTH }))).toEqual({ ok: true });
	});
	it('同じ部屋タイプは残室まで', () => {
		const cart = [item({ roomTypeId: 'wa', remaining: 2 })];
		expect(canAddToCart(cart, item({ roomTypeId: 'wa', remaining: 2 }))).toEqual({ ok: true });
		expect(canAddToCart([...cart, item({ roomTypeId: 'wa' })], item({ roomTypeId: 'wa', remaining: 2 }))).toEqual({ ok: false, reason: 'no_remaining' });
		// 別の部屋タイプは数えない
		expect(canAddToCart([...cart, item({ roomTypeId: 'wa' })], item({ roomTypeId: 'yo', remaining: 1 }))).toEqual({ ok: true });
	});
	it('日程の違いは室数より先に判定する（4 室でも別日程なら空にする案内）', () => {
		const cart = [item(), item(), item(), item()];
		expect(canAddToCart(cart, item({ checkin: '2026-12-01' }))).toEqual({ ok: false, reason: 'other_stay' });
	});
});

describe('かごの要約・送信・まとめ', () => {
	it('室数・大人の合計・宿泊料金の合計', () => {
		expect(cartSummary([item({ adults: 2, total: 30000 }), item({ adults: 3, total: 41000 })])).toEqual({ rooms: 2, adults: 5, total: 71000 });
	});
	it('?/hold に送る rooms は並び順のまま', () => {
		expect(cartRoomsPayload([item({ planId: 'a', roomTypeId: 'x', adults: 2 }), item({ planId: 'b', roomTypeId: 'y', adults: 1 })])).toEqual([
			{ planId: 'a', roomTypeId: 'x', adults: 2 },
			{ planId: 'b', roomTypeId: 'y', adults: 1 }
		]);
	});
	it('同じ部屋タイプ・プラン・人数は「×2」にまとめる', () => {
		const a = item({ key: 'a' });
		const b = item({ key: 'b' });
		const c = item({ key: 'c', roomTypeId: 'yo' });
		const g = cartGroups([a, b, c]);
		expect(g.map((x) => [x.item.roomTypeId, x.count, x.keys])).toEqual([
			['wa', 2, ['a', 'b']],
			['yo', 1, ['c']]
		]);
	});
});

describe('readCart / writeCart（sessionStorage・try/catch）', () => {
	const mem = () => {
		const s = new Map<string, string>();
		return {
			getItem: (k: string) => s.get(k) ?? null,
			setItem: (k: string, v: string) => void s.set(k, v),
			removeItem: (k: string) => void s.delete(k),
			raw: s
		};
	};
	it('書いて読める・空なら消える', () => {
		const st = mem();
		const cart = [item(), item({ roomTypeId: 'yo' })];
		writeCart(st, cart);
		expect(readCart(st)).toEqual(cart);
		writeCart(st, []);
		expect(st.raw.has(CART_STORAGE_KEY)).toBe(false);
		expect(readCart(st)).toEqual([]);
	});
	it('壊れた値・別の日程が混ざった値・例外は空', () => {
		const st = mem();
		st.setItem(CART_STORAGE_KEY, '{');
		expect(readCart(st)).toEqual([]);
		st.setItem(CART_STORAGE_KEY, JSON.stringify([item(), item({ checkin: '2026-12-01' })]));
		expect(readCart(st)).toEqual([]);
		const throwing = {
			getItem: () => {
				throw new Error('denied');
			},
			setItem: () => {
				throw new Error('denied');
			},
			removeItem: () => {
				throw new Error('denied');
			}
		};
		expect(readCart(throwing)).toEqual([]);
		expect(() => writeCart(throwing, [item()])).not.toThrow();
		expect(readCart(null)).toEqual([]);
	});
	it('5 室以上の値は 4 室に切る', () => {
		const st = mem();
		st.setItem(CART_STORAGE_KEY, JSON.stringify([item(), item(), item(), item(), item()]));
		expect(readCart(st)).toHaveLength(4);
	});
});

describe('nightGroups（泊の見出し → 部屋の行）', () => {
	it('1 室 1 泊でも見出しが 1 つ', () => {
		expect(nightGroups([{ lines: [{ date: '2026-04-15', unitPrice: 83000, adults: 2, subtotal: 166000 }] }])).toEqual([
			{ night: 1, date: '2026-04-15', rows: [{ room: 0, unitPrice: 83000, adults: 2, subtotal: 166000 }] }
		]);
	});
	it('2 室 2 泊なら 見出し 2 つ × 部屋の行 2 つ・泊は日付の順', () => {
		const groups = nightGroups([
			{
				lines: [
					{ date: '2026-11-21', unitPrice: 16000, adults: 2, subtotal: 32000 },
					{ date: '2026-11-20', unitPrice: 15000, adults: 2, subtotal: 30000 }
				]
			},
			{
				lines: [
					{ date: '2026-11-20', unitPrice: 12000, adults: 1, subtotal: 12000 },
					{ date: '2026-11-21', unitPrice: 13000, adults: 1, subtotal: 13000 }
				]
			}
		]);
		expect(groups.map((g) => [g.night, g.date, g.rows.map((r) => [r.room, r.unitPrice, r.adults, r.subtotal])])).toEqual([
			[1, '2026-11-20', [[0, 15000, 2, 30000], [1, 12000, 1, 12000]]],
			[2, '2026-11-21', [[0, 16000, 2, 32000], [1, 13000, 1, 13000]]]
		]);
	});
});

describe('combineQuotes / combinePayments', () => {
	it('見積の合計・内消費税は部屋の和', () => {
		const q = combineQuotes([
			{ lines: [{ date: '2026-11-20', unitPrice: 15000, adults: 2, subtotal: 30000 }], total: 30000, perPerson: 15000, taxIncluded: 2727, pointsUsed: 0, payable: 30000 },
			{ lines: [{ date: '2026-11-20', unitPrice: 20000, adults: 1, subtotal: 20000 }], total: 20000, perPerson: 20000, taxIncluded: 1818, pointsUsed: 0, payable: 20000 }
		]);
		expect(q.total).toBe(50000);
		expect(q.taxIncluded).toBe(4545);
		expect(q.payable).toBe(50000);
		expect(q.lines).toHaveLength(2);
	});
	it('支払方法は全室で許されているものだけ', () => {
		expect(combinePayments([
			{ onsite: true, prepay: true, prepayMethods: ['card', 'paypay'] },
			{ onsite: true, prepay: true, prepayMethods: ['card'] }
		])).toEqual({ onsite: true, prepay: true, prepayMethods: ['card'] });
		expect(combinePayments([
			{ onsite: true, prepay: false, prepayMethods: [] },
			{ onsite: true, prepay: true, prepayMethods: ['card'] }
		])).toEqual({ onsite: true, prepay: false, prepayMethods: [] });
		// 両立しない（かごを通らずに来た）組み合わせは何も残らない
		expect(combinePayments([
			{ onsite: true, prepay: false, prepayMethods: [] },
			{ onsite: false, prepay: true, prepayMethods: ['card'] }
		])).toEqual({ onsite: false, prepay: false, prepayMethods: [] });
	});
});
