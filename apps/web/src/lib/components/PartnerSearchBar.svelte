<script lang="ts">
  // 取引先専用ページ・料金カレンダーの検索バー。見た目と操作は共通部品 StaySearchBar（HP 配布の <yamado-search-bar> と同じもの）。
  // ここでは日付パネルに取引先の料金（PartnerStayPanel = token 付きの月データ）を差し込むだけ。
  // 下書きを変えただけでは検索しない（「検索」「この日程で検索」で確定）。
  import StaySearchBar from './stay-search/StaySearchBar.svelte';
  import PartnerStayPanel from './PartnerStayPanel.svelte';

  let {
    token,
    date = $bindable(''),
    nights = $bindable(1),
    guests = $bindable(2),
    rooms = $bindable(1),
    maxNights,
    maxRooms,
    showInventory,
    today,
    open = $bindable<'' | 'date' | 'guests'>(''),
    crossType = true,
    onSearch
  }: {
    token: string;
    date: string;
    nights: number;
    guests: number;
    rooms: number;
    maxNights: number;
    maxRooms: number;
    showInventory: boolean;
    today: string;
    open?: '' | 'date' | 'guests';
    /** 室数を部屋タイプ横断で数える（足りなければ組み合わせを出す。取引先・特別会員とも） */
    crossType?: boolean;
    onSearch: () => void;
  } = $props();
</script>

<!-- お部屋の紹介のモーダルを開いているときは、パネルの外を押しても閉じない -->
<StaySearchBar bind:date bind:nights bind:guests bind:rooms bind:open {maxRooms} {crossType} keepOpen={() => !!document.querySelector('[data-room-info]')} {onSearch}>
  {#snippet datePanel({ close })}
    <PartnerStayPanel {token} bind:date bind:nights {guests} {rooms} {maxNights} {showInventory} {today} onApply={onSearch} onClose={close} />
  {/snippet}
</StaySearchBar>
