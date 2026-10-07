// 取引先ページの予約画面・予約一覧で、取引先共有の保存カード（2026-10-07・docs/saved-cards.md §6.4）を
// Payment Element に出すための CustomerSession を取る（ブラウザ側）。決済部品（StripePayment）の customerSession に渡す。
// 失敗・確認モード（POST が 403）・保存カードが無いときは null（従来どおり新しいカードの入力だけ）。
import type { SavedCardExp } from './saved-cards';

export async function fetchPartnerCustomerSession(token: string | undefined, bookingId?: string | null): Promise<{ clientSecret: string | null; cards: SavedCardExp[] }> {
  if (!token) return { clientSecret: null, cards: [] };
  try {
    const res = await fetch(`/p/${token}/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'customer_session', bookingId: bookingId ?? '' })
    });
    if (!res.ok) return { clientSecret: null, cards: [] };
    const j = (await res.json().catch(() => null)) as { clientSecret?: string | null; cards?: SavedCardExp[] } | null;
    return { clientSecret: j?.clientSecret ?? null, cards: Array.isArray(j?.cards) ? j.cards : [] };
  } catch {
    return { clientSecret: null, cards: [] };
  }
}
