<script lang="ts">
  // 取引先の共通ログイン画面（docs/partner-common-login.md）。全取引先で同じURL。
  // 見た目は取引先ページ（/p/<token> のログイン）と同じ部品。取引先が分からないので施設名・取引先名は出さず、差し色は既定。
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { onDestroy, onMount } from 'svelte';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import { ONE_PERSON_ONE_ID_NOTICE } from '$lib/partner-passkey';
  import { PARTNER_DEFAULT_ACCENT } from '$lib/partner-theme';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; loginId?: string } } = $props();
  let submitting = $state(false);
  const inputClass =
    'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';

  // ---- パスキーでログイン（取引先URLのログイン画面と同じ流れ。チャレンジは取引先なしで発行・§2.3） ----
  let passkeyReady = $state(false);
  let passkeyBusy = $state(false);
  let passkeyMessage = $state('');
  let destroyed = false;

  async function finish(next: unknown) {
    // 取引先のページは別のレイアウト・クッキーの path なので、読み込み直しで移る
    if (typeof next === 'string' && next.startsWith('/p/')) await goto(next, { invalidateAll: true });
  }

  async function startConditional() {
    const { loginWithPasskey } = await import('$lib/partner-passkey-client');
    const r = await loginWithPasskey(null, { autofill: true });
    if (destroyed) return;
    if (r.ok) await finish(r.data?.next);
    else if (r.message) passkeyMessage = r.message;
  }

  onMount(() => {
    if (!data.passkeyEnabled) return;
    void (async () => {
      const { passkeySupported } = await import('$lib/partner-passkey-client');
      passkeyReady = await passkeySupported();
      if (passkeyReady) void startConditional();
    })();
  });
  onDestroy(() => {
    destroyed = true;
  });

  async function passkeyLogin() {
    if (passkeyBusy) return;
    passkeyBusy = true;
    passkeyMessage = '';
    try {
      const { loginWithPasskey } = await import('$lib/partner-passkey-client');
      const r = await loginWithPasskey(null);
      if (r.ok) await finish(r.data?.next);
      else {
        passkeyMessage = r.message;
        void startConditional();
      }
    } finally {
      passkeyBusy = false;
    }
  }
</script>

<svelte:head>
  <title>山人 取引先さま専用予約</title>
  <meta name="robots" content="noindex, nofollow" />
  <!-- 取引先ページと同じ文字の大きさ（/p/<token>/+layout.svelte） -->
  <style>
    html { font-size: 112.5%; }
    @media (min-width: 1024px) {
      html { font-size: clamp(100%, 75% + 0.3125vw, 112.5%); }
    }
  </style>
</svelte:head>

<div class="min-h-screen bg-stone-50 text-brand-900" style={`--pt-accent:${PARTNER_DEFAULT_ACCENT.accent};--pt-accent-soft:${PARTNER_DEFAULT_ACCENT.accentSoft}`}>
  <header class="border-b border-stone-200 bg-white">
    <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
      <h1 class="font-display text-lg tracking-wide text-brand-900 sm:text-xl">山人</h1>
      <p class="rounded-full bg-[var(--pt-accent-soft)] px-2.5 py-0.5 text-xs font-medium text-[var(--pt-accent)]">取引先さま専用</p>
    </div>
  </header>

  <main class="mx-auto max-w-md px-4 py-12 sm:py-16">
    <form
      method="POST"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          submitting = false;
          await update({ reset: false });
        };
      }}
      class="rounded-xl border border-stone-200 bg-white p-6 sm:p-8"
    >
      <h2 class="mb-1 text-2xl font-bold">ログイン</h2>
      <p class="mb-6 text-sm leading-5 text-stone-500">取引先さま専用の料金カレンダー・ご予約のページです。発行されたログインIDでお入りください。</p>
      {#if form?.message}
        <p class="mb-4 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-base text-rose-700" role="alert">{form.message}</p>
      {/if}
      {#if passkeyMessage}
        <p class="mb-4 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-sm text-rose-700" role="alert">{passkeyMessage}</p>
      {/if}
      <label class="mb-3 block">
        <span class="mb-1 block text-base font-medium">ログインID</span>
        <input
          name="login_id"
          value={form?.loginId ?? ''}
          required
          autocomplete={data.passkeyEnabled ? 'username webauthn' : 'username'}
          autocapitalize="off"
          class={inputClass}
        />
      </label>
      <label class="mb-5 block">
        <span class="mb-1 block text-base font-medium">パスワード</span>
        <input name="password" type="password" required autocomplete="current-password" class={inputClass} />
      </label>
      <Turnstile action="partner-login" />
      <button type="submit" disabled={submitting} class="w-full rounded-lg bg-accent-600 px-4 py-3 text-base font-medium text-white transition hover:bg-accent-500 disabled:opacity-60">
        {submitting ? 'ログイン中…' : 'ログイン'}
      </button>
      {#if passkeyReady}
        <div class="my-4 flex items-center gap-3 text-xs text-stone-400"><span class="h-px flex-1 bg-stone-200"></span>または<span class="h-px flex-1 bg-stone-200"></span></div>
        <button
          type="button"
          onclick={() => void passkeyLogin()}
          disabled={passkeyBusy}
          class="w-full rounded-lg border border-stone-300 bg-white px-4 py-3 text-base font-medium text-stone-800 transition hover:bg-stone-50 disabled:opacity-60"
        >
          {passkeyBusy ? '確認しています…' : 'パスキーでログイン'}
        </button>
      {/if}
      <p class="mt-4 text-sm leading-5 text-stone-500">パスワードを忘れた場合は、貴社のマスタユーザーまたはご担当の宿へ再設定をご依頼ください。</p>
      <p class="mt-3 border-t border-stone-100 pt-3 text-xs leading-5 text-stone-500">{ONE_PERSON_ONE_ID_NOTICE}</p>
    </form>
  </main>
</div>
