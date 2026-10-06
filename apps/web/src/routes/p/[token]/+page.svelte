<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; loginId?: string } } = $props();
  let submitting = $state(false);
  const inputClass =
    'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-base outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
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
      <label class="mb-3 block">
        <span class="mb-1 block text-base font-medium">ログインID</span>
        <input name="login_id" value={form?.loginId ?? ''} required autocomplete="username" autocapitalize="off" class={inputClass} />
      </label>
      <label class="mb-5 block">
        <span class="mb-1 block text-base font-medium">パスワード</span>
        <input name="password" type="password" required autocomplete="current-password" class={inputClass} />
      </label>
      <button type="submit" disabled={submitting} class="w-full rounded-lg bg-accent-600 px-4 py-3 text-base font-medium text-white transition hover:bg-accent-500 disabled:opacity-60">
        {submitting ? 'ログイン中…' : 'ログイン'}
      </button>
      <p class="mt-4 text-sm leading-5 text-stone-500">パスワードを忘れた場合は、ご担当の宿へ再設定リンクの発行をご依頼ください。</p>
    </form>
  {/if}
</main>
