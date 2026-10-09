<script lang="ts">
  // 取引先ページの「専用特典」の並び（2026-10-03）。
  // wide: 画像あり → 左に画像・右に文章の2カラム（スマホは画像の下に文章）。プラン紹介で使う。
  // compact: 画像を上に全幅で出す縦積み。狭い所で使う。
  // plan: プランのご紹介の一覧（検索バーの下）。プランのカードと同じ形（左に 280px・16:10 の写真、文字もプランと同じ大きさ）（2026-10-09 指示）
  // showImages=false: 画像を出さず文字だけ（予約入力の右の欄。2026-10-06 指示「予約確認では特典画像は不要」）
  type Perk = { id: string; title: string; description: string; imageUrl: string };
  let { perks, variant = 'wide', showImages = true }: { perks: Perk[]; variant?: 'wide' | 'compact' | 'plan'; showImages?: boolean } = $props();
</script>

<ul class={`grid ${variant === 'plan' ? 'gap-4' : 'gap-3'}`}>
  {#each perks as k (k.id)}
    <li class={`overflow-hidden rounded-lg bg-white ${variant === 'plan' ? 'border border-stone-200 shadow-[0_1px_4px_rgba(0,0,0,0.08)]' : 'border border-[var(--pt-accent)]/20'}`}>
      {#if variant === 'plan'}
        <div class={`gap-6 px-5 py-5 sm:px-6 ${k.imageUrl && showImages ? 'md:grid md:grid-cols-[280px_minmax(0,1fr)]' : ''}`}>
          {#if k.imageUrl && showImages}<img src={k.imageUrl} alt={k.title} loading="lazy" class="mb-4 aspect-[16/10] w-full rounded-md object-cover md:mb-0" />{/if}
          <div class="min-w-0">
            <p class="text-lg font-bold leading-snug text-brand-900 sm:text-xl">{k.title}</p>
            {#if k.description}<p class="mt-2 whitespace-pre-wrap text-sm leading-7 text-stone-700">{k.description}</p>{/if}
          </div>
        </div>
      {:else if k.imageUrl && showImages && variant === 'wide'}
        <div class="grid gap-4 p-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-6 sm:p-4">
          <img src={k.imageUrl} alt={k.title} loading="lazy" class="aspect-[4/3] w-full rounded-md object-cover" />
          <div class="min-w-0 sm:py-1">
            <p class="text-xl font-bold leading-snug">{k.title}</p>
            {#if k.description}<p class="mt-3 whitespace-pre-wrap text-base leading-8 text-stone-700">{k.description}</p>{/if}
          </div>
        </div>
      {:else}
        {#if k.imageUrl && showImages}<img src={k.imageUrl} alt={k.title} loading="lazy" class="aspect-[4/3] w-full object-cover" />{/if}
        <div class="px-3.5 py-3">
          <p class="text-base font-bold leading-snug">{k.title}</p>
          {#if k.description}<p class="mt-1.5 whitespace-pre-wrap text-[15px] leading-7 text-stone-700">{k.description}</p>{/if}
        </div>
      {/if}
    </li>
  {/each}
</ul>
