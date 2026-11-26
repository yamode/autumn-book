import { describe, expect, it, beforeEach } from 'vitest';
import { cachedPublic, clearPublicCache } from './public-cache';

describe('cachedPublic', () => {
	beforeEach(() => clearPublicCache());

	it('同じキーは寿命のあいだ 1 回しか読みに行かない', async () => {
		let calls = 0;
		const load = async () => ++calls;
		expect(await cachedPublic('k', load, 10_000)).toBe(1);
		expect(await cachedPublic('k', load, 10_000)).toBe(1);
		expect(calls).toBe(1);
	});

	it('キーが違えば別に読む', async () => {
		let calls = 0;
		const load = async () => ++calls;
		await cachedPublic('a', load, 10_000);
		await cachedPublic('b', load, 10_000);
		expect(calls).toBe(2);
	});

	it('寿命が切れていれば読み直す', async () => {
		let calls = 0;
		const load = async () => ++calls;
		await cachedPublic('k', load, 0);
		await cachedPublic('k', load, 0);
		expect(calls).toBe(2);
	});

	it('読み込み途中の Promise は分け合わない（Workers では別リクエストの Promise を待てない）。読み終わった値は使い回す', async () => {
		let calls = 0;
		const releases: ((v: number) => void)[] = [];
		const load = () => {
			calls++;
			return new Promise<number>((r) => releases.push(r));
		};
		const all = Promise.all([cachedPublic('k', load, 10_000), cachedPublic('k', load, 10_000)]);
		await Promise.resolve();
		for (const r of releases) r(7);
		expect(await all).toEqual([7, 7]);
		expect(calls).toBe(2);
		// 読み終わったあとは使い回す
		expect(await cachedPublic('k', load, 10_000)).toBe(7);
		expect(calls).toBe(2);
	});

	it('失敗は覚えない（次の人がやり直せる）', async () => {
		let calls = 0;
		const load = async () => {
			calls++;
			if (calls === 1) throw new Error('boom');
			return calls;
		};
		await expect(cachedPublic('k', load, 10_000)).rejects.toThrow('boom');
		expect(await cachedPublic('k', load, 10_000)).toBe(2);
	});
});
