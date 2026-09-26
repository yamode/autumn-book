// 決済部品（StripePayment.svelte）と、それを使う画面の間の約束。
// 取引先予約・公式サイト予約のどちらでも使えるよう、予約や取引先の型には依存しない。

export type PaymentMode = 'payment' | 'setup';

// 確定ボタン（または Apple Pay / Google Pay）が押されたときに、画面側が行う準備の結果。
// 画面側はここで予約を仮押さえし、サーバに Intent を作らせて client_secret を返す。
// 失敗したら Error を投げる（message がそのまま画面に出る）。
export type PaymentPrepareResult = {
  clientSecret: string;
  // 3Dセキュア等でリダイレクトが必要な決済手段のときの戻り先（カードは通常モーダルで済み、戻らない）
  returnUrl: string;
};

// Stripe での確定が終わった（支払・カード登録が通った）とき。画面側はサーバに確定の連絡を送る。
export type PaymentConfirmed = {
  intentId: string;
  // PaymentIntent / SetupIntent の status（succeeded / processing 等）
  status: string;
  // express = Apple Pay / Google Pay のボタンから
  via: 'form' | 'express';
};
