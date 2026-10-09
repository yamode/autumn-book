import { describe, expect, it } from 'vitest';
import { isNewEnvironment, isPartnerSessionAlive, LOGIN_LOG_LABELS, SECURITY_LOG_ACTIONS, summarizeUserAgent } from './partner-login-security';

const H = 3600_000;
const now = Date.parse('2026-10-10T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('isPartnerSessionAlive（M3: 7 日 or 最終アクセスから 24 時間の早い方）', () => {
  it('期限内・24 時間以内のアクセスなら生きている', () => {
    expect(isPartnerSessionAlive({ expires_at: iso(now + 5 * 24 * H), last_seen_at: iso(now - 23 * H) }, now)).toBe(true);
  });
  it('最終アクセスから 24 時間を過ぎたら切れ（7 日以内でも）', () => {
    expect(isPartnerSessionAlive({ expires_at: iso(now + 5 * 24 * H), last_seen_at: iso(now - 24 * H) }, now)).toBe(false);
  });
  it('発行から 7 日（expires_at）を過ぎたら切れ（毎日使っていても）', () => {
    expect(isPartnerSessionAlive({ expires_at: iso(now - 1000), last_seen_at: iso(now - H) }, now)).toBe(false);
    expect(isPartnerSessionAlive({ expires_at: iso(now), last_seen_at: iso(now) }, now)).toBe(false);
  });
  it('last_seen_at が無ければ created_at で見る。どちらも無ければ expires_at だけ', () => {
    expect(isPartnerSessionAlive({ expires_at: iso(now + H), last_seen_at: null, created_at: iso(now - 25 * H) }, now)).toBe(false);
    expect(isPartnerSessionAlive({ expires_at: iso(now + H), last_seen_at: null, created_at: null }, now)).toBe(true);
  });
  it('expires_at が読めなければ切れ', () => {
    expect(isPartnerSessionAlive({ expires_at: 'x', last_seen_at: iso(now) }, now)).toBe(false);
  });
});

describe('isNewEnvironment（§4.3: 端末も IP も初見のときだけ）', () => {
  const history = [
    { deviceId: 'dev-a', ip: '203.0.113.1' },
    { deviceId: null, ip: '198.51.100.7' }
  ];
  it('同じ端末なら IP が変わっても新しくない（モバイル回線の切替）', () => {
    expect(isNewEnvironment(history, 'dev-a', '192.0.2.99')).toBe(false);
  });
  it('端末が初見でも同じ IP なら新しくない', () => {
    expect(isNewEnvironment(history, 'dev-new', '198.51.100.7')).toBe(false);
  });
  it('端末も IP も初見なら新しい', () => {
    expect(isNewEnvironment(history, 'dev-new', '192.0.2.99')).toBe(true);
  });
  it('履歴が空（初めてのログイン）は新しい', () => {
    expect(isNewEnvironment([], 'dev-a', '203.0.113.1')).toBe(true);
  });
  it('null 同士を一致とみなさない', () => {
    expect(isNewEnvironment([{ deviceId: null, ip: null }], null, null)).toBe(true);
  });
});

describe('summarizeUserAgent', () => {
  it('主なブラウザと OS を短くする', () => {
    expect(summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36')).toBe('Chrome / Windows');
    expect(summarizeUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0')).toBe('Edge / Windows');
    expect(summarizeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1')).toBe('Safari / iPhone');
    expect(summarizeUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:131.0) Gecko/20100101 Firefox/131.0')).toBe('Firefox / Mac');
    expect(summarizeUserAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36')).toBe('Chrome / Android');
  });
  it('空・不明', () => {
    expect(summarizeUserAgent(null)).toBe('不明なブラウザ');
    expect(summarizeUserAgent('curl/8.0')).toBe('その他のブラウザ');
  });
});

describe('LOGIN_LOG_LABELS', () => {
  it('セキュリティに出す種類はすべて日本語の表示名がある', () => {
    for (const a of SECURITY_LOG_ACTIONS) expect(LOGIN_LOG_LABELS[a]).toBeTruthy();
  });
});
