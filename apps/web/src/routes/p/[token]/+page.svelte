<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { onDestroy, onMount } from 'svelte';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import { ONE_PERSON_ONE_ID_NOTICE } from '$lib/partner-passkey';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; loginId?: string } } = $props();
  let submitting = $state(false);
  const token = $derived($page.params.token ?? '');
  const inputClass =
    'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';

  // ---- パスキーでログイン（docs/auth-hardening.md §6.5・S6）。本番ドメインとローカルだけ（data.passkeyEnabled） ----
  // Conditional UI: ログインID欄にフォーカスするとブラウザがパスキーの候補を出す（autocomplete="username webauthn"）。
  // ボタン: その場でパスキーを選ぶ。失敗したらパスワードのフォームをそのまま使ってもらう。
  let passkeyReady = $state(false);
  let passkeyBusy = $state(false);
  let passkeyMessage = $state('');
  let destroyed = false;

  async function finish(next: unknown) {
    await goto(String(next || `/p/${token}/calendar`), { invalidateAll: true });
  }

  async function startConditional() {
    const { loginWithPasskey } = await import('$lib/partner-passkey-client');
    const r = await loginWithPasskey(token, { autofill: true });
    if (destroyed) return;
    if (r.ok) await finish(r.data?.next);
    else if (r.message) passkeyMessage = r.message;
  }

  onMount(() => {
    if (!data.passkeyEnabled || data.unavailable) return;
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
      const r = await loginWithPasskey(token);
      if (r.ok) await finish(r.data?.next);
      else {
        passkeyMessage = r.message;
        // 候補の表示（Conditional UI）をもう一度待つ
        void startConditional();
      }
    } finally {
      passkeyBusy = false;
    }
  }
</script>

<svelte:head>
  <title>{partnerTitle(data.portal)}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-md px-4 py-12 sm:py-16">
  {#if data.unavailable}
    <p class="rounded-xl border border-stone-200 bg-white p-6 text-base leading-6">{data.unavailable}</p>
  {:else}
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
      <p class="mb-6 text-sm leading-5 text-stone-500">貴社専用の料金カレンダーです。発行されたログインIDでお入りください。</p>
      {#if form?.message}
        <p class="mb-4 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-base text-rose-700">{form.message}</p>
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
        <p class="mt-2 text-xs leading-5 text-stone-500">「アカウント」→「セキュリティ」でパスキーを登録すると、パスワード無しでログインできます。</p>
      {/if}
      <p class="mt-4 text-sm leading-5 text-stone-500">パスワードを忘れた場合は、ご担当の宿へ再設定リンクの発行をご依頼ください。</p>
      <p class="mt-3 border-t border-stone-100 pt-3 text-xs leading-5 text-stone-500">{ONE_PERSON_ONE_ID_NOTICE}</p>
    </form>
  {/if}
</main>
