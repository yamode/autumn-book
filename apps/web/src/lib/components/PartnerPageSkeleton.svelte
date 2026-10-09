<script lang="ts">
  // 取引先ページ: メインメニューで移る間に、本文の位置へ出す「読み込み中」の骨組み（2026-10-10）。
  // 行き先のページの形（幅・見出し・カード／一覧／入力欄）だけをまねた軽いもの。中身は行き先のページが届いてから。
  // 出し入れは routes/p/[token]/+layout.svelte（120ms 待ってから出す）。
  let { path, label }: { path: string; label: string } = $props();
  const width = $derived(
    path === 'calendar' || path === 'plans' || path === 'rooms' ? 'max-w-6xl' : path === 'rate-sheet' ? 'max-w-3xl' : 'max-w-4xl'
  );
</script>

<main class={`mx-auto ${width} px-4 pb-10 pt-6 sm:px-6`} aria-busy="true" aria-label={`${label}を読み込んでいます`}>
  <p class="sr-only" role="status">{label}を読み込んでいます…</p>
  {#if path === 'calendar' || path === 'plans'}
    <!-- 検索バー＋カード -->
    <div class="shimmer h-14 w-full rounded-xl"></div>
    <div class="mt-6 space-y-2"><div class="shimmer h-5 w-56"></div><div class="shimmer h-3.5 w-80 max-w-full opacity-70"></div></div>
    <div class="mt-4 space-y-6">
      {#each [0, 1] as i (i)}
        <div class="overflow-hidden rounded-lg border border-stone-200 bg-white md:grid md:grid-cols-[280px_minmax(0,1fr)]">
          <div class="shimmer aspect-[16/10] w-full rounded-none"></div>
          <div class="space-y-3 p-5"><div class="shimmer h-4 w-11/12"></div><div class="shimmer h-4 w-2/3"></div><div class="shimmer ml-auto mt-6 h-9 w-32"></div></div>
        </div>
      {/each}
    </div>
  {:else}
    <h2 class="text-2xl font-bold">{label}</h2>
    {#if path === 'account'}
      <div class="mt-5 flex gap-2 border-b border-stone-200 pb-2">{#each [0, 1, 2] as i (i)}<div class="shimmer h-6 w-24"></div>{/each}</div>
      <div class="mt-5 grid gap-4 rounded-xl border border-stone-200 bg-white p-5 sm:grid-cols-2 sm:p-6">
        {#each [0, 1, 2, 3] as i (i)}<div class="space-y-1.5"><div class="shimmer h-3.5 w-20"></div><div class="shimmer h-10 w-full"></div></div>{/each}
      </div>
    {:else if path === 'bookings'}
      <div class="mt-5 shimmer h-9 w-80 max-w-full rounded-full"></div>
      <ul class="mt-4 grid gap-3">
        {#each [0, 1, 2] as i (i)}
          <li class="flex items-start justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
            <div class="min-w-0 flex-1 space-y-2.5"><div class="shimmer h-3.5 w-32 opacity-70"></div><div class="shimmer h-5 w-2/3"></div><div class="shimmer h-3.5 w-1/2 opacity-70"></div></div>
            <div class="shimmer h-6 w-20"></div>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="mt-2 shimmer h-3.5 w-72 max-w-full opacity-70"></div>
      <div class="mt-5 space-y-5">
        {#each [0, 1] as i (i)}
          <div class="space-y-3 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
            <div class="shimmer h-5 w-1/3"></div>
            <div class="shimmer h-4 w-11/12 opacity-70"></div>
            <div class="shimmer h-4 w-4/5 opacity-70"></div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</main>
