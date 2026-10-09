import { describe, it, expect, vi, afterEach } from 'vitest';
import { cachedPortalMonth } from './portal-month-cache';
import type { PortalMonth } from './portal-month';

const body = (n: number) => ({ guests: n }) as unknown as PortalMonth;
const memKv = () => {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) };
};

afterEach(() => vi.useRealTimers());

describe('cachedPortalMonth', () => {
  it('KV が無ければ毎回読む', async () => {
    const load = vi.fn(async () => body(1));
    await cachedPortalMonth(null, 'k', load, null);
    await cachedPortalMonth(null, 'k', load, null);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('1分以内は保存した結果を返し、読み直さない', async () => {
    const kv = memKv();
    const load = vi.fn(async () => body(1));
    await cachedPortalMonth(kv, 'k', load, null);
    const r = await cachedPortalMonth(kv, 'k', load, null);
    expect(r).toEqual(body(1));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('1〜5分は古い結果を先に返し、裏で取り直す', async () => {
    const kv = memKv();
    kv.m.set('k', JSON.stringify({ at: Date.now() - 2 * 60 * 1000, body: body(1) }));
    const load = vi.fn(async () => body(2));
    const pending: Promise<unknown>[] = [];
    const r = await cachedPortalMonth(kv, 'k', load, (p) => pending.push(p));
    expect(r).toEqual(body(1));
    await Promise.all(pending);
    expect(load).toHaveBeenCalledTimes(1);
    expect(JSON.parse(kv.m.get('k')!).body).toEqual(body(2));
  });

  it('5分を過ぎた・waitUntil が無いときはその場で読む', async () => {
    const kv = memKv();
    kv.m.set('k', JSON.stringify({ at: Date.now() - 6 * 60 * 1000, body: body(1) }));
    const load = vi.fn(async () => body(2));
    expect(await cachedPortalMonth(kv, 'k', load, () => undefined)).toEqual(body(2));
    kv.m.set('k2', JSON.stringify({ at: Date.now() - 2 * 60 * 1000, body: body(1) }));
    expect(await cachedPortalMonth(kv, 'k2', load, null)).toEqual(body(2));
  });
});
