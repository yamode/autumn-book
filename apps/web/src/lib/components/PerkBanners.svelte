<script lang="ts">
  // 予約ボタンの横に並べる特典のバナー（一休の「ダイヤモンド会員特典」「ふるさと納税対象」のような形）。
  // 押すと特典の中身をモーダル（PerkModal）で見せる。公式サイト・取引先ページで共用。
  // official: 公式HP限定特典など（塗りのバナー）／ partner: 取引先専用特典（白地に枠）
  export type PerkBanner = { key: string; label: string; kind: 'official' | 'partner' };

  let { items, onopen }: { items: PerkBanner[]; onopen: (key: string) => void } = $props();
</script>

{#if items.length}
  <div class="flex flex-wrap gap-2.5">
    {#each items as item (item.key)}
      <button
        type="button"
        onclick={() => onopen(item.key)}
        class={`inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-bold transition ${
          item.kind === 'official'
            ? 'bg-gradient-to-r from-teal-700 to-teal-500 text-white shadow-sm hover:brightness-110'
            : 'border border-stone-300 bg-white text-brand-900 hover:border-stone-500'
        }`}
      >
        {#if item.kind === 'official'}
          <svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" aria-hidden="true"><path d="M4.5 3h11l3 4.5L10 17 1.5 7.5z" fill="currentColor" opacity="0.9" /><path d="M1.5 7.5h17M7 3l-1 4.5L10 17l4-9.5L13 3" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="0.8" /></svg>
        {:else}
          <svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0 text-rose-700" aria-hidden="true"><rect x="2.5" y="7" width="15" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M2.5 10.5h15M10 7v10M10 7c-1.5-3-5-3-4.2-.8C6.4 7.3 10 7 10 7zm0 0c1.5-3 5-3 4.2-.8C13.6 7.3 10 7 10 7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
        {/if}
        {item.label}
      </button>
    {/each}
  </div>
{/if}
