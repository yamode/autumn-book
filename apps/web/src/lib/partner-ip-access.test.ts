import { describe, expect, it } from 'vitest';
import { accessDenial, ipAllowed, parseAllowList, parseIp, parseRange } from './partner-ip-access';

describe('parseIp', () => {
  it('IPv4・IPv6・IPv4 埋め込みの IPv6 を読む', () => {
    expect(parseIp('203.0.113.5')).toEqual({ v: 4, value: 0xcb007105n });
    expect(parseIp('::ffff:203.0.113.5')).toEqual({ v: 4, value: 0xcb007105n });
    expect(parseIp('2001:db8::1')?.v).toBe(6);
    expect(parseIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual(parseIp('2001:db8::1'));
    expect(parseIp('::1')?.value).toBe(1n);
  });
  it('書き方の違うものは null', () => {
    for (const s of ['', '256.1.1.1', '1.2.3', '1.2.3.4.5', 'abc', '2001:db8:::1', '1:2:3:4:5:6:7:8:9', '2001:db8::g']) {
      expect(parseIp(s)).toBeNull();
    }
  });
});

describe('parseRange', () => {
  it('CIDR を読む。広すぎる範囲は誤入力', () => {
    expect(parseRange('203.0.113.0/24')).not.toBeNull();
    expect(parseRange('240b:13:4740::/48')).not.toBeNull();
    expect(parseRange('10.0.0.0/7')).toBeNull();
    expect(parseRange('2001::/15')).toBeNull();
    expect(parseRange('1.2.3.4/33')).toBeNull();
    expect(parseRange('1.2.3.4/')).toBeNull();
  });
});

describe('ipAllowed', () => {
  const list = ['149.19.34.220', '203.0.113.0/24', '240b:13:4740::/48'];
  it('一覧が空なら常に許可', () => {
    expect(ipAllowed('198.51.100.1', [])).toBe(true);
    expect(ipAllowed(null, [])).toBe(true);
  });
  it('単体・範囲・IPv6 の範囲で一致', () => {
    expect(ipAllowed('149.19.34.220', list)).toBe(true);
    expect(ipAllowed('203.0.113.254', list)).toBe(true);
    expect(ipAllowed('240b:13:4740:3800:e19e:c18a:7b28:773a', list)).toBe(true);
    expect(ipAllowed('::ffff:149.19.34.220', list)).toBe(true);
  });
  it('一致しない・読めない接続元は拒否', () => {
    expect(ipAllowed('149.19.34.221', list)).toBe(false);
    expect(ipAllowed('203.0.114.1', list)).toBe(false);
    expect(ipAllowed('240b:13:4741::1', list)).toBe(false);
    expect(ipAllowed(null, list)).toBe(false);
    expect(ipAllowed('garbage', list)).toBe(false);
  });
});

describe('parseAllowList', () => {
  it('改行・カンマ・空白で区切り、# 以降はメモとして残す、重複は除く', () => {
    const r = parseAllowList('149.19.34.220  # 本社\n203.0.113.0/24, 203.0.113.0/24\n\n240b:13:4740::/48');
    expect(r).toEqual({ entries: ['149.19.34.220 # 本社', '203.0.113.0/24', '240b:13:4740::/48'], errors: [] });
  });
  it('メモ付きで保存した一覧でも照合できる', () => {
    expect(ipAllowed('149.19.34.220', ['149.19.34.220 # 本社'])).toBe(true);
    expect(ipAllowed('149.19.34.221', ['149.19.34.220 # 本社'])).toBe(false);
  });
  it('書き方の違う行を返す', () => {
    expect(parseAllowList('1.2.3.4\n999.1.1.1\n10.0.0.0/4').errors).toEqual(['999.1.1.1', '10.0.0.0/4']);
  });
  it('51 件以上は登録できない', () => {
    const many = Array.from({ length: 51 }, (_, i) => `10.0.0.${i}`).join('\n');
    expect(parseAllowList(many).errors.length).toBe(1);
  });
});

describe('accessDenial', () => {
  const off = { allowedIps: [], blockForeign: false };
  it('既定（オフ）はどこからでも入れる', () => {
    expect(accessDenial(off, { ip: '198.51.100.1', country: 'US' })).toBeNull();
    expect(accessDenial(off, { ip: null, country: null })).toBeNull();
  });
  it('国外を拒否: JP だけ通す。判定できないときも拒否（ローカル開発だけ通す）', () => {
    const r = { allowedIps: [], blockForeign: true };
    expect(accessDenial(r, { ip: '1.1.1.1', country: 'JP' })).toBeNull();
    expect(accessDenial(r, { ip: '1.1.1.1', country: 'jp' })).toBeNull();
    expect(accessDenial(r, { ip: '1.1.1.1', country: 'US' })).toBe('country');
    expect(accessDenial(r, { ip: '1.1.1.1', country: 'T1' })).toBe('country');
    expect(accessDenial(r, { ip: '1.1.1.1', country: 'XX' })).toBe('country');
    expect(accessDenial(r, { ip: '1.1.1.1', country: null })).toBe('country');
    expect(accessDenial(r, { ip: '1.1.1.1', country: null }, { allowUnknownCountry: true })).toBeNull();
  });
  it('IP と国の両方を設定したら両方を満たすときだけ', () => {
    const r = { allowedIps: ['203.0.113.0/24'], blockForeign: true };
    expect(accessDenial(r, { ip: '203.0.113.9', country: 'JP' })).toBeNull();
    expect(accessDenial(r, { ip: '203.0.113.9', country: 'SG' })).toBe('country');
    expect(accessDenial(r, { ip: '198.51.100.1', country: 'JP' })).toBe('ip');
  });
});
