<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  // 取引先専用ページ: アカウント → お支払いカード（保存カード・2026-10-07・docs/saved-cards.md §6.1）。
  // 登録したカードは御社の全ユーザーが予約時に選べる。登録はモーダル（StripePayment・mode='setup'・Apple Pay 等は出さない・N4）、
  // 削除・既定は form action。請求はご予約ごとの同意に基づく（ここでの同意は「保存」の同意）。
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import type { SubmitFunction } from '@sveltejs/kit';
  import StripePayment from '$lib/components/payment/StripePayment.svelte';
  import type { PaymentConfirmed, PaymentPrepareResult } from '$lib/components/payment/types';
  import { partnerAccent } from '$lib/partner-theme';
  import { cardExpLabel, savedCardTitle } from '$lib/saved-cards';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; removed?: string; defaulted?: string } } = $props();

  const token = $derived($page.params.token);
  const accent = $derived(partnerAccent(data.portal.facilitySlug));
  let busy = $state(false);
  // 登録の結果（モーダルを閉じた後に一覧の上へ出す）
  let notice = $state<{ ok: boolean; text: string } | null>(null);

  const submit =
    (confirmMessage?: string): SubmitFunction =>
    ({ cancel }) => {
      if (confirmMessage && !confirm(confirmMessage)) {
        cancel();
        return;
      }
      busy = true;
      notice = null;
      return async ({ update }) => {
        busy = false;
        await update({ reset: false });
      };
    };

  const ymd = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }) : '—';

  // ---- カードを追加する（モーダル）----
  let adding = $state(false);
  let payRef: { submit: () => Promise<boolean> } | undefined = $state();
  let payBusy = $state(false);

  function openAdd() {
    notice = null;
    adding = true;
  }
  function closeAdd() {
    if (payBusy) return;
    adding = false;
  }

  async function prepareAdd(): Promise<PaymentPrepareResult> {
    const res = await fetch(`/p/${token}/account/cards/api`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare' })
    });
    if (res.status === 401) {
      location.href = `/p/${token}`;
      throw new Error('ログインの有効期限が切れました。');
    }
    const j = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; clientSecret?: string; returnUrl?: string } | null;
    if (!res.ok || !j?.ok || !j.clientSecret || !j.returnUrl) throw new Error(j?.message || 'カード登録の準備ができませんでした。時間をおいてお試しください。');
    return { clientSecret: j.clientSecret, returnUrl: j.returnUrl };
  }

  async function onAdded(r: PaymentConfirmed) {
    let ok = false;
    let text = 'カードの登録を確認できませんでした。一覧を開き直してご確認ください。';
    try {
      const res = await fetch(`/p/${token}/account/cards/api`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', intentId: r.intentId })
      });
      const j = (await res.json().catch(() => null)) as { result?: { status?: string }; message?: string } | null;
      ok = j?.result?.status === 'saved';
      if (j?.message) text = j.message;
    } catch {
      // 一覧の読み直しで確かめてもらう
    }
    notice = { ok, text };
    adding = false;
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, 'お支払いカード')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<section>
  <p class="text-sm leading-6 text-stone-600">
    ここで登録したカードは、御社の全ユーザーが予約時に選べます。請求はご予約ごとの同意（予約画面の文面）に基づいて行います。
    カードの番号は Stripe が保管し、当サイトには保存されません。
  </p>

  {#if data.preview}
    <p class="mt-5 rounded-xl border border-stone-200 bg-white px-5 py-8 text-center text-stone-500">確認モードではカードを表示しません。</p>
  {:else if !data.ready}
    <p class="mt-5 rounded-xl border border-amber-700/30 bg-amber-50 px-5 py-6 text-center text-amber-800">現在ご利用いただけません。</p>
  {:else}
    {#if form?.message}
      <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700" role="alert">{form.message}</p>
    {:else if form?.removed}
      <p class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 text-sm text-brand-900">{form.removed} を削除しました。</p>
    {:else if form?.defaulted}
      <p class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 text-sm text-brand-900">{form.defaulted} を既定のカードにしました。</p>
    {/if}
    {#if notice ?? data.returned}
      {@const n = notice ?? { ok: data.returned?.status === 'saved', text: data.returned?.message ?? '' }}
      <p class={`mt-4 rounded-xl px-4 py-3 text-sm ${n.ok ? 'border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] text-brand-900' : 'border border-amber-700/30 bg-amber-50 text-amber-900'}`} role="status">{n.text}</p>
    {/if}
    {#if data.loadError}
      <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">{data.loadError}</p>
    {/if}

    {#if data.cards.length === 0}
      {#if !data.loadError}
        <p class="mt-5 rounded-xl border border-stone-200 bg-white px-5 py-8 text-center text-stone-500">登録されているカードはありません。</p>
      {/if}
    {:else}
      <ul class="mt-5 space-y-3">
        {#each data.cards as c (c.id)}
          <li class="rounded-xl border border-stone-200 bg-white p-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="flex flex-wrap items-center gap-2">
                  <span class="font-medium text-brand-900">{savedCardTitle(c)}</span>
                  {#if c.isDefault}<span class="rounded bg-[var(--pt-accent-soft)] px-1.5 py-0.5 text-xs font-medium text-[var(--pt-accent)]">既定</span>{/if}
                </p>
                <p class="mt-1 text-sm text-stone-600">有効期限 {cardExpLabel(c.expMonth, c.expYear)}<span class="ml-3 text-stone-500">登録日 {ymd(c.created)}</span></p>
                {#if c.bookings.length}
                  <p class="mt-1 text-xs leading-5 text-stone-500">このカードでお支払い予定のご予約: {c.bookings.join('・')}</p>
                {/if}
              </div>
              <div class="flex flex-wrap gap-2 text-sm">
                {#if !c.isDefault}
                  <form method="POST" action="?/set_default" use:enhance={submit()}>
                    <input type="hidden" name="pm" value={c.id} />
                    <button type="submit" disabled={busy} class="rounded-md border border-stone-300 px-3 py-1.5 text-stone-700 hover:bg-stone-50 disabled:opacity-50">既定にする</button>
                  </form>
                {/if}
                <form method="POST" action="?/remove" use:enhance={submit(`${savedCardTitle(c)} を削除します。御社の全ユーザーが予約時に選べなくなります。よろしいですか？`)}>
                  <input type="hidden" name="pm" value={c.id} />
                  <button type="submit" disabled={busy} class="rounded-md border border-rose-300 px-3 py-1.5 text-rose-700 hover:bg-rose-50 disabled:opacity-50">削除</button>
                </form>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <button type="button" onclick={openAdd} disabled={!data.stripeKey} class="mt-5 rounded-lg bg-accent-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-500 disabled:opacity-50">
      カードを追加する
    </button>
  {/if}
</section>

{#if adding}
  <!-- カードの追加。同じ画面で登録する（別ページへ移動しない） -->
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="presentation" onclick={(e) => e.target === e.currentTarget && closeAdd()} onkeydown={(e) => e.key === 'Escape' && closeAdd()}>
    <div class="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="card-add-title">
      <div class="flex items-start justify-between gap-3">
        <h3 id="card-add-title" class="text-lg font-bold">カードを追加する</h3>
        <button type="button" onclick={closeAdd} disabled={payBusy} class="rounded-md px-2 py-1 text-stone-500 hover:bg-stone-100" aria-label="閉じる">✕</button>
      </div>
      <div class="mt-4">
        <StripePayment
          bind:this={payRef}
          publishableKey={data.stripeKey}
          mode="setup"
          express={false}
          theme={{ accent: accent.accent, accentSoft: accent.accentSoft }}
          consentText={data.consentText}
          allowRedisplay="always"
          prepare={prepareAdd}
          onconfirmed={onAdded}
          onbusychange={(v) => (payBusy = v)}
        />
      </div>
      <p class="mt-3 text-xs leading-5 text-stone-500">この同意はカードの保存についてのものです。ご予約ごとの請求（請求日・金額）は、予約画面でご確認・ご同意いただきます。</p>
      <button type="button" onclick={() => void payRef?.submit()} disabled={payBusy || !data.stripeKey} class="mt-4 w-full rounded-lg bg-accent-600 px-4 py-3 font-medium text-white transition hover:bg-accent-500 disabled:opacity-40">
        {payBusy ? 'カードを確認しています…' : 'このカードを保存する'}
      </button>
      <button type="button" onclick={closeAdd} disabled={payBusy} class="mt-2 w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50">閉じる</button>
    </div>
  </div>
{/if}
