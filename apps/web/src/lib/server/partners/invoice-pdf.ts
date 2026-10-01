// 取引先の月次請求書（利用明細書＋適格請求書）の PDF 化。Cloudflare Browser Rendering の REST API（/browser-rendering/pdf）に
// 紙面の HTML（$lib/partner-invoice の renderInvoiceHtml）をそのまま渡す。autumn-pms の lib/server/freee/render-pdf.ts と同じ方式。
//
// なぜ REST か: 本番は Cloudflare Pages で、Pages Functions は browser バインディングを使えない。API トークンで fetch するだけの REST なら使える。
// なぜ HTML を渡すか: 紙面は1ファイル完結（CSS はインライン・画像なし）なので、URL を公開せずに済む。
// フォント: Browser Rendering に入っている日本語フォントは Noto CJK（ゴシック）。紙面は Google Fonts の Noto Sans JP を読むので、
//   waitUntil: networkidle0 で読み込みを待ってから焼く（display=block なので代替フォントで焼き付けない）。
//
// 【必要な環境変数（Cloudflare Pages の secret）】autumn-pms と同じ名前
//   - CLOUDFLARE_ACCOUNT_ID（無ければ CF_ACCOUNT_ID＝メール送信と同じアカウント ID を使う）
//   - CLOUDFLARE_BROWSER_RENDERING_TOKEN … 「Browser Rendering - Edit」権限の API トークン
// 未設定・失敗のときは null を返す（例外は投げない）。呼び出し側は HTML（印刷用）に切り替える。
import { env } from '$env/dynamic/private';
import { renderInvoiceHtml, type InvoiceDocument } from '$lib/partner-invoice';

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';
const LOG = '[partner-invoice/pdf]';

// 1回のリクエストの上限（応答の来ない接続を待ち続けない）。cron は時間予算があるので短く渡す（RenderInvoicePdfOptions）
const REQUEST_TIMEOUT_MS = 40_000;
// レート制限（429）のときだけ待って投げ直す（Workers Free は 10 秒に 1 回）
const BACKOFF_MS = [2_000, 6_000, 11_000];
const BACKOFF_CAP_MS = 15_000;

const accountId = () => (env.CLOUDFLARE_ACCOUNT_ID || env.CF_ACCOUNT_ID || '').trim();
const apiToken = () => (env.CLOUDFLARE_BROWSER_RENDERING_TOKEN ?? '').trim();

/** サーバで PDF を作れる状態か（アカウント ID とトークンが入っているか）。 */
export function invoicePdfReady(): boolean {
  return !!accountId() && !!apiToken();
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after')?.trim();
  if (!raw) return null;
  const secs = Number(raw);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, BACKOFF_CAP_MS);
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.min(Math.max(at - Date.now(), 0), BACKOFF_CAP_MS);
}

export type RenderInvoicePdfOptions = {
  /** 1回のリクエストの上限（ミリ秒）。既定 40 秒 */
  timeoutMs?: number;
  /** false = レート制限（429）でも待って投げ直さない（cron の時間予算内で終えるため）。既定 true */
  backoff?: boolean;
};

/** 請求書の紙面を PDF にする。作れなければ null（理由は console.error に残す）。 */
export async function renderInvoicePdf(doc: InvoiceDocument, opts: RenderInvoicePdfOptions = {}): Promise<Uint8Array | null> {
  const timeoutMs = Math.max(5_000, opts.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const backoff = opts.backoff !== false ? BACKOFF_MS : [];
  const account = accountId();
  const token = apiToken();
  if (!account || !token) {
    console.error(`${LOG} ${doc.invoiceNo} 未設定（CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_BROWSER_RENDERING_TOKEN）`);
    return null;
  }
  // スキーマは公式どおり（format は小文字・waitForSelector はオブジェクト）。autumn-pms で 400 を踏んだ点を踏襲。
  // 余白は紙面の @page（14mm 等）に任せる（margin を渡さない＋preferCSSPageSize）。
  const payload = JSON.stringify({
    html: renderInvoiceHtml(doc),
    // ページ読み込みの待ちはリクエストの上限より少し短く（上限で切られる前に Browser Rendering 側で諦めさせる）
    gotoOptions: { waitUntil: 'networkidle0', timeout: Math.min(30_000, timeoutMs - 3_000) },
    viewport: { width: 1240, height: 1754 },
    pdfOptions: { format: 'a4', printBackground: true, preferCSSPageSize: true }
  });
  const startedAt = Date.now();
  try {
    let res!: Response;
    for (let attempt = 0; attempt <= backoff.length; attempt++) {
      res = await fetch(`${CF_API_BASE}/accounts/${account}/browser-rendering/pdf`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (res.status !== 429 || attempt === backoff.length) break;
      await res.text().catch(() => '');
      const wait = retryAfterMs(res) ?? backoff[attempt];
      console.warn(`${LOG} ${doc.invoiceNo} レート制限(429) attempt=${attempt + 1} wait=${wait}ms`);
      await sleep(wait);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('application/pdf')) {
      const body = await res.text().catch(() => '');
      console.error(`${LOG} ${doc.invoiceNo} 失敗 HTTP ${res.status} ${type}: ${body.slice(0, 300)}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength) {
      console.error(`${LOG} ${doc.invoiceNo} 空の PDF`);
      return null;
    }
    console.log(`${LOG} ${doc.invoiceNo} ok ${bytes.byteLength}bytes ${Date.now() - startedAt}ms`);
    return bytes;
  } catch (e) {
    console.error(`${LOG} ${doc.invoiceNo} 失敗（${Date.now() - startedAt}ms）: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
