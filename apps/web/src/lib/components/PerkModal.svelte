<script lang="ts">
  // 特典のバナー（PerkBanners）を押したときに開くモーダル。
  // 公式HP限定特典は紹介文テンプレートの本文（Markdown）、取引先専用特典は特典の一覧（写真・説明）を見せる。
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import MarkdownView from './MarkdownView.svelte';
  import PartnerPerkList from './PartnerPerkList.svelte';

  export type PerkModalContent = {
    label: string;
    /** 公式HP限定特典など: テンプレートの本文（Markdown） */
    body?: string;
    /** 取引先専用特典: 特典の一覧 */
    perks?: { id: string; title: string; description: string; imageUrl: string }[];
    note?: string;
  };

  let { content = $bindable(null) }: { content: PerkModalContent | null } = $props();
  let dialog = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (content) dialog?.focus();
  });
</script>

<svelte:window onkeydown={(e) => { if (content && e.key === 'Escape') { e.stopImmediatePropagation(); content = null; } }} />

{#if content}
  <div class="fixed inset-0 z-[110] flex items-end justify-center sm:items-center" role="presentation">
    <button type="button" class="absolute inset-0 bg-stone-950/50" aria-label="閉じる" onclick={() => (content = null)} transition:fade={{ duration: 180 }}></button>
    <div bind:this={dialog} data-room-info transition:fly={{ y: 24, duration: 280, easing: cubicOut }} tabindex="-1" role="dialog" aria-modal="true" aria-label={content.label} class="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:w-[min(94vw,760px)] sm:rounded-2xl">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-5 py-4">
        <h2 class="text-xl font-bold text-brand-900">{content.label}</h2>
        <button type="button" class="flex h-9 w-9 items-center justify-center rounded-full text-xl text-stone-600 hover:bg-stone-100" aria-label="閉じる" onclick={() => (content = null)}>×</button>
      </div>
      <!-- 本文は読みやすい大きさに（Markdown の段落も 17px 相当） -->
      <div class="perk-modal-body min-h-0 flex-1 overflow-y-auto px-5 py-5 text-[17px] leading-8 sm:px-6">
        {#if content.body}<MarkdownView source={content.body} />{/if}
        {#if content.perks?.length}<PartnerPerkList perks={content.perks} />{/if}
        {#if content.note}<p class="mt-4 text-sm text-stone-600">{content.note}</p>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .perk-modal-body :global(.prose-ab p),
  .perk-modal-body :global(.prose-ab li) {
    font-size: 1em;
    line-height: 1.9;
  }
</style>
