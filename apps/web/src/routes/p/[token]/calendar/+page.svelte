<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  // 取引先専用ページ: 料金カレンダー（2026-10-06 に一休型へ一本化。旧「お部屋とプラン」）。
  // 公開期間の料金の幅（2026-10-09 復活）→ 検索バー → 並び順 → 部屋タイプごとの全幅カード。中身はプランのご紹介と共通の PartnerStaySearch。
  import { page } from '$app/stores';
  import PartnerPriceRange from '$lib/components/PartnerPriceRange.svelte';
  import PartnerStaySearch from '$lib/components/PartnerStaySearch.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, '料金カレンダー')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<!-- オンの施設が1つも無い取引先（N9）は検索・カードを出さない（ヘッダーの下の案内だけ・2026-10-09） -->
{#if !data.portal.noFacilityMessage}
  <!-- 施設を切り替えると、その施設の幅を読み直す（key で作り直す） -->
  <div class="mx-auto max-w-6xl px-4 pt-6 sm:px-6">
    {#key data.portal.facilityId}
      <PartnerPriceRange token={$page.params.token ?? ''} planNames={data.planNames} />
    {/key}
  </div>
  <PartnerStaySearch {data} view="room" />
{/if}
