// Stripe の Intent に付ける metadata（純関数）。
//
// 同じ Stripe アカウントに複数のアプリ・用途の決済が載る前提で、Intent には必ず
//   app     … 決済を作ったアプリ（autumn-rms / autumn-book / …）
//   purpose … 用途（rms_partner_booking = 取引先予約 など）
//   flow    … 'elements'（同じ画面で払う方式で作った Intent）
// を付ける。Webhook（payment_intent.succeeded / setup_intent.succeeded）は flow='elements' の Intent だけを
// 確定に使う。チェックイン日の自動請求（off-session）や旧 Checkout が裏で作る Intent にも同じ app / purpose が
// 付いているが、それらは別の経路で確定するので flow で見分ける（自動請求の Intent を確定に回すと、
// 確定済みの予約を「期限切れ後の支払」とみなして返金してしまうため）。

export const ELEMENTS_FLOW = 'elements';

// Stripe の上限: キー 40 文字・値 500 文字・50 個まで。
const MAX_KEY = 40;
const MAX_VALUE = 500;
const MAX_KEYS = 50;
const RESERVED = new Set(['app', 'purpose', 'flow']);

export type IntentMetadataInput = {
  app: string;
  purpose: string;
  // 予約 id・予約番号など、用途ごとの識別子（partner_booking_id / booking_code / …）。空の値は入れない
  refs: Record<string, string | number | null | undefined>;
};

export function buildIntentMetadata(input: IntentMetadataInput): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.refs)) {
    if (v == null || v === '' || RESERVED.has(k)) continue;
    if (Object.keys(out).length >= MAX_KEYS - RESERVED.size) break;
    out[k.slice(0, MAX_KEY)] = String(v).slice(0, MAX_VALUE);
  }
  out.app = input.app;
  out.purpose = input.purpose;
  out.flow = ELEMENTS_FLOW;
  return out;
}

// この Intent は「同じ画面で払う方式」で、指定のアプリ・用途のものか。
export function isElementsIntentFor(metadata: unknown, app: string, purposes: readonly string[]): boolean {
  const m = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  return m.flow === ELEMENTS_FLOW && m.app === app && typeof m.purpose === 'string' && purposes.includes(m.purpose);
}
