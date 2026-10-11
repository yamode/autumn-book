<script lang="ts">
  // 特別会員の専用ページ: 滞在アレンジ（オプション）の追加（docs/vip-member-page.md §13.4.3b）。
  // 入力フォームは公式マイページと同じ部品（lib/components/booking/OptionOrderForm.svelte・送り先 ?/add）。
  import { partnerTitle } from '$lib/partner-title';
  import OptionOrderForm from '$lib/components/booking/OptionOrderForm.svelte';

  let { data, form } = $props();
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, '滞在アレンジの追加')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
  <nav class="mb-4 text-sm text-stone-500"><a href={data.hrefs.back} class="text-sky-700 hover:underline">{data.code}</a> / 滞在アレンジの追加</nav>
  <h2 class="text-2xl font-bold">滞在アレンジ</h2>
  <p class="mt-1 text-sm leading-6 text-stone-500">お食事・スパ・記念日のご用意などを事前にお申し込みいただけます。お支払いは現地でお願いします。</p>
  {#if form?.message}
    <p class="mt-4 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-base text-rose-700" role="alert">{form.message}</p>
  {/if}
  <OptionOrderForm {data} />
</main>
