<script lang="ts">
  // 取引先専用ページの写真ギャラリー（2026-10-03）。
  // メイン写真は左右の矢印で切り替え、右下に「n/全体」。下にサムネイル（はみ出す分は矢印で横送り）。
  // メイン写真を押すとモーダルで大きく開く（矢印・サムネイル・キャプション・Esc/←/→・スワイプ）。
  import type { ContentPhoto } from '$lib/partner-contents';

  let { photos }: { photos: ContentPhoto[] } = $props();

  let current = $state(0);
  let open = $state(false);
  const count = $derived(photos.length);
  const index = $derived(Math.min(current, Math.max(count - 1, 0)));
  const main = $derived(photos[index]);

  function go(d: number) {
    if (count < 2) return;
    current = (index + d + count) % count;
  }

  // サムネイルの横送り（矢印ボタン）。選んだ写真のサムネイルは見える位置へ寄せる。
  let strip = $state<HTMLDivElement>();
  let canLeft = $state(false);
  let canRight = $state(false);
  function updateArrows() {
    if (!strip) return;
    canLeft = strip.scrollLeft > 4;
    canRight = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4;
  }
  function scrollStrip(d: number) {
    strip?.scrollBy({ left: d * strip.clientWidth * 0.8, behavior: 'smooth' });
  }
  $effect(() => {
    const el = strip?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  });
  $effect(() => {
    if (!strip) return;
    updateArrows();
    const ro = new ResizeObserver(updateArrows);
    ro.observe(strip);
    return () => ro.disconnect();
  });

  // モーダル: 開いている間は背面のスクロールを止め、キーで操作できるようにする
  let modalStrip = $state<HTMLDivElement>();
  $effect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  });
  $effect(() => {
    if (!open) return;
    const el = modalStrip?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });
  function onKey(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') open = false;
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
  }

  // スワイプ（指で左右に払ったら前後の写真へ）
  let touchX: number | null = null;
  const onTouchStart = (e: TouchEvent) => (touchX = e.touches[0]?.clientX ?? null);
  function onTouchEnd(e: TouchEvent) {
    if (touchX === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touchX) - touchX;
    touchX = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  }

  const arrowBtn =
    'absolute top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition hover:bg-black/70';
</script>

<svelte:window onkeydown={onKey} />

{#if main}
  <div>
    <figure class="relative overflow-hidden rounded-xl bg-stone-200" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
      <button type="button" class="block w-full cursor-zoom-in" onclick={() => (open = true)} aria-label="写真を大きく見る">
        <img src={main.url} alt={main.caption} class="aspect-[3/2] w-full object-cover" loading="lazy" decoding="async" />
      </button>
      {#if count > 1}
        <button type="button" class={`${arrowBtn} left-2`} onclick={() => go(-1)} aria-label="前の写真">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <button type="button" class={`${arrowBtn} right-2`} onclick={() => go(1)} aria-label="次の写真">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6" /></svg>
        </button>
        <span class="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{index + 1}/{count}</span>
      {/if}
    </figure>
    {#if main.caption}<p class="mt-1 px-1 text-xs text-stone-500">{main.caption}</p>{/if}

    {#if count > 1}
      <div class="relative mt-2">
        <div bind:this={strip} onscroll={updateArrows} class="flex gap-1.5 overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="写真">
          {#each photos as p, i (p.url)}
            <button
              type="button"
              class={`aspect-[3/2] w-[calc((100%-0.75rem)/3)] shrink-0 overflow-hidden rounded-md border-2 transition sm:w-[calc((100%-1.125rem)/4)] ${i === index ? 'border-[var(--pt-accent)]' : 'border-transparent opacity-70 hover:opacity-100'}`}
              onclick={() => (current = i)}
              aria-label={`写真 ${i + 1}`}
              aria-pressed={i === index}
            >
              <img src={p.url} alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" />
            </button>
          {/each}
        </div>
        {#if canLeft}
          <button type="button" class={`${arrowBtn} left-1 h-8 w-8`} onclick={() => scrollStrip(-1)} aria-label="サムネイルを左へ">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
        {/if}
        {#if canRight}
          <button type="button" class={`${arrowBtn} right-1 h-8 w-8`} onclick={() => scrollStrip(1)} aria-label="サムネイルを右へ">
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        {/if}
      </div>
    {/if}
  </div>

  {#if open}
    <!-- モーダル（背景を押すと閉じる） -->
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-3 sm:p-8" role="dialog" aria-modal="true" aria-label="写真ギャラリー">
      <button type="button" class="absolute inset-0 cursor-default" onclick={() => (open = false)} aria-label="閉じる" tabindex="-1"></button>
      <button type="button" class="absolute right-2 top-2 z-10 p-2 text-3xl leading-none text-white/90 hover:text-white sm:right-4 sm:top-3" onclick={() => (open = false)} aria-label="閉じる">×</button>
      <div class="relative flex max-h-full w-full max-w-5xl flex-col pt-8 sm:pt-0">
        <div role="group" class="relative flex min-h-0 items-center justify-center bg-black" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
          <img src={main.url} alt={main.caption} class="max-h-[70vh] w-full object-contain" decoding="async" />
          {#if count > 1}
            <button type="button" class={`${arrowBtn} left-2 h-11 w-11`} onclick={() => go(-1)} aria-label="前の写真">
              <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <button type="button" class={`${arrowBtn} right-2 h-11 w-11`} onclick={() => go(1)} aria-label="次の写真">
              <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6" /></svg>
            </button>
            <span class="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">{index + 1}/{count}</span>
          {/if}
        </div>
        {#if main.caption}<p class="relative mt-2 text-sm font-medium text-white">{main.caption}</p>{/if}
        {#if count > 1}
          <div bind:this={modalStrip} class="relative mt-3 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {#each photos as p, i (p.url)}
              <button
                type="button"
                class={`h-16 w-24 shrink-0 overflow-hidden rounded border-2 transition sm:h-20 sm:w-32 ${i === index ? 'border-white' : 'border-transparent opacity-60 hover:opacity-100'}`}
                onclick={() => (current = i)}
                aria-label={`写真 ${i + 1}`}
                aria-pressed={i === index}
              >
                <img src={p.url} alt="" class="h-full w-full object-cover" loading="lazy" decoding="async" />
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
{:else}
  <div class="flex aspect-[3/2] items-center justify-center rounded-xl bg-stone-200 text-sm text-stone-500">写真は準備中です</div>
{/if}
