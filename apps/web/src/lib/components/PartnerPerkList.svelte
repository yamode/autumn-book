<script lang="ts">
  // 取引先ページの「専用特典」の並び（2026-10-03）。
  // wide: 画像あり → 左に画像・右に文章の2カラム（スマホは画像の下に文章）。プラン紹介で使う。
  // compact: 画像を上に全幅で出す縦積み。予約フォームの右の料金欄など狭い所で使う。
  type Perk = { id: string; title: string; description: string; imageUrl: string };
  let { perks, variant = 'wide' }: { perks: Perk[]; variant?: 'wide' | 'compact' } = $props();
</script>

<ul class="grid gap-3">
  {#each perks as k (k.id)}
    <li class="overflow-hidden rounded-lg border border-[var(--pt-accent)]/20 bg-white">
      {#if k.imageUrl && variant === 'wide'}
        <div class="grid gap-4 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6 sm:p-4">
          <img src={k.imageUrl} alt={k.title} loading="lazy" class="aspect-[4/3] w-full rounded-md object-cover" />
          <div class="min-w-0 sm:py-1">
            <p class="text-lg font-bold leading-snug">{k.title}</p>
            {#if k.description}<p class="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-600">{k.description}</p>{/if}
          </div>
        </div>
      {:else}
        {#if k.imageUrl}<img src={k.imageUrl} alt={k.title} loading="lazy" class="aspect-[4/3] w-full object-cover" />{/if}
        <div class="px-3 py-2.5">
          <p class="font-bold leading-snug">{k.title}</p>
          {#if k.description}<p class="mt-1 whitespace-pre-wrap text-sm leading-6 text-stone-600">{k.description}</p>{/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>
