// 参考最低料金（トップページ）の取り方（$lib/server/supabase-data.ts referenceMinPrice・2026-11-25 Sentry AUTUMN-BOOK-1/9）
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
vi.mock('$lib/server/supabase', () => ({ supa: () => ({ rpc }), DATA_SOURCE: 'supabase' }));
const { referenceMinPrice } = await import('./supabase-data');
const { clearPublicCache } = await import('./public-cache');

const timeout = { data: null, error: { message: 'canceling statement due to statement timeout' } };
const rows = [{ facility_id: 'f1', min_per_person: 18000 }];

describe('referenceMinPrice', () => {
	beforeEach(() => {
		rpc.mockReset();
		clearPublicCache();
	});

	it('時間切れなら1回だけやり直す', async () => {
		rpc.mockResolvedValueOnce(timeout).mockResolvedValueOnce({ data: rows, error: null });
		expect(await referenceMinPrice(3)).toEqual(rows);
		expect(rpc).toHaveBeenCalledTimes(2);
	});

	it('取れた値は覚えておき、続けて呼んでも DB へ行かない', async () => {
		rpc.mockResolvedValue({ data: rows, error: null });
		await referenceMinPrice(4);
		await referenceMinPrice(4);
		expect(rpc).toHaveBeenCalledTimes(1);
	});

	it('やり直しても駄目なら直前に取れた値を使う。一度も取れていなければエラーのまま', async () => {
		rpc.mockResolvedValueOnce({ data: rows, error: null });
		await referenceMinPrice(5);
		clearPublicCache();
		rpc.mockResolvedValue(timeout);
		expect(await referenceMinPrice(5)).toEqual(rows);
		await expect(referenceMinPrice(6)).rejects.toBeTruthy();
	});
});
