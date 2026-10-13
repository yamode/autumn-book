// 取引先ページのアクセス制限（docs/partner-access-restriction.md）。取引先ごとの任意設定・既定はオフ。
//   ・許可するIP（rms_partners.access_allowed_ips）: IPv4 / IPv6 / CIDR。空なら IP の制限なし
//   ・国外を拒否（rms_partners.access_block_foreign）: Cloudflare の国判定が JP 以外なら拒否（判定できないときも拒否）
// サーバ・管理画面の両方から使う（入力の検査と、接続元の判定）。

export const ACCESS_ALLOWED_IPS_MAX = 50;

/** 拒否したときに取引先へ出す文言（どの条件で拒否したかは出さない） */
export const ACCESS_DENIED_MESSAGE =
  'このページは、許可された場所からのみご利用いただけます。社外・海外から開いている場合は、許可されたネットワーク（社内・VPN など）からお試しください。ご不明な点はご担当の宿へお問い合わせください。';

type Parsed = { v: 4 | 6; value: bigint };
type Range = { v: 4 | 6; base: bigint; prefix: number };

function parseV4(s: string): bigint | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let n = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const x = Number(p);
    if (x > 255) return null;
    n = (n << 8n) | BigInt(x);
  }
  return n;
}

function parseV6(input: string): bigint | null {
  let s = input.toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // 末尾が IPv4 の書き方（::ffff:192.0.2.1 など）
  let tail: bigint | null = null;
  const lastColon = s.lastIndexOf(':');
  if (s.includes('.')) {
    tail = parseV4(s.slice(lastColon + 1));
    if (tail === null) return null;
    s = `${s.slice(0, lastColon + 1)}${(tail >> 16n).toString(16)}:${(tail & 0xffffn).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill('0'), ...rest] : head;
  if (groups.length !== 8 || (halves.length === 2 && head.length + rest.length > 7)) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

/** IP アドレスを数にする。IPv4 を埋め込んだ IPv6（::ffff:a.b.c.d）は IPv4 として扱う */
export function parseIp(raw: string | null | undefined): Parsed | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (!s.includes(':')) {
    const v4 = parseV4(s);
    return v4 === null ? null : { v: 4, value: v4 };
  }
  const v6 = parseV6(s);
  if (v6 === null) return null;
  if (v6 >> 32n === 0xffffn) return { v: 4, value: v6 & 0xffffffffn };
  return { v: 6, value: v6 };
}

/** 許可の1行（IP または CIDR）を範囲にする。書き方が違えば null */
export function parseRange(raw: string): Range | null {
  const s = raw.trim();
  const slash = s.indexOf('/');
  const ip = parseIp(slash >= 0 ? s.slice(0, slash) : s);
  if (!ip) return null;
  const bits = ip.v === 4 ? 32 : 128;
  let prefix = bits;
  if (slash >= 0) {
    const p = s.slice(slash + 1);
    if (!/^\d{1,3}$/.test(p)) return null;
    prefix = Number(p);
    // 範囲が広すぎるもの（IPv4 /8 未満・IPv6 /16 未満）は誤入力とみなす
    if (prefix > bits || prefix < (ip.v === 4 ? 8 : 16)) return null;
  }
  const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return { v: ip.v, base: ip.value & mask, prefix };
}

function inRange(ip: Parsed, r: Range): boolean {
  if (ip.v !== r.v) return false;
  const bits = r.v === 4 ? 32 : 128;
  const mask = r.prefix === 0 ? 0n : ((1n << BigInt(r.prefix)) - 1n) << BigInt(bits - r.prefix);
  return (ip.value & mask) === r.base;
}

/** 保存した1件（「IP」または「IP # メモ」）から IP / CIDR の部分を取り出す */
export const allowEntryAddress = (entry: string) => entry.replace(/#.*$/, '').trim();

/**
 * 管理画面の入力（改行・カンマ・空白区切り。# 以降はメモ）を検査して、保存する一覧にする。
 * メモは同じ行の各 IP に「IP # メモ」の形で残す。IP の重複は除く。書き方の違うものは errors に返す（保存しない）
 */
export function parseAllowList(text: string): { entries: string[]; errors: string[] } {
  const entries: string[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const hash = line.indexOf('#');
    const body = hash >= 0 ? line.slice(0, hash) : line;
    const memo = hash >= 0 ? line.slice(hash + 1).trim().slice(0, 60) : '';
    for (const token of body.split(/[\s,、]+/).map((t) => t.trim()).filter(Boolean)) {
      if (!parseRange(token)) errors.push(token);
      else if (!seen.has(token)) {
        seen.add(token);
        entries.push(memo ? `${token} # ${memo}` : token);
      }
    }
  }
  if (entries.length > ACCESS_ALLOWED_IPS_MAX) errors.push(`登録できるのは ${ACCESS_ALLOWED_IPS_MAX} 件までです`);
  return { entries, errors };
}

/** 接続元 IP が許可の一覧に入るか（一覧が空なら常に true） */
export function ipAllowed(ip: string | null | undefined, allowList: readonly string[]): boolean {
  if (!allowList.length) return true;
  const parsed = parseIp(ip);
  if (!parsed) return false;
  return allowList.some((entry) => {
    const r = parseRange(allowEntryAddress(entry));
    return r ? inRange(parsed, r) : false;
  });
}

export type AccessRestriction = { allowedIps: readonly string[]; blockForeign: boolean };
export type AccessDenial = 'ip' | 'country' | null;

/**
 * 取引先ページに入れるか。拒否の理由（ログ用）を返す。null なら入れる。
 * country は Cloudflare の 2 文字（判定できないときは null・'XX'）。allowUnknownCountry はローカル開発（Cloudflare を通らない）用
 */
export function accessDenial(
  r: AccessRestriction,
  req: { ip: string | null | undefined; country: string | null | undefined },
  opts: { allowUnknownCountry?: boolean } = {}
): AccessDenial {
  if (r.blockForeign) {
    const c = String(req.country ?? '').toUpperCase();
    const unknown = !c || c === 'XX';
    if (unknown ? !opts.allowUnknownCountry : c !== 'JP') return 'country';
  }
  if (!ipAllowed(req.ip, r.allowedIps)) return 'ip';
  return null;
}

/** 制限が掛かっているか（管理画面の表示用） */
export const accessRestricted = (r: AccessRestriction) => r.blockForeign || r.allowedIps.length > 0;
