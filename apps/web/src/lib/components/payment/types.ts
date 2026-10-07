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

// 部品の中の文言（公式サイトの英語・繁体字で差し替える）。既定は日本語（取引先ページ）。
export type PaymentTexts = {
  failed: string; // お支払いを完了できませんでした。
  tryOtherCard: string; // 別のカードでお試しください。
  notReady: string;
  checkCard: string;
  setupFailed: string;
  loadFailed: string; // 入力欄を表示できなかった（後ろに理由が付く）
  divider: string; // Apple Pay 等のボタンとカード入力の間
  secure: string; // カード情報は Stripe が…
};

export const PAYMENT_TEXTS_JA: PaymentTexts = {
  failed: 'お支払いを完了できませんでした。',
  tryOtherCard: '別のカードでお試しください。',
  notReady: 'お支払いの準備ができていません。少し待ってからもう一度お試しください。',
  checkCard: 'カード情報をご確認ください。',
  setupFailed: 'カードを登録できませんでした。',
  loadFailed: 'お支払いの入力欄を表示できませんでした。ページを開き直してください。',
  divider: 'またはカード情報を入力',
  secure: 'カード情報は Stripe が暗号化して処理します（当サイトには保存されません）'
};

// Stripe.js に渡す表示言語（サイトの言語 → Stripe の locale）
export type PaymentLocale = 'ja' | 'en' | 'zh-TW';

// 予約画面の Payment Element で「保存済み」のカードが選ばれたとき（2026-10-07・保存カード）。
// card は Stripe が渡すときだけ入る。親は自前の保存カード一覧（id → 有効期限）でも引けるようにしておく。
export type SavedCardSelection = {
  id: string;
  card: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } | null;
};
