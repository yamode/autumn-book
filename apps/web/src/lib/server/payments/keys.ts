// Stripe の鍵の形式判定（純関数。$env を読まないのでテストできる）。
//
// 同じ画面で払う方式（Payment Element / Express Checkout Element）は、サーバのシークレットキー（sk_ / rk_）と
// ブラウザに渡す公開可能キー（pk_）の両方が要る。テスト / 本番のモードが食い違うと、ブラウザで入力した
// カードをサーバの Intent で使えず必ず失敗するので、そろっていなければ決済を画面に出さない。

// 貼り付け時に混ざりやすい前後の空白・引用符・見えない文字（BOM・ゼロ幅スペース）を取り除く。
export const cleanKey = (v: string | undefined | null) =>
  (v ?? '')
    .replace(/[​-‍﻿]/g, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim();

export type KeyMode = 'test' | 'live' | null;

// sk_test_ / rk_test_ / pk_test_ → test、_live_ → live。判別できなければ null。
export function keyMode(key: string): KeyMode {
  const m = /^(?:sk|rk|pk)_(test|live)_/.exec(key);
  return m ? (m[1] as 'test' | 'live') : null;
}

// 公開可能キーの問題（無ければ null）。
//   missing         … 未登録
//   not_publishable … pk_ で始まっていない（シークレットキーを入れてしまった等。ブラウザへ出すので出さない）
//   mode_mismatch   … シークレットキーとテスト / 本番が違う
export type PublishableKeyIssue = 'missing' | 'not_publishable' | 'mode_mismatch';
export function publishableKeyIssue(secretKey: string, publishableKey: string): PublishableKeyIssue | null {
  if (!publishableKey) return 'missing';
  if (!publishableKey.startsWith('pk_')) return 'not_publishable';
  const sm = keyMode(secretKey);
  const pm = keyMode(publishableKey);
  if (sm && pm && sm !== pm) return 'mode_mismatch';
  return null;
}

// 管理画面に出す説明
export function describePublishableKeyIssue(issue: PublishableKeyIssue): string {
  if (issue === 'missing') return '公開可能キー（PUBLIC_STRIPE_PUBLISHABLE_KEY）が未登録です';
  if (issue === 'not_publishable') return 'PUBLIC_STRIPE_PUBLISHABLE_KEY が pk_ で始まっていません（公開可能キーを登録してください。ブラウザへは出していません）';
  return 'シークレットキーと公開可能キーのテスト / 本番が食い違っています';
}
