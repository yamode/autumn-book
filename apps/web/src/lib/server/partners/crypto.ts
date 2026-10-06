// 取引先ポータル用の乱数トークン・ハッシュ・パスワード（Cloudflare Workers の WebCrypto で動く形）。
//
// パスワードは PBKDF2-SHA256。Workers の PBKDF2 は反復回数の上限が 100,000 なので、その上限で使う。
// 形式: pbkdf2$<iterations>$<salt base64url>$<hash base64url>
const PBKDF2_ITERATIONS = 100_000;
const HASH_BYTES = 32;

const enc = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// 読み間違えにくい小文字英数（l, o, 0, 1 を除く）でログインIDの接尾辞などを作る。
const FRIENDLY = 'abcdefghijkmnpqrstuvwxyz23456789';
export function friendlyId(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => FRIENDLY[b % FRIENDLY.length]).join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    HASH_BYTES * 8
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${base64url(salt)}$${base64url(hash)}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ハッシュが無い（未設定・該当なし）ときもダミーで同じ計算をして、応答時間でアカウントの有無が漏れないようにする。
const DUMMY_HASH = `pbkdf2$${PBKDF2_ITERATIONS}$${'A'.repeat(22)}$${'A'.repeat(43)}`;
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const [scheme, iterRaw, saltRaw, hashRaw] = (stored || DUMMY_HASH).split('$');
  const iterations = Number(iterRaw);
  if (scheme !== 'pbkdf2' || !Number.isInteger(iterations) || iterations <= 0 || iterations > PBKDF2_ITERATIONS) return false;
  const expected = fromBase64url(hashRaw ?? '');
  const actual = await pbkdf2(password, fromBase64url(saltRaw ?? ''), iterations);
  return Boolean(stored) && timingSafeEqual(actual, expected);
}

// パスワードの最低条件。取引先が自分で決めるので、長さだけを強く要求する。
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'パスワードは10文字以上にしてください。';
  if (password.length > 200) return 'パスワードが長すぎます。';
  if (/^(.)\1+$/.test(password)) return '同じ文字だけのパスワードは使えません。';
  return null;
}
