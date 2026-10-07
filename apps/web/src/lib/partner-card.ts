// 取引先予約のチェックアウト日決済（カードを登録して後日請求）で、登録カードの有効期限が請求日に間に合うか（2026-10-07）。
// カードは有効期限の月の末日まで使える（Stripe の exp_month / exp_year）。
//
// 有効期限が切れていなくても、**更新の時期に入っているカードは断る**（2026-10-07 指示）。
// 日本のカード会社は有効期限の1〜2か月前に更新カードを送り、受け取った新カードを使い始めると旧カードが止まることがある。
// 請求日（チェックアウト日）の月から CARD_RENEWAL_MARGIN_MONTHS か月以内に有効期限を迎えるカードは、請求日に旧カードが
// 使えない恐れがあるので、登録の時点で別のカードを登録してもらう。
// 例: 請求日 2026-11-20・余裕2か月 → 有効期限 2027年1月以降のカードだけ通す（2026年12月までのカードは断る）。
// 有効期限が分からないカード（ウォレット等で取れない）は通す（請求日の失敗は従来どおり再請求・再登録で救う）。

/** 更新の時期として見る月数（有効期限の月がこれより近いカードは断る） */
export const CARD_RENEWAL_MARGIN_MONTHS = 2;

/** カードが使える最後の日（'YYYY-MM-DD'）。有効期限が読めなければ null */
export function cardValidThrough(expMonth: number | null | undefined, expYear: number | null | undefined): string | null {
  const m = Number(expMonth);
  const y = Number(expYear);
  if (!Number.isInteger(m) || !Number.isInteger(y) || m < 1 || m > 12 || y < 2000 || y > 2200) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/**
 * 請求日（'YYYY-MM-DD'）に使えない恐れのあるカードか。有効期限が読めないときは false（通す）。
 * 有効期限の月が「請求日の月 + margin か月」より前なら断る（margin=0 なら単純に請求日より前に切れるか）。
 */
export function cardExpiresBefore(
  card: { exp_month?: number | null; exp_year?: number | null } | null | undefined,
  chargeDate: string,
  margin = CARD_RENEWAL_MARGIN_MONTHS
): boolean {
  if (!cardValidThrough(card?.exp_month, card?.exp_year) || !/^\d{4}-\d{2}-\d{2}$/.test(chargeDate)) return false;
  const expIndex = Number(card!.exp_year) * 12 + (Number(card!.exp_month) - 1);
  const chargeIndex = Number(chargeDate.slice(0, 4)) * 12 + (Number(chargeDate.slice(5, 7)) - 1);
  return expIndex < chargeIndex + Math.max(0, margin);
}
