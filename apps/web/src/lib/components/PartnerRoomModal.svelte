<script lang="ts">
  // 取引先専用ページ: お部屋の紹介をその場で見せるモーダル（料金カレンダー・プランのカレンダーの日別パネルから開く）。
  // 中身は「お部屋」ページと同じ部品（PartnerContentBody）。予約の流れを離れずに部屋を確かめられる。
  import PartnerContentBody from './PartnerContentBody.svelte';
  import { roomAnchor, roomParts, type PartnerRoomContent } from '$lib/partner-contents';

  let { room = $bindable(null), token }: { room: PartnerRoomContent | null; token: string } = $props();
  let dialog = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!room) return;
    dialog?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });
  const parts = $derived(room ? roomParts(room.name) : { building: '', room: '' });
</script>

<svelte:window onkeydown={(e) => { if (room && e.key === 'Escape') { e.stopPropagation(); room = null; } }} />

{#if room}
  <div class="fixed inset-0 z-[100] flex items-end justify-center sm:items-center" role="presentation">
    <button type="button" class="absolute inset-0 bg-stone-950/55" aria-label="閉じる" onclick={() => (room = null)}></button>
    <div bind:this={dialog} data-room-info tabindex="-1" role="dialog" aria-modal="true" aria-label={parts.room} class="relative flex max-h-[90dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:w-[min(92vw,820px)] sm:rounded-2xl">
      <div class="flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 sm:px-6">
        <div class="min-w-0">
          {#if parts.building}<p class="text-xs tracking-wider text-stone-500">{parts.building}</p>{/if}
          <h2 class="truncate text-lg font-bold">{parts.room}</h2>
        </div>
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-stone-600 hover:bg-stone-100" aria-label="閉じる" onclick={() => (room = null)}>×</button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        <p class="mb-3 text-sm text-stone-500">
          {#if room.headline && room.headline !== room.name}{room.headline}・{/if}定員 {room.capacityMin === room.capacityMax ? room.capacityMax : `${room.capacityMin}〜${room.capacityMax}`}名
        </p>
        <PartnerContentBody photos={room.photos} description={room.description} specs={room.specs} sections={room.sections} amenities={room.amenities} detailLabel="浴室・アメニティ・設備" />
      </div>
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-stone-200 px-4 py-3 sm:px-6">
        <a href={`/p/${token}/rooms#${roomAnchor(room.code)}`} target="_blank" rel="noopener" class="text-sm text-[var(--pt-accent)] underline underline-offset-4">お部屋のご紹介ページで見る ↗</a>
        <button type="button" onclick={() => (room = null)} class="rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">閉じる</button>
      </div>
    </div>
  </div>
{/if}
