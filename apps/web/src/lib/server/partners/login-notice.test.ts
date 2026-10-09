// 新しい環境からのログイン通知（docs/auth-hardening.md §4.3・M9）
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sent: { to: string[]; subject: string; text: string }[] = [];
const logs: { action: string; detail?: Record<string, unknown> }[] = [];
let recipient: { email: string; to: 'self' | 'master' } | null = { email: 'me@example.com', to: 'self' };

vi.mock('./store', () => ({
  SETUP_TOKEN_TTL_HOURS: 168,
  findLoginNoticeRecipient: async () => recipient,
  logPartnerAccess: async (_db: unknown, e: { action: string; detail?: Record<string, unknown> }) => {
    logs.push(e);
  }
}));
vi.mock('./mail', () => ({
  sendPartnerMail: async (_db: unknown, _f: string, args: { to: string[]; subject: string; text: string }) => {
    sent.push(args);
    return { sent: true };
  }
}));
vi.mock('./invoices', () => ({ loadInvoiceFacilities: async () => [{ id: 'f1', name: '山人-yamado-', tel: '0197-82-2222' }] }));

const { notifyNewEnvironmentLogin } = await import('./portal-users');

const partner = {
  id: 'p1',
  name: '取引先A',
  facility_id: 'f1',
  facility_name: '山人-yamado-',
  primary_facility_id: 'f1',
  facilities: [{ id: 'f1', slug: 'nishiwaga', name: '山人-yamado-', enabled: true, bookingEnabled: true }]
} as never;
const account = { id: 'a1', login_id: 'agent-abc', display_name: '山田', email: 'me@example.com', is_master: false };
const meta = { ip: '203.0.113.1', userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36' };

describe('notifyNewEnvironmentLogin', () => {
  beforeEach(() => {
    sent.length = 0;
    logs.length = 0;
    recipient = { email: 'me@example.com', to: 'self' };
  });

  it('本人へ送り、件名・本文に必要な事項が入る（コード・パスワードは入らない）', async () => {
    await notifyNewEnvironmentLogin({} as never, { partner, account, meta, location: 'JP Tokyo', loginUrl: 'https://book.yamado.app/p/tok' });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['me@example.com']);
    expect(sent[0].subject).toBe('【山人-yamado-】取引先専用ページに新しい環境からログインがありました');
    expect(sent[0].text).toContain('ログインID: agent-abc');
    expect(sent[0].text).toContain('接続元: 203.0.113.1（JP Tokyo）');
    expect(sent[0].text).toContain('ブラウザ: Chrome / Windows');
    expect(sent[0].text).toContain('0197-82-2222');
    expect(sent[0].text).toContain('認証コードをお尋ねすることはありません');
    expect(logs).toEqual([expect.objectContaining({ action: 'login_new_device', detail: { notified: true, to: 'self' } })]);
  });

  it('本人にメールが無ければマスタへ（書き出しが変わる）', async () => {
    recipient = { email: 'master@example.com', to: 'master' };
    await notifyNewEnvironmentLogin({} as never, { partner, account: { ...account, email: null }, meta, location: null, loginUrl: 'u' });
    expect(sent[0].to).toEqual(['master@example.com']);
    expect(sent[0].text).toContain('マスタユーザーの方へお知らせしています');
    expect(sent[0].text).toContain('接続元: 203.0.113.1\n');
    expect(logs[0].detail).toEqual({ notified: true, to: 'master' });
  });

  it('宛先が無ければ送らず、notified:false を残す', async () => {
    recipient = null;
    await notifyNewEnvironmentLogin({} as never, { partner, account: { ...account, email: null }, meta, location: null, loginUrl: 'u' });
    expect(sent).toHaveLength(0);
    expect(logs[0]).toEqual(expect.objectContaining({ action: 'login_new_device', detail: { notified: false, to: null, reason: 'no_email' } }));
  });
});
