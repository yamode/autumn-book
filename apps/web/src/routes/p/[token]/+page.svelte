<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; loginId?: string } } = $props();
  let submitting = $state(false);
  const inputClass =
    'w-full rounded-lg border border-[var(--pt-line-strong)] bg-[var(--pt-surface)] px-3.5 py-2.5 text-base outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
</script>

<svelte:head>
  <title>ログイン | {data.portal.facilityName} 料金カレンダー</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-md px-4 py-12 sm:py-16">
  {#if data.unavailable}
    <p class="rounded-2xl border border-[var(--pt-line)] bg-[var(--pt-surface)] p-6 text-base leading-6">{data.unavailable}</p>
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
      class="rounded-2xl border border-[var(--pt-line)] bg-[var(--pt-surface)] p-6 shadow-[0_8px_30px_rgba(31,29,21,0.06)] sm:p-8"
    >
      <h2 class="mb-1 text-2xl font-bold">ログイン</h2>
      <p class="mb-6 text-sm leading-5 text-[var(--pt-muted)]">貴社専用の料金カレンダーです。発行されたログインIDでお入りください。</p>
      {#if form?.message}
        <p class="mb-4 rounded-lg border border-[var(--pt-sun)]/30 bg-[var(--pt-sun)]/5 px-3 py-2 text-base text-[var(--pt-sun)]">{form.message}</p>
      {/if}
      <label class="mb-3 block">
        <span class="mb-1 block text-base font-medium">ログインID</span>
        <input name="login_id" value={form?.loginId ?? ''} required autocomplete="username" autocapitalize="off" class={inputClass} />
      </label>
      <label class="mb-5 block">
        <span class="mb-1 block text-base font-medium">パスワード</span>
        <input name="password" type="password" required autocomplete="current-password" class={inputClass} />
      </label>
      <button type="submit" disabled={submitting} class="w-full rounded-full bg-[var(--pt-ink)] px-4 py-3 text-base font-medium tracking-wide text-white transition hover:bg-[var(--pt-accent)] disabled:opacity-60">
        {submitting ? 'ログイン中…' : 'ログイン'}
      </button>
      <p class="mt-4 text-sm leading-5 text-[var(--pt-muted)]">パスワードを忘れた場合は、ご担当の宿へ再設定リンクの発行をご依頼ください。</p>
    </form>
  {/if}
</main>
