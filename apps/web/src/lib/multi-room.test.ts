// 複数室予約の純関数のテスト（DB の book._allocate と同じ式）。`pnpm --filter @autumn-book/web test`
import { describe, expect, it } from 'vitest';
import { allocateByWeight, childTotalOf, MAX_ROOMS_PER_BOOKING, parseHoldRooms } from './multi-room';

const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);

describe('allocateByWeight（部屋の金額比で按分・最大剰余法）', () => {
	it('割り切れる: クーポン 1,000 円を 30,000 / 20,000 → 600 / 400', () => {
		expect(allocateByWeight(1000, [30000, 20000])).toEqual([600, 400]);
	});

	it('端数は剰余の大きい部屋へ: ポイント 1,001 → 601 / 400', () => {
		expect(allocateByWeight(1001, [30000, 20000])).toEqual([601, 400]);
	});

	it('剰余が同じなら若い部屋から 1 円ずつ', () => {
		expect(allocateByWeight(10, [1, 1, 1])).toEqual([4, 3, 3]);
		expect(allocateByWeight(11, [1, 1, 1])).toEqual([4, 4, 3]);
	});

	it('1 室なら全額', () => {
		expect(allocateByWeight(1234, [69300])).toEqual([1234]);
	});

	it('0 円は全部 0', () => {
		expect(allocateByWeight(0, [30000, 20000])).toEqual([0, 0]);
	});

	it('重みが全部 0 なら均等', () => {
		expect(allocateByWeight(5, [0, 0])).toEqual([3, 2]);
	});

	it('重みが 0 の部屋には配らない', () => {
		expect(allocateByWeight(100, [0, 50])).toEqual([0, 100]);
	});

	it('合計は必ず元の額に一致する', () => {
		const cases: [number, number[]][] = [
			[9999, [12345, 67890, 11111, 3]],
			[1, [3, 3, 3, 3]],
			[777, [30000, 29999, 1]],
			[100000, [33333, 33333, 33334]]
		];
		for (const [amount, weights] of cases) {
			const out = allocateByWeight(amount, weights);
			expect(sum(out)).toBe(amount);
			expect(out.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
		}
	});

	it('空の配列は空', () => {
		expect(allocateByWeight(100, [])).toEqual([]);
	});

	it('負・小数の額は受け付けない', () => {
		expect(() => allocateByWeight(-1, [1])).toThrow(RangeError);
		expect(() => allocateByWeight(1.5, [1])).toThrow(RangeError);
	});
});

describe('parseHoldRooms（?/hold のフォーム）', () => {
	const P = '11111111-2222-3333-4444-555555555555';
	const R = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
	const form = (o: Record<string, string>) => (k: string) => o[k] ?? null;

	it('従来の 1 室のフィールド', () => {
		expect(parseHoldRooms(form({ planId: P, roomTypeId: R, adults: '2' }))).toEqual({
			ok: true,
			rooms: [{ planId: P, roomTypeId: R, adults: 2 }]
		});
	});

	it('rooms JSON（複数室）を優先する', () => {
		const rooms = [
			{ planId: P, roomTypeId: R, adults: 2 },
			{ planId: P, roomTypeId: R, adults: 1 }
		];
		expect(parseHoldRooms(form({ rooms: JSON.stringify(rooms), planId: P, roomTypeId: R, adults: '6' }))).toEqual({ ok: true, rooms });
	});

	it('5 室は too_many_rooms', () => {
		const rooms = Array.from({ length: 5 }, () => ({ planId: P, roomTypeId: R, adults: 1 }));
		expect(parseHoldRooms(form({ rooms: JSON.stringify(rooms) }))).toEqual({ ok: false, code: 'too_many_rooms' });
	});

	it('欠けている・壊れている', () => {
		expect(parseHoldRooms(form({ planId: P }))).toEqual({ ok: false, code: 'missing' });
		expect(parseHoldRooms(form({ rooms: '[]' }))).toEqual({ ok: false, code: 'missing' });
		expect(parseHoldRooms(form({ rooms: '{' }))).toEqual({ ok: false, code: 'invalid' });
		expect(parseHoldRooms(form({ planId: P, roomTypeId: R, adults: '7' }))).toEqual({ ok: false, code: 'invalid' });
		expect(parseHoldRooms(form({ planId: "x' or 1=1", roomTypeId: R, adults: '2' }))).toEqual({ ok: false, code: 'invalid' });
	});

	it('デモの id（英数・-）も通す', () => {
		expect(parseHoldRooms(form({ planId: 'p-nishiwaga-1', roomTypeId: 'rt-1', adults: '2' })).ok).toBe(true);
	});
});

describe('定数・小物', () => {
	it('1 予約 4 室まで（DB の book._max_rooms_per_booking() と同じ）', () => {
		expect(MAX_ROOMS_PER_BOOKING).toBe(4);
	});

	it('子どもの人数の和', () => {
		expect(childTotalOf({ a: 1, b: '2', c: 'x' })).toBe(3);
		expect(childTotalOf(null)).toBe(0);
	});
});
