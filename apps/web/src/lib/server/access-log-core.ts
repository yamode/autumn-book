// ★ autumn-shared/src/security/access-log.ts の写し（2026-10-22）。autumn-book は autumn-shared のライブラリを取り込まないため、
//   ここに置く。中身を直すときは autumn-shared 側と autumn-order（sveltekit/src/lib/server/access-log-core.ts）も直すこと。
// 管理画面のアクセスログ（core.access_logs・autumn-shared 20261022012021）。PMS・RMS・Order が使う。
// Book はこのライブラリを取り込まないため、autumn-book/apps/web/src/lib/server/access-log.ts に同じ実装を置いている
// （直すときは両方を直すこと）。
//
// 使い方（hooks.server.ts）:
//   const res = await resolve(event);
//   recordAccess(event, { app: 'pms', user, tenantId, facility, status: res.status }, cfg);
//   return res;
// 書き込みは応答を待たせない（Cloudflare の waitUntil に載せる）。失敗しても画面は止めない（ログに出すだけ）。
//
// 利用者の IP・国・接続元は Cloudflare がアプリのサーバへ届けた情報（cf-connecting-ip・request.cf）から取る。
// Supabase 標準のログでは Cloudflare のサーバの値になってしまうため、ここで取るしかない。

export type AccessApp = 'pms' | 'rms' | 'order' | 'book';
export type AccessEvent = 'page' | 'action' | 'api' | 'login_success' | 'login_failure' | 'logout' | 'denied';

export interface AccessLogConfig {
  supabaseUrl: string | undefined;
  serviceRoleKey: string | undefined;
}

export interface AccessLogInput {
  app: AccessApp;
  /** 省略時は method・path・status から決める（classifyRequest） */
  event?: AccessEvent;
  user?: { id: string; email?: string | null } | null;
  /** ログイン失敗のときに入力されたメール */
  email?: string | null;
  tenantId?: string | null;
  facility?: string | null;
  status?: number;
  detail?: Record<string, unknown> | null;
}

type EventLike = {
  request: Request;
  url: URL;
  platform?: unknown;
};

type CfInfo = {
  country?: string;
  region?: string;
  city?: string;
  asn?: number;
  asOrganization?: string;
};

/** method・path・status からイベントの種類を決める。記録しないもの（静的ファイル等）は null */
export function classifyRequest(method: string, pathname: string, status: number): AccessEvent | null {
  if (pathname.startsWith('/_app/') || pathname.startsWith('/favicon') || /\.(?:png|jpe?g|svg|ico|webp|avif|css|js|map|woff2?|txt)$/i.test(pathname)) {
    return null;
  }
  if (status === 401 || status === 403) return 'denied';
  const isApi = pathname.startsWith('/api/');
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    // 読み取りの API は量が多い（画面の定期更新など）ので、失敗したものだけ残す
    if (isApi) return status >= 400 ? 'api' : null;
    return 'page';
  }
  return isApi ? 'api' : 'action';
}

/** User-Agent から端末の種類・OS・ブラウザをざっくり取る（ライブラリは使わない） */
export function parseUserAgent(ua: string | null | undefined): { device: string; os: string; browser: string } {
  const s = ua ?? '';
  if (!s) return { device: 'unknown', os: 'unknown', browser: 'unknown' };
  const bot = /bot|crawler|spider|curl|wget|python|go-http|httpclient|headless|axios|node-fetch|postman/i.test(s);
  const tablet = /ipad|tablet|(android(?!.*mobile))/i.test(s);
  const mobile = !tablet && /mobi|iphone|ipod|android/i.test(s);
  const device = bot ? 'bot' : tablet ? 'tablet' : mobile ? 'mobile' : 'pc';
  const os = /windows nt 10/i.test(s)
    ? 'Windows'
    : /windows/i.test(s)
      ? 'Windows（旧）'
      : /iphone|ipad|ipod/i.test(s)
        ? 'iOS'
        : /android/i.test(s)
          ? 'Android'
          : /mac os x|macintosh/i.test(s)
            ? 'macOS'
            : /cros/i.test(s)
              ? 'ChromeOS'
              : /linux/i.test(s)
                ? 'Linux'
                : 'unknown';
  const browser = /electron\//i.test(s)
    ? 'Electron（デスクトップアプリ）'
    : /edg\//i.test(s)
      ? 'Edge'
      : /opr\//i.test(s)
        ? 'Opera'
        : /line\//i.test(s)
          ? 'LINE'
          : /chrome\/|crios\//i.test(s)
            ? 'Chrome'
            : /firefox\/|fxios\//i.test(s)
              ? 'Firefox'
              : /safari\//i.test(s)
                ? 'Safari'
                : bot
                  ? 'bot'
                  : 'unknown';
  return { device, os, browser };
}

/** Cloudflare の接続元情報（adapter-cloudflare は platform.cf に入れる。無ければ request.cf） */
function cfOf(request: Request, platform: unknown): CfInfo {
  const cf = (platform as { cf?: CfInfo } | undefined)?.cf ?? (request as Request & { cf?: CfInfo }).cf;
  return cf && typeof cf === 'object' ? cf : {};
}

/** core.access_logs の 1 行（書き込み前） */
export function accessLogRow(event: EventLike, input: AccessLogInput): Record<string, unknown> | null {
  const { request, url } = event;
  const status = input.status ?? 200;
  const kind = input.event ?? classifyRequest(request.method, url.pathname, status);
  if (!kind) return null;
  const cf = cfOf(request, event.platform);
  const h = request.headers;
  const ua = h.get('user-agent');
  const parsed = parseUserAgent(ua);
  // __data.json（画面遷移のデータ要求）は画面の URL に戻して残す
  // URL のパスに載ったトークン（領収書 /r/<token> 等・20 文字以上の英数記号）は伏せる。
  // 予約などの UUID は「どのデータを見たか」を追うのに要るので残す。
  const path = (url.pathname.replace(/\/__data\.json$/, '') || '/').replace(/\/([A-Za-z0-9_-]{20,})(?=\/|$)/g, (m, seg: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ? m : '/:token'
  );
  return {
    app: input.app,
    event: kind,
    user_id: input.user?.id ?? null,
    email: (input.email ?? input.user?.email ?? null)?.toString().slice(0, 254) ?? null,
    tenant_id: input.tenantId ?? null,
    facility: input.facility ?? url.searchParams.get('facility') ?? null,
    method: request.method,
    path: path.slice(0, 300),
    status,
    ip: h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    country: cf.country ?? h.get('cf-ipcountry') ?? null,
    region: cf.region ?? null,
    city: cf.city ?? null,
    asn: typeof cf.asn === 'number' ? cf.asn : null,
    as_org: cf.asOrganization ?? null,
    user_agent: ua ? ua.slice(0, 400) : null,
    device: parsed.device,
    os: parsed.os,
    browser: parsed.browser,
    ray: h.get('cf-ray'),
    detail: input.detail ?? null
  };
}

type WaitCtx = { waitUntil?: (p: Promise<unknown>) => void };
/** Cloudflare の waitUntil（adapter-cloudflare v7 は platform.ctx・古い版は platform.context）。ctx に束縛して呼ぶ */
export function waitUntilOf(platform: unknown): ((p: Promise<unknown>) => void) | null {
  const pf = platform as { ctx?: WaitCtx; context?: WaitCtx } | undefined;
  const ctx = pf?.ctx?.waitUntil ? pf.ctx : pf?.context?.waitUntil ? pf.context : null;
  return ctx?.waitUntil ? ctx.waitUntil.bind(ctx) : null;
}

/** 1 行書く（応答を待たせない）。設定が無い環境（ローカル開発等）では何もしない */
export function recordAccess(event: EventLike, input: AccessLogInput, cfg: AccessLogConfig): void {
  const url = cfg.supabaseUrl?.replace(/\/$/, '');
  const key = cfg.serviceRoleKey;
  if (!url || !key) return;
  let row: Record<string, unknown> | null;
  try {
    row = accessLogRow(event, input);
  } catch {
    return;
  }
  if (!row) return;
  const p = fetch(`${url}/rest/v1/access_logs`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'content-profile': 'core',
      prefer: 'return=minimal'
    },
    body: JSON.stringify(row)
  })
    .then(async (r) => {
      if (!r.ok) console.warn('[access-log] 書き込み失敗', r.status, (await r.text().catch(() => '')).slice(0, 200));
    })
    .catch((e) => console.warn('[access-log] 書き込み失敗', e instanceof Error ? e.message : String(e)));
  const wait = waitUntilOf(event.platform);
  if (wait) wait(p);
}
