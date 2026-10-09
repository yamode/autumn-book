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

<!-- 全プラン共通の専用特典（取引先専用ページからのご予約に付く）。検索バーの下・プラン一覧の上に、プランのカードと同じ形で出す（2026-10-09 指示） -->
<PartnerStaySearch {data} view="plan">
  {#snippet below()}
    {#if data.commonPerks.length}
      <section class="mt-6">
        <p class="text-lg font-bold">{data.portal.partnerName ? `${data.portal.partnerName}様専用特典` : '専用特典'}（すべてのプラン）</p>
        <p class="text-sm text-stone-500">このページからご予約いただいた場合に付きます。</p>
        <div class="mt-4"><PartnerPerkList perks={data.commonPerks} variant="plan" /></div>
      </section>
    {/if}
  {/snippet}
</PartnerStaySearch>
