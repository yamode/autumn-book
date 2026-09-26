<script lang="ts">
  // 同じ画面で払う決済部品（Stripe Payment Element ＋ Express Checkout Element（Apple Pay / Google Pay））。
  //
  // deferred intent 方式: Elements を mode / amount / currency だけで先に表示し、確定ボタン（親の submit() 呼び出し）
  // または Apple Pay / Google Pay のボタンで
  //   ① elements.submit()（入力の検証）→ ② 親の prepare()（予約の仮押さえ＋サーバで Intent を作って client_secret）
  //   → ③ stripe.confirmPayment / confirmSetup（redirect: 'if_required'。3Dセキュアは Stripe のモーダル）
  //   → ④ 親の onconfirmed()（サーバに確定の連絡）
  // の順に進める。取引先予約・公式サイト予約のどちらでも使えるよう、予約の中身には触れない。
  //
  // ⚠ サーバ側の Intent も payment_method_types=['card'] で作ること（ここの paymentMethodTypes とそろえる）。
  // ⚠ 予約時決済（mode='payment'）の amount は、サーバが作る Intent の金額と同じにすること（Apple Pay の画面に出る額）。
  import { onDestroy, onMount } from 'svelte';
  import type {
    Stripe,
    StripeElements,
    StripeError,
    StripeExpressCheckoutElement,
    StripeExpressCheckoutElementConfirmEvent,
    StripePaymentElement
  } from '@stripe/stripe-js';
  import { stripeAppearance, type PaymentTheme } from './appearance';
  import type { PaymentConfirmed, PaymentMode, PaymentPrepareResult } from './types';

  type Props = {
    // 公開可能キー（pk_）。無ければ入力欄を出さず、unavailableText を出す
    publishableKey: string | null;
    mode: PaymentMode;
    // 予約時決済の金額（円）。mode='setup' では使わない
    amount?: number;
    currency?: string;
    theme?: Partial<PaymentTheme>;
    // カード登録の同意文（入力欄の直下に出す）
    consentText?: string | null;
    // Apple Pay / Google Pay のボタンを出すか
    express?: boolean;
    // 入力をいったん止める（金額の再計算中など）
    disabled?: boolean;
    unavailableText?: string;
    // 確定前に親のフォームを検証する。エラー文を返すと止める（Apple Pay / Google Pay のボタンでも呼ぶ）
    validate?: () => string | null;
    prepare: () => Promise<PaymentPrepareResult>;
    onconfirmed: (r: PaymentConfirmed) => void | Promise<void>;
    onerror?: (message: string) => void;
    onbusychange?: (busy: boolean) => void;
    // カード入力が埋まったか（ボタンの有効化などに使う）
    oncompletechange?: (complete: boolean) => void;
  };

  let {
    publishableKey,
    mode,
    amount = 0,
    currency = 'jpy',
    theme = {},
    consentText = null,
    express = true,
    disabled = false,
    unavailableText = 'オンライン決済は現在ご利用いただけません。',
    validate,
    prepare,
    onconfirmed,
    onerror,
    onbusychange,
    oncompletechange
  }: Props = $props();

  let stripe: Stripe | null = null;
  let elements: StripeElements | null = null;
  let paymentElement: StripePaymentElement | null = null;
  let expressElement: StripeExpressCheckoutElement | null = null;
  let payHost: HTMLDivElement | undefined = $state();
  let expressHost: HTMLDivElement | undefined = $state();

  let phase = $state<'loading' | 'ready' | 'error'>('loading');
  let loadError = $state('');
  let expressShown = $state(false);
  let busy = $state(false);
  let message = $state('');

  const setBusy = (v: boolean) => {
    busy = v;
    onbusychange?.(v);
  };

  function fail(msg: string, ev?: StripeExpressCheckoutElementConfirmEvent) {
    message = msg;
    onerror?.(msg);
    ev?.paymentFailed({ reason: 'fail' });
  }

  // Stripe のエラーは locale=ja で日本語になっている。カード会社の拒否だけ、次にどうすればよいかを足す。
  function friendly(e: StripeError): string {
    const base = e.message ?? 'お支払いを完了できませんでした。';
    if (e.type === 'card_error') return `${base} 別のカードでお試しください。`;
    return base;
  }

  onMount(() => {
    if (!publishableKey) return;
    let cancelled = false;
    (async () => {
      try {
        // pure 版は読み込んだ時点では何もしない（js.stripe.com/v3 はこの部品が表示されたときだけ読む）
        const { loadStripe } = await import('@stripe/stripe-js/pure');
        const s = await loadStripe(publishableKey, { locale: 'ja' });
        if (cancelled) return;
        if (!s) throw new Error('Stripe.js を読み込めませんでした');
        stripe = s;
        // サーバの Intent（payment_method_types=['card']）とそろえる。Apple Pay / Google Pay はカード扱い
        const common = { currency, paymentMethodTypes: ['card'], appearance: stripeAppearance(theme), locale: 'ja' as const };
        const el =
          mode === 'payment'
            ? s.elements({ ...common, mode: 'payment', amount: Math.max(50, Math.round(amount)) })
            : // 後日の請求（off-session）に使う。サーバの SetupIntent（usage=off_session）とそろえる
              s.elements({ ...common, mode: 'setup', setupFutureUsage: 'off_session' });
        elements = el;

        const pe = el.create('payment', {
          layout: 'tabs',
          // Apple Pay / Google Pay は上の Express Checkout のボタンに出すので、ここでは重複させない
          wallets: { applePay: 'never', googlePay: 'never' },
          // カード登録の同意文はこの部品の下に自前で出す（Stripe 既定の英語混じりの文言は出さない）
          terms: { card: 'never' },
          readOnly: disabled
        });
        pe.on('change', (e) => oncompletechange?.(e.complete));
        pe.on('loaderror', (e) => {
          phase = 'error';
          loadError = e.error?.message ?? 'お支払いの入力欄を表示できませんでした。';
        });
        if (payHost) pe.mount(payHost);
        paymentElement = pe;

        if (express && expressHost) {
          const ece = el.create('expressCheckout', {
            buttonHeight: 48,
            buttonType: mode === 'payment' ? { applePay: 'book', googlePay: 'book' } : { applePay: 'plain', googlePay: 'plain' },
            paymentMethods: { applePay: 'auto', googlePay: 'auto', link: 'never', amazonPay: 'never', paypal: 'never', klarna: 'never' },
            layout: { maxColumns: 2, maxRows: 1, overflow: 'never' }
          });
          ece.on('ready', (e) => {
            const a = e.availablePaymentMethods as Record<string, boolean> | undefined;
            expressShown = !!a && Object.values(a).some(Boolean);
          });
          ece.on('click', (e) => {
            // 親のフォームを先に確かめる。問題があれば支払シートを開かない（resolve しない）
            if (busy || disabled) return;
            const v = validate?.();
            if (v) {
              fail(v);
              return;
            }
            message = '';
            e.resolve();
          });
          ece.on('confirm', (e) => {
            void run('express', e);
          });
          ece.mount(expressHost);
          expressElement = ece;
        }
        phase = 'ready';
      } catch (e) {
        if (cancelled) return;
        phase = 'error';
        loadError = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  onDestroy(() => {
    paymentElement?.destroy();
    expressElement?.destroy();
  });

  // 金額が変わったら（人数・泊数・割引）Elements にも伝える（Apple Pay の支払シートに出る額）
  $effect(() => {
    const a = Math.round(amount);
    if (phase === 'ready' && elements && mode === 'payment' && a > 0) elements.update({ amount: a });
  });
  // 親が止めたいとき（料金の再計算中など）だけ入力を読み取り専用にする。確定処理中（busy）は触らない
  // （confirmPayment の途中で Element の状態を変えないため。二重押しは busy で弾く）
  $effect(() => {
    const ro = disabled;
    if (phase === 'ready') paymentElement?.update({ readOnly: ro });
  });

  async function run(via: 'form' | 'express', ev?: StripeExpressCheckoutElementConfirmEvent): Promise<boolean> {
    if (!stripe || !elements || phase !== 'ready') {
      fail('お支払いの準備ができていません。少し待ってからもう一度お試しください。', ev);
      return false;
    }
    if (busy) return false;
    message = '';
    if (via === 'form') {
      const v = validate?.();
      if (v) {
        fail(v);
        return false;
      }
    }
    setBusy(true);
    try {
      // ① 入力の検証（deferred intent では Intent を作る前に必ず呼ぶ）
      const { error: submitError } = await elements.submit();
      if (submitError) {
        fail(submitError.message ?? 'カード情報をご確認ください。', ev);
        return false;
      }
      // ② 予約の仮押さえ＋Intent（親）
      let prepared: PaymentPrepareResult;
      try {
        prepared = await prepare();
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e), ev);
        return false;
      }
      // ③ Stripe で確定（3Dセキュアはモーダル。カードは通常リダイレクトしない）
      const params = { elements, clientSecret: prepared.clientSecret, confirmParams: { return_url: prepared.returnUrl }, redirect: 'if_required' as const };
      let intentId: string;
      let status: string;
      if (mode === 'payment') {
        const { error, paymentIntent } = await stripe.confirmPayment(params);
        if (error || !paymentIntent) {
          fail(error ? friendly(error) : 'お支払いを完了できませんでした。', ev);
          return false;
        }
        intentId = paymentIntent.id;
        status = paymentIntent.status;
      } else {
        const { error, setupIntent } = await stripe.confirmSetup(params);
        if (error || !setupIntent) {
          fail(error ? friendly(error) : 'カードを登録できませんでした。', ev);
          return false;
        }
        intentId = setupIntent.id;
        status = setupIntent.status;
      }
      // ④ 確定の連絡（親）
      await onconfirmed({ intentId, status, via });
      return true;
    } finally {
      setBusy(false);
    }
  }

  // 親の確定ボタンから呼ぶ（成功で true）
  export function submit(): Promise<boolean> {
    return run('form');
  }
</script>

{#if !publishableKey}
  <p class="rounded-md border border-amber-700/30 bg-amber-50 px-3 py-2 text-sm text-amber-800">{unavailableText}</p>
{:else}
  <div class="grid gap-4" aria-busy={busy}>
    <!-- Apple Pay / Google Pay（使える端末だけ出る）。スマホではカード入力より上に来る -->
    <div class:hidden={!expressShown}>
      <div bind:this={expressHost}></div>
      <p class="mt-4 flex items-center gap-3 text-xs text-stone-500">
        <span class="h-px flex-1 bg-stone-200"></span>またはカード情報を入力<span class="h-px flex-1 bg-stone-200"></span>
      </p>
    </div>

    <div class="relative min-h-[9rem]" class:hidden={phase === 'error'}>
      {#if phase === 'loading'}
        <div class="absolute inset-0 grid content-start gap-3" aria-hidden="true">
          <div class="h-4 w-24 animate-pulse rounded bg-stone-200"></div>
          <div class="h-11 animate-pulse rounded-md bg-stone-100"></div>
          <div class="grid grid-cols-2 gap-3">
            <div class="h-11 animate-pulse rounded-md bg-stone-100"></div>
            <div class="h-11 animate-pulse rounded-md bg-stone-100"></div>
          </div>
        </div>
      {/if}
      <div bind:this={payHost}></div>
    </div>

    {#if phase === 'error'}
      <p class="rounded-md border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-sm text-rose-700">
        お支払いの入力欄を表示できませんでした。ページを開き直してください。{loadError ? `（${loadError}）` : ''}
      </p>
    {/if}

    {#if consentText}
      <!-- カード登録の同意文（確定時に同じ文面を記録する） -->
      <p class="rounded-md bg-stone-50 px-3 py-2.5 text-sm leading-6 text-stone-600">{consentText}</p>
    {/if}

    {#if message}
      <p class="rounded-md border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-sm text-rose-700" role="alert">{message}</p>
    {/if}

    <p class="flex items-center gap-1.5 text-xs text-stone-500">
      <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      カード情報は Stripe が暗号化して処理します（当サイトには保存されません）
    </p>
  </div>
{/if}
