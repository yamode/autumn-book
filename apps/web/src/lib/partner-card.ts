// 取引先予約のチェックアウト日決済（カードを登録して後日請求）で、登録カードの有効期限が請求日に間に合うか（2026-10-07）。
// カードは有効期限の月の末日まで使える（Stripe の exp_month / exp_year）。請求日（チェックアウト日）より前に切れるカードは
// 登録の時点で断り、別のカードを登録してもらう（請求日に失敗してから気づくのを避ける）。
// 有効期限が分からないカード（ウォレット等で取れない）は通す（請求日の失敗は従来どおり再請求・再登録で救う）。

/** カードが使える最後の日（'YYYY-MM-DD'）。有効期限が読めなければ null */
export function cardValidThrough(expMonth: number | null | undefined, expYear: number | null | undefined): string | null {
  const m = Number(expMonth);
  const y = Number(expYear);
  if (!Number.isInteger(m) || !Number.isInteger(y) || m < 1 || m > 12 || y < 2000 || y > 2200) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** 請求日（'YYYY-MM-DD'）より前に有効期限が切れるか。有効期限が読めないときは false（通す） */
export function cardExpiresBefore(card: { exp_month?: number | null; exp_year?: number | null } | null | undefined, chargeDate: string): boolean {
  const through = cardValidThrough(card?.exp_month, card?.exp_year);
  return !!through && /^\d{4}-\d{2}-\d{2}$/.test(chargeDate) && through < chargeDate;
}
