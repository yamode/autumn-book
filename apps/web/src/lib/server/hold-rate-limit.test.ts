import { describe, expect, it } from 'vitest';
import { HOLD_LIMIT, holdAllowed, holdClientKey, holdErrorKind, holdRateCheck, holdRateKey } from './hold-rate-limit';

describe('仮押さえの回数制限（S8）', () => {
	it('同じ 10 分の窓なら同じキー、次の窓で変わる', () => {
		const t = Date.UTC(2026, 9, 10, 0, 0, 0);
		expect(holdRateKey('1.2.3.4', t)).toBe(holdRateKey('1.2.3.4', t + 9 * 60 * 1000));
		expect(holdRateKey('1.2.3.4', t)).not.toBe(holdRateKey('1.2.3.4', t + 10 * 60 * 1000));
		expect(holdRateKey('1.2.3.4', t).startsWith('hold:1.2.3.4:')).toBe(true);
	});

	it('接続元は空なら unknown・100 文字まで（DB の client_key と同じ）', () => {
		expect(holdClientKey('')).toBe('unknown');
		expect(holdClientKey(null)).toBe('unknown');
		expect(holdClientKey('  10.0.0.1 ')).toBe('10.0.0.1');
		expect(holdClientKey('a'.repeat(150))).toHaveLength(100);
	});

	it('20 回目までは通し、21 回目で止める', () => {
		expect(HOLD_LIMIT).toBe(20);
		expect(holdAllowed(19)).toBe(true);
		expect(holdAllowed(20)).toBe(false);
	});

	it('DB の例外を画面の分岐に振り分ける', () => {
		expect(holdErrorKind('rate_limited')).toBe('rate_limited');
		expect(holdErrorKind('too_many_holds')).toBe('too_many_holds');
		expect(holdErrorKind('sold_out')).toBe('sold_out');
		expect(holdErrorKind('plan_not_found')).toBeNull();
		expect(holdErrorKind(undefined)).toBeNull();
	});

	it('KV が無い環境はメモリで数え、上限を超えたら false', async () => {
		const t = Date.UTC(2026, 9, 10, 1, 0, 0);
		const ip = 'test-memory-' + t;
		for (let i = 0; i < HOLD_LIMIT; i++) expect(await holdRateCheck(undefined, ip, t)).toBe(true);
		expect(await holdRateCheck(undefined, ip, t)).toBe(false);
		// 別の接続元は影響を受けない
		expect(await holdRateCheck(undefined, ip + '-other', t)).toBe(true);
	});

	it('KV があれば KV で数える', async () => {
		const store = new Map<string, string>();
		const kv = {
			get: async (k: string) => store.get(k) ?? null,
			put: async (k: string, v: string) => void store.set(k, v)
		};
		const platform = { env: { AB_RATE: kv } } as unknown as App.Platform;
		const t = Date.UTC(2026, 9, 10, 2, 0, 0);
		for (let i = 0; i < HOLD_LIMIT; i++) expect(await holdRateCheck(platform, '5.6.7.8', t)).toBe(true);
		expect(await holdRateCheck(platform, '5.6.7.8', t)).toBe(false);
		expect(store.get(holdRateKey('5.6.7.8', t))).toBe(String(HOLD_LIMIT));
	});
});
