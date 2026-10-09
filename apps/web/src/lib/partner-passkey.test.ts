import { describe, expect, it } from 'vitest';
import {
  canBootstrapPasskey,
  isCredentialId,
  loginChallengeMatches,
  masterCanChangeMfaPolicy,
  MFA_SETUP_MARK,
  ONE_PERSON_ONE_ID_NOTICE,
  PARTNER_MFA_POLICY_HELP,
  passkeyDeviceName,
  passkeyErrorMessage,
  passkeyRelyingParty,
  passkeyRemoval
} from './partner-passkey';
import { mfaMethodsFor, PARTNER_MFA_POLICIES, portalMfaGate } from './partner-mfa';
import { canResetMfa } from './partner-account-roles';

const NOW = Date.parse('2026-10-10T03:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 3600_000;
const url = (s: string) => new URL(s);

describe('passkeyRelyingParty（パスキーを使えるホスト）', () => {
  it('本番ドメイン（https・PASSKEY_RP_ID と一致）だけ', () => {
    expect(passkeyRelyingParty(url('https://book.yamado.app/p/x'), 'book.yamado.app')).toEqual({ rpID: 'book.yamado.app', origin: 'https://book.yamado.app' });
    expect(passkeyRelyingParty(url('https://BOOK.yamado.app/p/x'), ' Book.Yamado.App ')).toEqual({ rpID: 'book.yamado.app', origin: 'https://book.yamado.app' });
  });
  it('プレビュー（*.pages.dev）・http・別ドメイン・未設定は使えない', () => {
    expect(passkeyRelyingParty(url('https://abc.autumn-book.pages.dev/p/x'), 'book.yamado.app')).toBeNull();
    expect(passkeyRelyingParty(url('http://book.yamado.app/p/x'), 'book.yamado.app')).toBeNull();
    expect(passkeyRelyingParty(url('https://evil.example/p/x'), 'book.yamado.app')).toBeNull();
    expect(passkeyRelyingParty(url('https://book.yamado.app/p/x'), '')).toBeNull();
    expect(passkeyRelyingParty(url('https://book.yamado.app/p/x'), undefined)).toBeNull();
  });
  it('ローカルは localhost（オリジンはそのまま）。127.0.0.1 は使えない', () => {
    expect(passkeyRelyingParty(url('http://localhost:5173/p/x'), 'book.yamado.app')).toEqual({ rpID: 'localhost', origin: 'http://localhost:5173' });
    expect(passkeyRelyingParty(url('http://localhost:5173/p/x'), '')).toEqual({ rpID: 'localhost', origin: 'http://localhost:5173' });
    expect(passkeyRelyingParty(url('http://127.0.0.1:5173/p/x'), 'book.yamado.app')).toBeNull();
  });
});

describe('passkeyDeviceName', () => {
  it('入力を整え、空ならブラウザの要約', () => {
    expect(passkeyDeviceName('  事務所のPC  ', 'Chrome / Windows')).toBe('事務所のPC');
    expect(passkeyDeviceName('', 'Chrome / Windows')).toBe('Chrome / Windows');
    expect(passkeyDeviceName(null, '')).toBe('パスキー');
    expect(passkeyDeviceName('a\u0000b\nc', 'x')).toBe('abc');
    expect(passkeyDeviceName('あ'.repeat(80), 'x')).toHaveLength(60);
  });
});

describe('passkeyRemoval（削除してよいか）', () => {
  it('残りがあれば確認なしで消せる', () => {
    expect(passkeyRemoval('passkey_only', 1)).toEqual({ ok: true, warn: false, message: null });
    expect(passkeyRemoval('step_up', 2).ok).toBe(true);
  });
  it('最後の 1 つ: passkey_only は消せない・それ以外は警告つきで消せる', () => {
    expect(passkeyRemoval('passkey_only', 0).ok).toBe(false);
    const r = passkeyRemoval('step_up', 0);
    expect(r.ok).toBe(true);
    expect(r.warn).toBe(true);
    expect(passkeyRemoval('always', 0).warn).toBe(true);
  });
});

describe('canBootstrapPasskey（passkey_only でパスキー 0 の初回登録）', () => {
  const base = { policy: 'passkey_only' as const, passkeyCount: 0, mfaMethod: MFA_SETUP_MARK, sessionCreatedAt: ago(5 * MIN) };
  it('設定リンクから入った直後 30 分だけ', () => {
    expect(canBootstrapPasskey(base, NOW)).toBe(true);
    expect(canBootstrapPasskey({ ...base, sessionCreatedAt: ago(29 * MIN) }, NOW)).toBe(true);
    expect(canBootstrapPasskey({ ...base, sessionCreatedAt: ago(31 * MIN) }, NOW)).toBe(false);
  });
  it('passkey_only 以外・パスキーがある・パスワードでのログイン（印なし・required）・時刻不明は不可', () => {
    expect(canBootstrapPasskey({ ...base, policy: 'step_up' }, NOW)).toBe(false);
    expect(canBootstrapPasskey({ ...base, policy: 'always' }, NOW)).toBe(false);
    expect(canBootstrapPasskey({ ...base, passkeyCount: 1 }, NOW)).toBe(false);
    expect(canBootstrapPasskey({ ...base, mfaMethod: null }, NOW)).toBe(false);
    expect(canBootstrapPasskey({ ...base, mfaMethod: 'required' }, NOW)).toBe(false);
    expect(canBootstrapPasskey({ ...base, sessionCreatedAt: null }, NOW)).toBe(false);
    expect(canBootstrapPasskey({ ...base, sessionCreatedAt: new Date(NOW + HOUR).toISOString() }, NOW)).toBe(false);
  });
});

describe('masterCanChangeMfaPolicy（マスタは厳しくする方向だけ）', () => {
  it('step_up → always だけ', () => {
    expect(masterCanChangeMfaPolicy('step_up', 'always')).toBe(true);
    expect(masterCanChangeMfaPolicy('always', 'step_up')).toBe(false);
    expect(masterCanChangeMfaPolicy('step_up', 'passkey_only')).toBe(false);
    expect(masterCanChangeMfaPolicy('passkey_only', 'always')).toBe(false);
    expect(masterCanChangeMfaPolicy('always', 'always')).toBe(false);
  });
});

describe('passkey_only の関所（S6）', () => {
  it('パスキーで通した aal2 だけを認める（方針を変える前のメールの aal2 は数えない）', () => {
    expect(portalMfaGate({ aal: 2, mfaAt: ago(MIN), mfaMethod: 'passkey' }, 'passkey_only', NOW)).toBe(false);
    expect(portalMfaGate({ aal: 2, mfaAt: ago(MIN), mfaMethod: 'email' }, 'passkey_only', NOW)).toBe(true);
    expect(portalMfaGate({ aal: 2, mfaAt: ago(13 * HOUR), mfaMethod: 'passkey' }, 'passkey_only', NOW)).toBe(true);
    expect(portalMfaGate({ aal: 1, mfaMethod: MFA_SETUP_MARK }, 'passkey_only', NOW)).toBe(true);
    expect(portalMfaGate({ aal: 1, mfaMethod: MFA_SETUP_MARK }, 'step_up', NOW)).toBe(false);
    expect(portalMfaGate({ preview: true }, 'passkey_only', NOW)).toBe(false);
  });
  it('使える方法: passkey_only はパスキーだけ（プレビューでは 0 を渡す＝方法なし）', () => {
    expect(mfaMethodsFor('passkey_only', { email: 'a@example.com' }, 2)).toEqual(['passkey']);
    expect(mfaMethodsFor('passkey_only', { email: 'a@example.com' }, 0)).toEqual([]);
    expect(mfaMethodsFor('step_up', { email: null }, 1)).toEqual(['passkey']);
  });
});

describe('canResetMfa（マスタが子ユーザーの第2要素をリセット）', () => {
  const master = { id: 'm1', partner_id: 'p1', is_master: true, is_active: true };
  it('同じ取引先の子ユーザーだけ', () => {
    expect(canResetMfa(master, { id: 'c1', partner_id: 'p1', is_master: false })).toBe(true);
    expect(canResetMfa(master, { id: 'c2', partner_id: 'p2', is_master: false })).toBe(false);
    expect(canResetMfa(master, { id: 'm2', partner_id: 'p1', is_master: true })).toBe(false);
    expect(canResetMfa(master, master)).toBe(false);
    expect(canResetMfa({ ...master, is_master: false }, { id: 'c1', partner_id: 'p1', is_master: false })).toBe(false);
    expect(canResetMfa({ ...master, is_active: false }, { id: 'c1', partner_id: 'p1', is_master: false })).toBe(false);
  });
});

describe('loginChallengeMatches（ログイン用チャレンジの持ち主）', () => {
  it('account_id が null で partner_id が限定URLの取引先のものだけ', () => {
    expect(loginChallengeMatches({ account_id: null, partner_id: 'p1' }, 'p1')).toBe(true);
    expect(loginChallengeMatches({ account_id: null, partner_id: 'p2' }, 'p1')).toBe(false);
    // 本人用（登録・本人確認）のチャレンジはログインに使わせない
    expect(loginChallengeMatches({ account_id: 'a1', partner_id: null }, 'p1')).toBe(false);
    expect(loginChallengeMatches({ account_id: 'a1', partner_id: 'p1' }, 'p1')).toBe(false);
    expect(loginChallengeMatches({ account_id: null, partner_id: null }, 'p1')).toBe(false);
    expect(loginChallengeMatches(null, 'p1')).toBe(false);
    expect(loginChallengeMatches({ account_id: null, partner_id: '' }, '')).toBe(false);
  });
});

describe('文言', () => {
  it('方針ごとの説明があり、「1人1ID」の案内に要点が入っている', () => {
    for (const p of PARTNER_MFA_POLICIES) expect(PARTNER_MFA_POLICY_HELP[p]).toBeTruthy();
    expect(ONE_PERSON_ONE_ID_NOTICE).toContain('1 人につき 1 つ');
    expect(ONE_PERSON_ONE_ID_NOTICE).toContain('ユーザー管理');
  });
  it('isCredentialId: base64url の形だけ', () => {
    expect(isCredentialId('AbCdEfGhIjKlMnOp_-12')).toBe(true);
    expect(isCredentialId('short')).toBe(false);
    expect(isCredentialId('has space aaaaaaaaaaaa')).toBe(false);
    expect(isCredentialId(123)).toBe(false);
  });
  it('passkeyErrorMessage: 取りやめ・登録済み・その他', () => {
    expect(passkeyErrorMessage({ name: 'NotAllowedError' }, 'auth')).toContain('取りやめ');
    expect(passkeyErrorMessage({ name: 'InvalidStateError' }, 'register')).toContain('既に登録');
    expect(passkeyErrorMessage({ code: 'ERROR_INVALID_RP_ID' }, 'auth')).toContain('アドレス');
    expect(passkeyErrorMessage(new Error('x'), 'register')).toBe('パスキーを登録できませんでした。');
  });
});
