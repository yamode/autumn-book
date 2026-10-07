// 保存カード（マイページのカード登録・2026-10-07・docs/saved-cards.md）の純関数。サーバ・画面のどちらからも使う。
//
// - 取引先は取引先に1つ（当面は rms_partners の行ごと・統合後は取引先で1つ。施設を前提にしない）、公式サイト会員は会員ごとに1つの Stripe Customer にカードを保存する
// - 一覧に出すのは「マイページで保存の同意を取ったカード」（allow_redisplay = 'always'）だけ。
//   予約ごとのカード登録（チェックアウト日決済）で同じ Customer に付いたカードは unspecified のまま出さない（N3）
// - 同じカード（fingerprint が同じ）は二重に保存しない（N5）
// - 有効期限の判定は lib/partner-card.ts（予約は請求日の月から2か月の余裕・マイページの登録は今日基準で切れていないか）
import { cardExpiresBefore } from './partner-card';

export type SavedCard = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  // 登録日時（ISO）。Stripe の PaymentMethod の created
  created: string | null;
  // 同じカードかの判定に使う（画面へは渡さない）
  fingerprint: string | null;
};

// Stripe の PaymentMethod（必要な部分だけ）
export type PaymentMethodLike = {
  id: string;
  card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number; fingerprint?: string | null } | null;
  created?: number;
  allow_redisplay?: string;
};

/** 保存の同意文の版（PaymentMethod の metadata に残す。文面を変えたら上げる） */
export const SAVED_CARD_CONSENT_VERSION = '2026-10-07';

/** 予約画面の「保存済み」に出す枚数の上限（CustomerSession の payment_method_redisplay_limit・N9） */
export const SAVED_CARD_REDISPLAY_LIMIT = 10;

const BRAND_LABELS: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  jcb: 'JCB',
  diners: 'Diners Club',
  discover: 'Discover',
  unionpay: 'UnionPay'
};

/** カードのブランドの表示名（例: visa → Visa） */
export const cardBrandLabel = (brand: string | null | undefined): string =>
  BRAND_LABELS[(brand ?? '').toLowerCase()] ?? ((brand ?? '').replace(/^./, (c) => c.toUpperCase()) || 'カード');

/** 有効期限の表示（MM/YY）。読めなければ '—' */
export function cardExpLabel(expMonth: number | null | undefined, expYear: number | null | undefined): string {
  const mo = Number(expMonth);
  const y = Number(expYear);
  if (!Number.isInteger(mo) || !Number.isInteger(y) || mo < 1 || mo > 12) return '—';
  return `${String(mo).padStart(2, '0')}/${String(y % 100).padStart(2, '0')}`;
}

/** PaymentMethod → 一覧の1行。カードでなければ null */
export function savedCardOf(pm: PaymentMethodLike, defaultId: string | null): SavedCard | null {
  if (!pm.card) return null;
  return {
    id: pm.id,
    brand: pm.card.brand ?? '',
    last4: pm.card.last4 ?? '',
    expMonth: pm.card.exp_month ?? null,
    expYear: pm.card.exp_year ?? null,
    isDefault: !!defaultId && pm.id === defaultId,
    created: pm.created ? new Date(pm.created * 1000).toISOString() : null,
    fingerprint: pm.card.fingerprint ?? null
  };
}

/**
 * Customer に付いている PaymentMethod から、マイページの一覧に出すカード（allow_redisplay = 'always'）を作る。
 * 並びは 既定のカード → 新しい順（Payment Element の「保存済み」と同じ考え方）。
 */
export function savedCardsOf(pms: PaymentMethodLike[], defaultId: string | null): SavedCard[] {
  return pms
    .filter((pm) => pm.allow_redisplay === 'always')
    .map((pm) => savedCardOf(pm, defaultId))
    .filter((c): c is SavedCard => c !== null)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || (b.created ?? '').localeCompare(a.created ?? ''));
}

/** 既に保存されている同じカード（fingerprint が同じ・自分以外）。無ければ null */
export function duplicateCardOf(cards: Pick<SavedCard, 'id' | 'fingerprint'>[], pm: { id: string; fingerprint: string | null | undefined }): string | null {
  if (!pm.fingerprint) return null;
  return cards.find((c) => c.id !== pm.id && c.fingerprint === pm.fingerprint)?.id ?? null;
}

/** マイページの登録で断るカード（今日の時点で有効期限が切れている）。有効期限が読めなければ false */
export const cardExpiredOn = (card: { exp_month?: number | null; exp_year?: number | null } | null | undefined, today: string): boolean =>
  cardExpiresBefore(card, today, 0);

/** 画面へ渡す形（fingerprint は出さない） */
export type SavedCardView = Omit<SavedCard, 'fingerprint'>;
export const savedCardView = ({ fingerprint: _f, ...rest }: SavedCard): SavedCardView => rest;

/** 画面の1行の見出し（例: Visa •••• 4242） */
export const savedCardTitle = (c: Pick<SavedCard, 'brand' | 'last4'>): string => `${cardBrandLabel(c.brand)} •••• ${c.last4}`.trim();

/** 取消のキャンセル料をカードへ請求する途中とみなす時間（これを過ぎた取消は削除を止めない） */
export const CANCEL_FEE_PENDING_HOURS = 24;

/**
 * 保存カードを削除できない予約（取引先）。そのカードで、まだ請求していない・これから請求しうる予約。
 * - 確定済みのチェックアウト日決済で、請求前（scheduled）・請求失敗（charge_failed）
 * - 取消済みで、キャンセル料をカードへ請求する途中（cancel_fee_settlement='card' で請求済みでない）。
 *   請求は取消の処理の中で行い、失敗すれば請求書に回る（settlement='invoice'）ので、本来は一瞬の状態。
 *   取消から CANCEL_FEE_PENDING_HOURS 時間を過ぎても残っているもの（処理が途中で止まった等）・取消日時が分からないものは、
 *   カードの削除を永久に止めないよう通す
 */
export function bookingBlocksCardRemoval(
  b: {
    status: string;
    payment_status?: string | null;
    cancel_fee_settlement?: string | null;
    cancel_fee_status?: string | null;
    cancelled_at?: string | null;
  },
  now: Date = new Date()
): boolean {
  if (b.status === 'confirmed' && (b.payment_status === 'scheduled' || b.payment_status === 'charge_failed')) return true;
  if (b.status === 'cancelled' && b.cancel_fee_settlement === 'card' && b.cancel_fee_status !== 'charged') {
    const at = b.cancelled_at ? Date.parse(b.cancelled_at) : NaN;
    return Number.isFinite(at) && now.getTime() - at < CANCEL_FEE_PENDING_HOURS * 3600_000;
  }
  return false;
}

/**
 * Stripe の冪等キーに混ぜる短いハッシュ（FNV-1a・16進8桁）。Customer の作成で名前・メールが変わった再送が、
 * 同じキーで別のパラメータ（idempotency_error）にならないようにする。秘密ではない（取り違え防止のためだけ）
 */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 取引先の予約画面で、保存カード（CustomerSession）を出してよい Customer（§6.4・§7.2）。
 * Intent に付く Customer と同じでなければ、保存カードで確定できないため出さない。
 * - 新しい予約（まだ予約が無い）・予約時決済・デポジット: 取引先共有の Customer
 * - チェックアウト日決済の予約: 予約の Customer がまだ無いか、共有 Customer と同じとき。予約ごとの Customer（旧予約）は出さない
 */
export function savedCardCustomerFor(
  shared: string | null,
  booking: { payment_option?: string | null; stripe_customer_id?: string | null } | null
): string | null {
  if (!shared) return null;
  if (!booking || booking.payment_option !== 'online_checkin') return shared;
  return !booking.stripe_customer_id || booking.stripe_customer_id === shared ? shared : null;
}

/** 予約画面に渡す保存カードの有効期限（事前警告用） */
export type SavedCardExp = { id: string; expMonth: number | null; expYear: number | null };

/**
 * 予約画面で選ばれた保存カードが、チェックアウト日決済の請求日に使えない恐れがあるか（§7.3 の1段目・ブラウザで評価）。
 * 有効期限は Stripe が渡すカード情報か、自前の一覧（id → 有効期限）から引く。分からなければ false（サーバの判定に任せる）。
 */
export function selectedCardExpiresBefore(
  sel: { id: string; card?: { exp_month?: number | null; exp_year?: number | null } | null } | null,
  cards: SavedCardExp[],
  chargeDate: string | null | undefined
): boolean {
  if (!sel || !chargeDate) return false;
  const known = cards.find((c) => c.id === sel.id);
  const card = sel.card?.exp_month && sel.card?.exp_year ? sel.card : known ? { exp_month: known.expMonth, exp_year: known.expYear } : null;
  return cardExpiresBefore(card, chargeDate);
}

/** 保存カードの有効期限が近いときの文言（予約画面・§6.4） */
export const SAVED_CARD_EXPIRY_WARNING = 'このカードは有効期限が近いため、このご予約には使えません。別のカードをお選びください。';

/**
 * 取引先のマイページ（お支払いカード）で、カードを保存するときの同意文（§6.1）。保存の同意であって請求の同意ではない（§7.4）。
 * 取引先は将来 Book 内で1つに統合されるので、施設名を前提にしない。登録の記録（アクセスログ）に同じ文面を残す。
 */
export const PARTNER_CARD_SAVE_CONSENT =
  'このカードを御社のアカウントに保存し、今後のご予約でお支払方法として選べるようにします。' +
  '保存したカードへの請求は、ご予約ごとの画面でご確認いただく内容（請求日・金額）への同意に基づいて行います。' +
  'カードは「お支払いカード」からいつでも削除できます。';

/** 登録の結果（CardSetupResult.status）→ 画面の文言（取引先・日本語） */
export const PARTNER_CARD_RESULT_TEXT: Record<string, string> = {
  saved: 'カードを登録しました。',
  duplicate: 'このカードは既に登録されています。',
  expired: '有効期限が切れているカードは登録できません。別のカードをお使いください。',
  unpaid: 'カードの登録が完了していません。もう一度お試しください。',
  unknown: 'カードの登録を確認できませんでした。もう一度お試しください。'
};
