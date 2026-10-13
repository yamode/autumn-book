<script lang="ts">
  // 取引先ページのエラー（アクセス制限の拒否・停止中・見つからない等）。取引先ページの枠（+layout.svelte）の中に出す
  import { page } from '$app/stores';

  const title = $derived(
    $page.status === 403 ? 'ご利用いただけません' : $page.status === 404 ? 'ページが見つかりません' : '現在ご利用いただけません'
  );
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-md px-4 py-12 sm:py-16">
  <section class="rounded-xl border border-stone-200 bg-white p-6 sm:p-8">
    <h2 class="mb-2 text-xl font-bold">{title}</h2>
    <p class="text-base leading-7 text-stone-600">{$page.error?.message ?? 'しばらくしてからお試しください。'}</p>
  </section>
</main>
