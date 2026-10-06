<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  // 取引先専用ページ: プランのご紹介（2026-10-07 に一休型へ）。プランごとに写真・名前・短い紹介と、
  // 選べるお部屋の行をカードにまとめ、「詳細・予約」でプラン詳細のモーダルを開く。
  // 検索バー・料金の読み込み・モーダルは料金カレンダーと共通の PartnerStaySearch。
  import PartnerStaySearch from '$lib/components/PartnerStaySearch.svelte';
  import PartnerPerkList from '$lib/components/PartnerPerkList.svelte';

  let { data } = $props();
</script>

<svelte:head><title>{partnerTitle(data.portal, 'プランのご紹介')}</title><meta name="robots" content="noindex, nofollow" /></svelte:head>

{#if data.commonPerks.length}
  <!-- 全プラン共通の専用特典（取引先専用ページからのご予約に付く） -->
  <div class="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
    <section class="rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 sm:px-5">
      <p class="text-sm font-bold text-[var(--pt-accent)]">専用特典（すべてのプラン）</p>
      <div class="mt-2"><PartnerPerkList perks={data.commonPerks} /></div>
      <p class="mt-1.5 text-xs text-stone-500">このページからご予約いただいた場合に付きます。</p>
    </section>
  </div>
{/if}

<PartnerStaySearch {data} view="plan" />
