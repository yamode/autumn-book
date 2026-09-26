// 同じ画面で払う方式の Intent を用意する共通処理（取引先予約・公式サイト予約の両方から使う想定）。
//
// 予約（仮押さえ）1件につき、まだ使える Intent があればそれを使い回し、無ければ作る。
// 使い回すのは「支払方法の入力待ち・確認待ち・本人認証待ち」で、金額と metadata が一致するものだけ。
// カードが断られた後の再試行も同じ Intent（requires_payment_method に戻る）で行えるので、
// 同じ予約に Intent が何本もできて二重に請求されることはない。
import {
  createPaymentIntent,
  createSetupIntent,
  retrievePaymentIntent,
  retrieveSetupIntent,
  type PaymentIntent,
  type SetupIntent
} from '$lib/server/stripe';
import { isReusableIntent, toStripeJpy } from './verify';

export type PreparedIntent = {
  mode: 'payment' | 'setup';
  intentId: string;
  clientSecret: string;
  // 予約時決済の請求額（円）。カード登録は null
  amount: number | null;
};

type Common = {
  // 前回ブラウザに渡した Intent の id（台帳に残しているもの）。pi_ / seti_ 以外は無視する
  existingId: string | null;
  description: string;
  metadata: Record<string, string>;
  refKey: string;
  // 冪等キー（同じ予約で同時に2回押されても Intent が1本になるよう、予約 id と前回の Intent から作る）
  idempotencyKey: string;
};

export async function preparePaymentIntent(args: Common & { amount: number }): Promise<{ prepared: PreparedIntent; created: boolean; intent: PaymentIntent }> {
  const amount = toStripeJpy(args.amount);
  const expect = { app: args.metadata.app, purpose: args.metadata.purpose, refKey: args.refKey, refId: args.metadata[args.refKey], amount };
  if (args.existingId?.startsWith('pi_')) {
    const cur = await retrievePaymentIntent(args.existingId).catch(() => null);
    if (cur?.client_secret && isReusableIntent(cur, expect)) {
      return { prepared: { mode: 'payment', intentId: cur.id, clientSecret: cur.client_secret, amount: cur.amount }, created: false, intent: cur };
    }
  }
  const pi = await createPaymentIntent({ amount, description: args.description, metadata: args.metadata, idempotencyKey: args.idempotencyKey });
  if (!pi.client_secret) throw new Error('決済の準備ができませんでした（client_secret がありません）');
  return { prepared: { mode: 'payment', intentId: pi.id, clientSecret: pi.client_secret, amount: pi.amount }, created: true, intent: pi };
}

export async function prepareSetupIntent(args: Common & { customer: string }): Promise<{ prepared: PreparedIntent; created: boolean; intent: SetupIntent }> {
  const expect = { app: args.metadata.app, purpose: args.metadata.purpose, refKey: args.refKey, refId: args.metadata[args.refKey] };
  if (args.existingId?.startsWith('seti_')) {
    const cur = await retrieveSetupIntent(args.existingId).catch(() => null);
    const curCustomer = typeof cur?.customer === 'string' ? cur.customer : cur?.customer?.id;
    if (cur?.client_secret && curCustomer === args.customer && isReusableIntent(cur, expect)) {
      return { prepared: { mode: 'setup', intentId: cur.id, clientSecret: cur.client_secret, amount: null }, created: false, intent: cur };
    }
  }
  const si = await createSetupIntent({ customer: args.customer, description: args.description, metadata: args.metadata, idempotencyKey: args.idempotencyKey });
  if (!si.client_secret) throw new Error('カード登録の準備ができませんでした（client_secret がありません）');
  return { prepared: { mode: 'setup', intentId: si.id, clientSecret: si.client_secret, amount: null }, created: true, intent: si };
}
