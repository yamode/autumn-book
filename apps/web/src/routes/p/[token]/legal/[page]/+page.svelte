<script lang="ts">
  // 取引先専用ページ: 特定商取引法に基づく表記・プライバシーポリシー・宿泊約款（中身は公式サイトと同じ）。
  import { page } from '$app/stores';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import { partnerTitle } from '$lib/partner-title';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const token = $derived($page.params.token);
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, data.doc.title)}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
  <a href={`/p/${token}${data.portal.loginId ? '/calendar' : ''}`} class="text-sm text-stone-500 hover:text-brand-800">← {data.portal.loginId ? '料金カレンダーへ戻る' : 'ログイン画面へ戻る'}</a>
  <h2 class="mt-2 text-2xl font-bold">{data.doc.title}</h2>
  <section class="mt-4 rounded-xl border border-stone-200 bg-white p-5 sm:p-7">
    <MarkdownView source={data.doc.body} />
  </section>
</main>
