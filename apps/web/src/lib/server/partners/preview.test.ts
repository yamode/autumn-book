import { describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' } }));

const { issuePreviewToken, verifyPreviewToken, PREVIEW_TTL_SECONDS } = await import('./preview');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

describe('確認モードの署名', () => {
  it('発行した取引先・期限内なら通る', async () => {
    const t = (await issuePreviewToken(A))!;
    expect(await verifyPreviewToken(t, A)).toBe(true);
  });
  it('別の取引先には使えない', async () => {
    const t = (await issuePreviewToken(A))!;
    expect(await verifyPreviewToken(t, B)).toBe(false);
    // 取引先 ID だけ書き換えても署名が合わない
    expect(await verifyPreviewToken(t.replace(A, B), B)).toBe(false);
  });
  it('期限切れ・期限の書き換えは通らない', async () => {
    const now = Date.now();
    const t = (await issuePreviewToken(A, now))!;
    expect(await verifyPreviewToken(t, A, now + (PREVIEW_TTL_SECONDS + 1) * 1000)).toBe(false);
    const [id, exp, sig] = t.split('.');
    expect(await verifyPreviewToken(`${id}.${Number(exp) + 86400}.${sig}`, A, now)).toBe(false);
  });
  it('壊れた値・空は通らない', async () => {
    expect(await verifyPreviewToken(undefined, A)).toBe(false);
    expect(await verifyPreviewToken('', A)).toBe(false);
    expect(await verifyPreviewToken(`${A}.9999999999.!!!`, A)).toBe(false);
    expect(await verifyPreviewToken(`${A}.9999999999`, A)).toBe(false);
  });
});
