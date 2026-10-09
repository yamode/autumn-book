// 取引先ページの予約画面・予約一覧で、取引先共有の保存カード（2026-10-07・docs/saved-cards.md §6.4）を
// Payment Element に出すための CustomerSession を取る（ブラウザ側）。決済部品（StripePayment）の customerSession に渡す。
// 失敗・確認モード（POST が 403）・保存カードが無いときは null（従来どおり新しいカードの入力だけ）。
// 本人確認（aal2）がまだのときも null。保存カードがあれば mfaRequired=true と件数・本人確認の URL を返す
// （画面は「保存済みのカードを使うには本人確認」を出す・docs/auth-hardening.md §5.2・S4）。
import type { SavedCardExp } from './saved-cards';
import type { MfaMethod } from './partner-mfa';

export type PartnerCustomerSession = {
  clientSecret: string | null;
  cards: SavedCardExp[];
  /** 保存カードがあるが、本人確認がまだなので出していない */
  mfaRequired: boolean;
  savedCount: number;
  /** 本人確認の画面（戻り先つき） */
  mfaUrl: string | null;
  /** その場で本人確認するための材料（mfaRequired のときだけ） */
  stepUp: { maskedEmail: string; methods: MfaMethod[]; waitSec: number; open: boolean } | null;
};

const EMPTY: PartnerCustomerSession = { clientSecret: null, cards: [], mfaRequired: false, savedCount: 0, mfaUrl: null, stepUp: null };

export async function fetchPartnerCustomerSession(
  token: string | undefined,
  bookingId?: string | null,
  next?: string | null
): Promise<PartnerCustomerSession> {
  if (!token) return EMPTY;
  try {
    const res = await fetch(`/p/${token}/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'customer_session', bookingId: bookingId ?? '', next: next ?? '' })
    });
    if (!res.ok) return EMPTY;
    const j = (await res.json().catch(() => null)) as
      | {
          clientSecret?: string | null;
          cards?: SavedCardExp[];
          mfaRequired?: boolean;
          savedCount?: number;
          mfaUrl?: string | null;
          stepUp?: PartnerCustomerSession['stepUp'];
        }
      | null;
    return {
      clientSecret: j?.clientSecret ?? null,
      cards: Array.isArray(j?.cards) ? j.cards : [],
      mfaRequired: j?.mfaRequired === true,
      savedCount: Number(j?.savedCount ?? 0) || 0,
      mfaUrl: typeof j?.mfaUrl === 'string' ? j.mfaUrl : null,
      stepUp: j?.mfaRequired && j.stepUp ? j.stepUp : null
    };
  } catch {
    return EMPTY;
  }
}
