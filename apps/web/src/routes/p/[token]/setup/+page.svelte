<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string } } = $props();
  let submitting = $state(false);
  const inputClass =
    'w-full rounded-lg border border-[var(--pt-line-strong)] bg-[var(--pt-surface)] px-3.5 py-2.5 text-base outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
</script>

<svelte:head>
  <title>パスワード設定 | {data.portal.facilityName} 料金カレンダー</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-md px-4 py-12 sm:py-16">
  {#if !data.setupToken}
    <div class="rounded-2xl border border-[var(--pt-line)] bg-[var(--pt-surface)] p-6 text-base leading-6">
      <p>このリンクは無効か、有効期限が切れています。</p>
      <p class="mt-2 text-[var(--pt-muted)]">お手数ですが、ご担当の宿へパスワード設定リンクの再発行をご依頼ください。</p>
    </div>
  {:else}
    <form
      method="POST"
      use:enhance={() => {
        submitting = true;
        return async ({ update }) => {
          submitting = false;
          await update();
        };
      }}
      class="rounded-2xl border border-[var(--pt-line)] bg-[var(--pt-surface)] p-6 shadow-[0_8px_30px_rgba(31,29,21,0.06)] sm:p-8"
    >
      <h2 class="mb-1 text-2xl font-bold">{data.isReset ? 'パスワードの再設定' : 'パスワードの設定'}</h2>
      <p class="mb-4 text-base text-[var(--pt-muted)]">ログインID: <span class="font-mono text-[var(--pt-ink)]">{data.loginId}</span></p>
      {#if form?.message}
        <p class="mb-4 rounded-lg border border-[var(--pt-sun)]/30 bg-[var(--pt-sun)]/5 px-3 py-2 text-base text-[var(--pt-sun)]">{form.message}</p>
      {/if}
      <input type="hidden" name="token" value={data.setupToken} />
      <input type="text" name="username" value={data.loginId} autocomplete="username" class="hidden" readonly />
      <label class="mb-3 block">
        <span class="mb-1 block text-base font-medium">新しいパスワード（10文字以上）</span>
        <input name="password" type="password" required minlength="10" autocomplete="new-password" class={inputClass} />
      </label>
      <label class="mb-5 block">
        <span class="mb-1 block text-base font-medium">確認のためもう一度</span>
        <input name="password_confirm" type="password" required minlength="10" autocomplete="new-password" class={inputClass} />
      </label>
      <button type="submit" disabled={submitting} class="w-full rounded-full bg-[var(--pt-ink)] px-4 py-3 text-base font-medium tracking-wide text-white transition hover:bg-[var(--pt-accent)] disabled:opacity-60">
        {submitting ? '設定中…' : '設定してログイン'}
      </button>
    </form>
  {/if}
</main>
