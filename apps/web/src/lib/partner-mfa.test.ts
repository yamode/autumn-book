import { describe, expect, it } from 'vitest';
import {
  generateOtp,
  isAal2Valid,
  loginStepUpReason,
  maskEmail,
  MFA_AAL2_HOURS,
  MFA_PENDING_MARK,
  mfaMethodsFor,
  normalizeMfaPolicy,
  normalizeOtp,
  otpChallengeState,
  otpProblem,
  otpResendWaitSeconds,
  portalMfaGate,
  portalMfaUrl,
  safePortalNext,
  timingSafeEqualText
} from './partner-mfa';

const NOW = Date.parse('2026-10-10T03:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 3600_000;

describe('normalizeMfaPolicy', () => {
  it('不明・null は step_up（M6）', () => {
    expect(normalizeMfaPolicy(null)).toBe('step_up');
    expect(normalizeMfaPolicy('xxx')).toBe('step_up');
    expect(normalizeMfaPolicy('always')).toBe('always');
    expect(normalizeMfaPolicy('passkey_only')).toBe('passkey_only');
  });
});

describe('isAal2Valid（mfa_at から 12 時間）', () => {
  it('aal=2 で 12 時間以内なら有効', () => {
    expect(isAal2Valid({ aal: 2, mfaAt: ago(11 * HOUR) }, NOW)).toBe(true);
  });
  it('12 時間を過ぎたら無効', () => {
    expect(isAal2Valid({ aal: 2, mfaAt: ago(MFA_AAL2_HOURS * HOUR) }, NOW)).toBe(false);
  });
  it('aal=1・mfa_at 無し・壊れた値・遠い未来は無効', () => {
    expect(isAal2Valid({ aal: 1, mfaAt: ago(MIN) }, NOW)).toBe(false);
    expect(isAal2Valid({ aal: 2, mfaAt: null }, NOW)).toBe(false);
    expect(isAal2Valid({ aal: 2, mfaAt: 'x' }, NOW)).toBe(false);
    expect(isAal2Valid({ aal: 2, mfaAt: new Date(NOW + HOUR).toISOString() }, NOW)).toBe(false);
  });
});

describe('portalMfaGate（取引先ページ全体の関所）', () => {
  it('step_up: ログイン直後の印があるときだけ止める', () => {
    expect(portalMfaGate({ aal: 1, mfaMethod: null }, 'step_up', NOW)).toBe(false);
    expect(portalMfaGate({ aal: 1, mfaMethod: MFA_PENDING_MARK }, 'step_up', NOW)).toBe(true);
    expect(portalMfaGate({ aal: 2, mfaAt: ago(MIN), mfaMethod: 'email' }, 'step_up', NOW)).toBe(false);
  });
  it('step_up: aal2 が切れても（印が無ければ）止めない＝操作の直前に求める', () => {
    expect(portalMfaGate({ aal: 2, mfaAt: ago(13 * HOUR), mfaMethod: 'email' }, 'step_up', NOW)).toBe(false);
  });
  it('always: aal2 が有効でなければ止める（12 時間で再び）', () => {
    expect(portalMfaGate({ aal: 1 }, 'always', NOW)).toBe(true);
    expect(portalMfaGate({ aal: 2, mfaAt: ago(MIN), mfaMethod: 'email' }, 'always', NOW)).toBe(false);
    expect(portalMfaGate({ aal: 2, mfaAt: ago(13 * HOUR), mfaMethod: 'email' }, 'always', NOW)).toBe(true);
  });
  it('確認モードは止めない', () => {
    expect(portalMfaGate({ preview: true, mfaMethod: MFA_PENDING_MARK }, 'always', NOW)).toBe(false);
  });
});

describe('loginStepUpReason（§6.2）', () => {
  const base = { policy: 'step_up' as const, newEnvironment: false, hasEmail: true, lastMfaAt: ago(HOUR) };
  it('いつもの環境・最近確認済みなら求めない', () => {
    expect(loginStepUpReason(base, NOW)).toBeNull();
  });
  it('新しい環境（メールあり）なら求める', () => {
    expect(loginStepUpReason({ ...base, newEnvironment: true }, NOW)).toBe('new_environment');
  });
  it('メールが無ければ新しい環境でも求めない（通知だけ）', () => {
    expect(loginStepUpReason({ ...base, newEnvironment: true, hasEmail: false }, NOW)).toBeNull();
  });
  it('前回の本人確認から 30 日以上なら求める。一度も無いのは数えない', () => {
    expect(loginStepUpReason({ ...base, lastMfaAt: ago(30 * 24 * HOUR) }, NOW)).toBe('reverify');
    expect(loginStepUpReason({ ...base, lastMfaAt: ago(29 * 24 * HOUR) }, NOW)).toBeNull();
    expect(loginStepUpReason({ ...base, lastMfaAt: null }, NOW)).toBeNull();
  });
  it('always / passkey_only は毎回（メールが無くても）', () => {
    expect(loginStepUpReason({ ...base, policy: 'always' }, NOW)).toBe('always');
    expect(loginStepUpReason({ ...base, policy: 'always', hasEmail: false }, NOW)).toBe('always');
    expect(loginStepUpReason({ ...base, policy: 'passkey_only' }, NOW)).toBe('always');
  });
});

describe('mfaMethodsFor', () => {
  it('メールがあればメール。passkey_only はメールに落とさない', () => {
    expect(mfaMethodsFor('step_up', { email: 'a@example.com' })).toEqual(['email']);
    expect(mfaMethodsFor('step_up', { email: '' })).toEqual([]);
    expect(mfaMethodsFor('passkey_only', { email: 'a@example.com' })).toEqual([]);
    expect(mfaMethodsFor('passkey_only', { email: 'a@example.com' }, 1)).toEqual(['passkey']);
    expect(mfaMethodsFor('always', { email: 'a@example.com' }, 2)).toEqual(['passkey', 'email']);
  });
});

describe('コードの生成と入力', () => {
  it('6 桁・先頭 0 を残す', () => {
    expect(generateOtp(() => 42)).toBe('000042');
    expect(generateOtp(() => 999_999)).toBe('999999');
    expect(generateOtp()).toMatch(/^\d{6}$/);
  });
  it('偏りの出る範囲（2^32 の端）は引き直す', () => {
    const seq = [0xffff_ffff, 7];
    expect(generateOtp(() => seq.shift()!)).toBe('000007');
  });
  it('全角・空白・ハイフンを許して揃える', () => {
    expect(normalizeOtp('１２３ ４５６')).toBe('123456');
    expect(normalizeOtp('123-456')).toBe('123456');
    expect(normalizeOtp('12345')).toBeNull();
    expect(normalizeOtp('abcdef')).toBeNull();
    expect(otpProblem('')).toMatch(/入力/);
    expect(otpProblem('12')).toMatch(/6桁/);
    expect(otpProblem('012345')).toBeNull();
  });
  it('timingSafeEqualText は長さ違い・1 文字違いを false', () => {
    expect(timingSafeEqualText('abc', 'abc')).toBe(true);
    expect(timingSafeEqualText('abc', 'abd')).toBe(false);
    expect(timingSafeEqualText('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualText('', '')).toBe(true);
  });
});

describe('otpResendWaitSeconds（再送は 60 秒に 1 回・1 時間に 5 通）', () => {
  const c = (createdAgoMs: number, extra: { attempts?: number; used_at?: string | null; expires_at?: string } = {}) => ({
    created_at: ago(createdAgoMs),
    expires_at: extra.expires_at ?? new Date(NOW - createdAgoMs + 10 * MIN).toISOString(),
    attempts: extra.attempts ?? 0,
    used_at: extra.used_at ?? null
  });
  it('初めては 0', () => {
    expect(otpResendWaitSeconds([], NOW)).toBe(0);
  });
  it('最後の送信から 60 秒', () => {
    expect(otpResendWaitSeconds([c(20_000)], NOW)).toBe(40);
    expect(otpResendWaitSeconds([c(61_000)], NOW)).toBe(0);
  });
  it('1 時間に 5 通を超えない（一番古いものが 1 時間を過ぎるまで）', () => {
    const list = [c(2 * MIN), c(10 * MIN), c(20 * MIN), c(30 * MIN), c(50 * MIN)];
    expect(otpResendWaitSeconds(list, NOW)).toBe(10 * 60);
    expect(otpResendWaitSeconds(list.slice(0, 4), NOW)).toBe(0);
  });
  it('試行の上限で止めたものは、止めてから 60 秒', () => {
    const locked = c(5 * MIN, { attempts: 5, expires_at: ago(30_000) });
    expect(otpResendWaitSeconds([locked], NOW)).toBe(30);
  });
});

describe('otpChallengeState', () => {
  const base = { created_at: ago(MIN), expires_at: new Date(NOW + 9 * MIN).toISOString(), attempts: 0, used_at: null };
  it('状態を見分ける', () => {
    expect(otpChallengeState(null, NOW)).toBe('none');
    expect(otpChallengeState(base, NOW)).toBe('open');
    expect(otpChallengeState({ ...base, used_at: ago(1) }, NOW)).toBe('used');
    expect(otpChallengeState({ ...base, attempts: 5 }, NOW)).toBe('locked');
    expect(otpChallengeState({ ...base, expires_at: ago(1) }, NOW)).toBe('expired');
  });
});

describe('maskEmail', () => {
  it('頭 2 文字とドメインだけ残す', () => {
    expect(maskEmail('abcdef@example.com')).toBe('ab***@example.com');
    expect(maskEmail('a@example.com')).toBe('a***@example.com');
    expect(maskEmail('')).toBe('');
    expect(maskEmail(null)).toBe('');
  });
});

describe('safePortalNext（オープンリダイレクトにしない）', () => {
  const T = 'tok123';
  it('同じトークンの中のパスはクエリごと残す', () => {
    expect(safePortalNext(T, '/p/tok123/book?plan=a&room=b')).toBe('/p/tok123/book?plan=a&room=b');
    expect(safePortalNext(T, '/p/tok123/account/cards')).toBe('/p/tok123/account/cards');
  });
  it('外部・スキーム相対・別トークン・不正は料金カレンダーへ', () => {
    const bad = ['https://evil.example/p/tok123/x', '//evil.example/p/tok123/x', '/p/other/calendar', '/p/tok1234/calendar', '/\\evil', 'javascript:alert(1)', '', null, '/p/tok123'];
    for (const b of bad) expect(safePortalNext(T, b)).toBe('/p/tok123/calendar');
  });
  it('/mfa 自身・ログアウト・設定へは戻さない', () => {
    expect(safePortalNext(T, '/p/tok123/mfa?next=x')).toBe('/p/tok123/calendar');
    expect(safePortalNext(T, '/p/tok123/logout')).toBe('/p/tok123/calendar');
    expect(safePortalNext(T, '/p/tok123/setup?token=x')).toBe('/p/tok123/calendar');
  });
  it('portalMfaUrl は next を検証してから付ける', () => {
    expect(portalMfaUrl(T, '/p/tok123/account/users')).toBe('/p/tok123/mfa?next=%2Fp%2Ftok123%2Faccount%2Fusers');
    expect(portalMfaUrl(T, 'https://evil.example')).toBe('/p/tok123/mfa?next=%2Fp%2Ftok123%2Fcalendar');
  });
});
