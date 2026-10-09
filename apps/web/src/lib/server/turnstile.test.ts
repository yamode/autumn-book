// Turnstile のサーバ側検証（docs/auth-hardening.md §4.2）
import { beforeEach, describe, expect, it, vi } from 'vitest';

const privateEnv: Record<string, string | undefined> = {};
const publicEnv: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env: privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: publicEnv }));

const { checkTurnstile, turnstileConfigured, verifyTurnstile } = await import('./turnstile');

const okFetch = (success: boolean) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ success }), { status: 200 })) as unknown as typeof fetch;

describe('turnstileConfigured', () => {
  it('サイトキーとシークレットの両方があるときだけ検証する', () => {
    expect(turnstileConfigured('site', 'secret')).toBe(true);
    expect(turnstileConfigured('', 'secret')).toBe(false);
    expect(turnstileConfigured('site', '')).toBe(false);
    expect(turnstileConfigured(undefined, undefined)).toBe(false);
    expect(turnstileConfigured(' ', ' ')).toBe(false);
  });
});

describe('verifyTurnstile', () => {
  it('success=true のときだけ通す。remoteip を付けて siteverify を呼ぶ', async () => {
    const f = okFetch(true);
    expect(await verifyTurnstile('tok', '203.0.113.1', 'sec', f)).toBe(true);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = init.body as URLSearchParams;
    expect(body.get('secret')).toBe('sec');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('203.0.113.1');
  });
  it('IP が無い（unknown）ときは remoteip を付けない', async () => {
    const f = okFetch(true);
    await verifyTurnstile('tok', 'unknown', 'sec', f);
    const body = ((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.has('remoteip')).toBe(false);
  });
  it('失敗・トークン無し・通信エラーは通さない', async () => {
    expect(await verifyTurnstile('tok', null, 'sec', okFetch(false))).toBe(false);
    expect(await verifyTurnstile('', null, 'sec', okFetch(true))).toBe(false);
    expect(await verifyTurnstile('x'.repeat(2049), null, 'sec', okFetch(true))).toBe(false);
    const broken = vi.fn(async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile('tok', null, 'sec', broken)).toBe(false);
    const http500 = vi.fn(async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    expect(await verifyTurnstile('tok', null, 'sec', http500)).toBe(false);
  });
});

describe('checkTurnstile', () => {
  beforeEach(() => {
    delete privateEnv.TURNSTILE_SECRET_KEY;
    delete publicEnv.PUBLIC_TURNSTILE_SITE_KEY;
  });
  it('未設定（ローカル dev）はスキップして通す', async () => {
    expect(await checkTurnstile(new FormData(), '203.0.113.1')).toEqual({ ok: true, skipped: true });
    publicEnv.PUBLIC_TURNSTILE_SITE_KEY = 'site';
    expect(await checkTurnstile(new FormData(), '203.0.113.1')).toEqual({ ok: true, skipped: true });
  });
  it('両方設定されていればトークン無しは通さない（siteverify を呼ぶ前に落とす）', async () => {
    publicEnv.PUBLIC_TURNSTILE_SITE_KEY = 'site';
    privateEnv.TURNSTILE_SECRET_KEY = 'secret';
    expect(await checkTurnstile(new FormData(), '203.0.113.1')).toEqual({ ok: false, skipped: false });
  });
});
