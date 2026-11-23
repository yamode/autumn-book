// クーポンコードの照会（/booking/coupon）の流れ（2026-11-23 レビュー M-8）
// 実際の +server.ts を、Supabase の RPC だけ差し替えて動かす（回数制限は KV の代わりにプロセス内メモリ）。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('$lib/server/auth', () => ({ MEMBER_SUPABASE: true }));
vi.mock('$lib/server/supabase-data', () => ({ bookingSessionId: () => 'sess-1' }));
vi.mock('$lib/server/partners/admin-client', () => ({
	partnerServiceClient: () => ({ schema: () => ({ rpc }) })
}));

const { POST } = await import('./+server');
const { clearRateMemory } = await import('$lib/server/login-rate-limit');
const { couponFailed, couponLocked } = await import('$lib/server/booking-coupon');

const HOLD = '0f8fad5b-d9cb-469f-a165-70867728950e';

function call(code: string, opts: { member?: string | null; ip?: string } = {}) {
	const body = new URLSearchParams({ holdId: HOLD, code });
	const request = new Request('https://book.yamado.app/booking/coupon', {
		method: 'POST',
		body,
		headers: { 'cf-connecting-ip': opts.ip ?? '203.0.113.10' }
	});
	const user = opts.member === null ? null : { id: opts.member ?? 'member-a', role: 'member' };
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return POST({ request, locals: { user }, cookies: {}, platform: undefined } as any) as Promise<Response>;
}

beforeEach(() => {
	clearRateMemory();
	rpc.mockReset();
	// 正しいコードは WELCOME2026 だけ
	rpc.mockImplementation(async (_name: string, args: { p_code: string }) =>
		args.p_code === 'WELCOME2026'
			? { data: { amount: 1000, name: '初回ご宿泊 1,000円引き' }, error: null }
			: { data: null, error: { message: 'coupon_invalid' } }
	);
});

describe('クーポンコードの照会の流れ', () => {
	it('会員が正しいコードを入れると、割引額と名前が返る', async () => {
		const res = await call('welcome2026');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ code: 'WELCOME2026', amount: 1000, name: '初回ご宿泊 1,000円引き' });
	});

	it('非会員は使えない（403）', async () => {
		const res = await call('WELCOME2026', { member: null });
		expect(res.status).toBe(403);
		expect(rpc).not.toHaveBeenCalled();
	});

	it('違うコードは「ご利用いただけません」（400）', async () => {
		const res = await call('WRONG0001');
		expect(res.status).toBe(400);
		expect((await res.json()).message).toContain('ご利用いただけません');
	});

	it('10 回続けて外れると止まり、正しいコードでも 15 分は受け付けない（429・DB に問い合わせない）', async () => {
		for (let i = 0; i < 10; i++) expect((await call(`WRONG${1000 + i}`)).status).toBe(400);
		rpc.mockClear();
		const res = await call('WELCOME2026');
		expect(res.status).toBe(429);
		expect((await res.json()).message).toContain('15 分');
		expect(rpc).not.toHaveBeenCalled();
	});

	it('9 回外れても、10 回目に正しいコードなら使える', async () => {
		for (let i = 0; i < 9; i++) await call(`WRONG${2000 + i}`);
		expect((await call('WELCOME2026')).status).toBe(200);
	});

	it('別の会員・別の IP は止まらない', async () => {
		for (let i = 0; i < 10; i++) await call(`WRONG${3000 + i}`);
		expect((await call('WELCOME2026', { member: 'member-b', ip: '198.51.100.7' })).status).toBe(200);
	});

	it('会員を替えても同じ IP（IPv6 は /64）から 30 回外れると止まる', async () => {
		for (let i = 0; i < 30; i++) {
			await call(`WRONG${4000 + i}`, { member: `m-${Math.floor(i / 5)}`, ip: `2001:db8:1:2::${i.toString(16)}` });
		}
		expect((await call('WELCOME2026', { member: 'm-new', ip: '2001:db8:1:2::ffff' })).status).toBe(429);
	});

	it('形の合わないコードも失敗として数える', async () => {
		for (let i = 0; i < 10; i++) await call('x');
		expect((await call('WELCOME2026')).status).toBe(429);
	});
});

describe('予約確定・決済で使う判定（couponLocked / couponFailed）', () => {
	const ev = (ip = '203.0.113.20') => ({ platform: undefined, request: new Request('https://x/', { headers: { 'cf-connecting-ip': ip } }) });

	it('照会と同じ数えを共有する（確定で外れた分も含めて 10 回で止まる）', async () => {
		for (let i = 0; i < 5; i++) await couponFailed(ev(), 'member-c');
		expect(await couponLocked(ev(), 'member-c')).toBe(false);
		for (let i = 0; i < 5; i++) await couponFailed(ev(), 'member-c');
		expect(await couponLocked(ev(), 'member-c')).toBe(true);
		expect(await couponLocked(ev('192.0.2.99'), 'member-d')).toBe(false);
	});
});
