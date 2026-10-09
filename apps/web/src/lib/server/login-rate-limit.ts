// ログイン・認証コード送信の試行レート制限（docs/auth-hardening.md §4.1・§8・S2）。
//
// claim-rate-limit.ts（手入力コード）の流儀をそのまま汎用化したもの。claim-rate-limit.ts 自体は触らない（回帰を避ける）。
//   - 置き場は KV（AB_RATE バインド）。edge をまたいで共有・永続する。結果整合なので同時に走った数回は取りこぼすが、
//     総当たりのような多数回の試行は確実に頭打ちになる。
//   - KV が無い環境（vite dev・vitest）はプロセス内メモリに落ちる。
//   - KV が読めない・書けないときは通す（お客様・取引先を締め出さない側に倒す。Cloudflare の Rate Limiting ルール〔§12.2〕が二重化）。
//
// 数え方は固定窓: 窓の最初の記録から windowSec の間に max 回に届いたらロックする。
//   - lockSec あり: 届いた時点から lockSec 秒ロック（ログインの失敗）
//   - lockSec なし: 窓の終わりまでロック（認証コードの送信数。「1 時間に 5 通」を素直に表す）
type Platform = App.Platform | undefined;

// 使うのは get / put だけ（claim-rate-limit.ts と同じ理由で自前の最小型で受ける）
type KvLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

export type RateRule = {
  /** KV のキーの頭（ルールごとに分ける） */
  prefix: string;
  /** 窓の中で何回でロックするか */
  max: number;
  /** 窓の長さ（秒） */
  windowSec: number;
  /** ロックの長さ（秒）。無ければ窓の終わりまで */
  lockSec?: number;
};

/** 失敗・送信の上限（§4.1・§8 の表） */
export const RATE_RULES = {
  /** 取引先ログイン: 1 IP × 限定URL（ID を変えても止まる） */
  partnerIp: { prefix: 'login_rate:partner_ip:', max: 10, windowSec: 600, lockSec: 900 },
  /** 取引先ログイン: 限定URL 全体（分散 IP からの集中） */
  partner: { prefix: 'login_rate:partner:', max: 60, windowSec: 600, lockSec: 900 },
  /** パスキーでのログインの準備（チャレンジの発行）: 1 IP × 取引先あたり 10 分 30 回（表に行を作るので数を絞る・S6） */
  passkeyLoginOptionsIp: { prefix: 'login_rate:passkey_opts_ip:', max: 30, windowSec: 600 },
  /** パスワード設定リンク: 1 IP × 限定URL */
  setupIp: { prefix: 'login_rate:setup_ip:', max: 10, windowSec: 600, lockSec: 900 },
  /** 管理ログイン: 1 IP */
  adminIp: { prefix: 'login_rate:admin_ip:', max: 10, windowSec: 600, lockSec: 900 },
  /** 会員の認証コード送信: 1 IP あたり 10 分 10 通 */
  memberOtpIp: { prefix: 'login_rate:member_otp_ip:', max: 10, windowSec: 600 },
  /** 会員の認証コード送信: 1 メールあたり 1 時間 5 通 */
  memberOtpEmail: { prefix: 'login_rate:member_otp_email:', max: 5, windowSec: 3600 },
  /** 会員の認証コード送信: 全体で 10 分 300 通（送信基盤の保護） */
  memberOtpGlobal: { prefix: 'login_rate:member_otp_global:', max: 300, windowSec: 600 },
  /** 会員の認証コードの検証失敗: 1 メールあたり 10 分 10 回 */
  memberOtpVerify: { prefix: 'login_rate:member_otp_verify:', max: 10, windowSec: 600, lockSec: 600 }
} as const satisfies Record<string, RateRule>;

export type RateRecord = { count: number; windowStart: number; lockedUntil: number };

const EMPTY: RateRecord = { count: 0, windowStart: 0, lockedUntil: 0 };

/** ロック中なら残り秒、そうでなければ 0（純関数） */
export function lockRemainingSec(rec: RateRecord | null, now: number): number {
  if (!rec || rec.lockedUntil <= now) return 0;
  return Math.ceil((rec.lockedUntil - now) / 1000);
}

/** 1 回数えた後の記録（純関数）。窓が過ぎていれば数え直す。上限に届いたらロックして数を 0 に戻す */
export function applyHit(rec: RateRecord | null, rule: RateRule, now: number): RateRecord {
  const cur = rec ?? EMPTY;
  const inWindow = cur.windowStart > 0 && now - cur.windowStart < rule.windowSec * 1000;
  const windowStart = inWindow ? cur.windowStart : now;
  const count = (inWindow ? cur.count : 0) + 1;
  if (count >= rule.max) {
    const lockedUntil = rule.lockSec != null ? now + rule.lockSec * 1000 : windowStart + rule.windowSec * 1000;
    return { count: 0, windowStart: 0, lockedUntil: Math.max(lockedUntil, cur.lockedUntil) };
  }
  return { count, windowStart, lockedUntil: cur.lockedUntil };
}

/** KV に残す長さ（秒）。KV の TTL 下限 60 秒を守る（純関数） */
export function recordTtlSec(rec: RateRecord, rule: RateRule, now: number): number {
  const until = Math.max(rec.lockedUntil, rec.windowStart ? rec.windowStart + rule.windowSec * 1000 : 0);
  return Math.max(60, Math.ceil((until - now) / 1000));
}

// KV が無い環境用（vite dev・テスト）
const memory = new Map<string, RateRecord>();

function kv(platform: Platform): KvLike | null {
  return (platform?.env?.AB_RATE as unknown as KvLike | undefined) ?? null;
}

async function read(platform: Platform, fullKey: string): Promise<RateRecord | null> {
  const ns = kv(platform);
  if (!ns) return memory.get(fullKey) ?? null;
  try {
    const raw = await ns.get(fullKey);
    return raw ? (JSON.parse(raw) as RateRecord) : null;
  } catch {
    return null; // 読めないときは通す
  }
}

async function write(platform: Platform, fullKey: string, rec: RateRecord, ttlSec: number): Promise<void> {
  const ns = kv(platform);
  if (!ns) {
    memory.set(fullKey, rec);
    return;
  }
  try {
    await ns.put(fullKey, JSON.stringify(rec), { expirationTtl: Math.max(60, ttlSec) });
  } catch {
    /* 記録できなくても認証そのものは進める */
  }
}

/** ロック中か。locked=true なら残り秒 retryInSec を返す */
export async function rateCheck(platform: Platform, rule: RateRule, key: string): Promise<{ locked: boolean; retryInSec: number }> {
  const retryInSec = lockRemainingSec(await read(platform, rule.prefix + key), Date.now());
  return { locked: retryInSec > 0, retryInSec };
}

/** 1 回数える（ログインの失敗・認証コードの送信） */
export async function rateHit(platform: Platform, rule: RateRule, key: string): Promise<void> {
  const now = Date.now();
  const next = applyHit(await read(platform, rule.prefix + key), rule, now);
  await write(platform, rule.prefix + key, next, recordTtlSec(next, rule, now));
}

/**
 * 成功したら数えをやめる（ロック中はそのまま）。
 * KV では消さずに空の記録を短い TTL で上書きする（claim-rate-limit.ts と同じ）。
 */
export async function rateReset(platform: Platform, rule: RateRule, key: string): Promise<void> {
  const ns = kv(platform);
  if (!ns) {
    const cur = memory.get(rule.prefix + key);
    if (cur && cur.lockedUntil > Date.now()) return;
    memory.delete(rule.prefix + key);
    return;
  }
  await write(platform, rule.prefix + key, { ...EMPTY }, 60);
}

/** テスト用: メモリの記録を空にする */
export function clearRateMemory() {
  memory.clear();
}

/** IP が取れないときのキー（1 つのキーとして扱う・§4.1） */
export const ipKey = (ip: string | null | undefined) => (ip && ip.trim() ? ip.trim().slice(0, 64) : 'unknown');

/** メールアドレスなどをキーにするときのハッシュ（KV に生の値を残さない）。小文字・前後空白なしで揃える */
export async function hashKeyPart(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** 接続元 IP（cf-connecting-ip → x-forwarded-for の先頭）。partners/portal.ts の requestMeta と同じ取り方 */
export function clientIp(request: Request): string | null {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

// ---- 会員の認証コード（docs/auth-hardening.md §8） ----
// 送信: 1 IP 10 分 10 通・1 メール 1 時間 5 通・全体 10 分 300 通。どれかに届いていたら送らない（未登録メールでも同じ応答）。
// 検証: 1 メール 10 分 10 回の失敗で 10 分止める（Supabase 側の試行上限に加えて）。

/** 認証コードを送ってよいか。よければ 3 つの数えを 1 つ進めて true（送信の成否によらず数える） */
export async function memberOtpSendAllowed(platform: Platform, email: string, ip: string | null): Promise<boolean> {
  const emailKey = await hashKeyPart(email);
  const keys: [RateRule, string][] = [
    [RATE_RULES.memberOtpIp, ipKey(ip)],
    [RATE_RULES.memberOtpEmail, emailKey],
    [RATE_RULES.memberOtpGlobal, 'all']
  ];
  const checks = await Promise.all(keys.map(([rule, key]) => rateCheck(platform, rule, key)));
  if (checks.some((c) => c.locked)) return false;
  await Promise.all(keys.map(([rule, key]) => rateHit(platform, rule, key)));
  return true;
}

/** 認証コードの検証を止めているか */
export async function memberOtpVerifyLocked(platform: Platform, email: string): Promise<boolean> {
  return (await rateCheck(platform, RATE_RULES.memberOtpVerify, await hashKeyPart(email))).locked;
}

/** 認証コードの検証の結果を数える（失敗は数え、成功は数えをやめる） */
export async function memberOtpVerifyResult(platform: Platform, email: string, ok: boolean): Promise<void> {
  const key = await hashKeyPart(email);
  if (ok) await rateReset(platform, RATE_RULES.memberOtpVerify, key);
  else await rateHit(platform, RATE_RULES.memberOtpVerify, key);
}
