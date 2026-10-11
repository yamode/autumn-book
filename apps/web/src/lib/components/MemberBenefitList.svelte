<script lang="ts">
  // 特別会員の専用ページ: 特典の 2 段目「会員特典（GRADE）」（docs/vip-member-page.md §5.2・§13.8 Q8）。
  // 中身はサーバが作る 3 行（還元率・キャンセル方式・ポイント利用可・memberBenefitLines）。
  // 専用ページの規定（方式が「お客さまに有利な方」「専用ページの規定」のとき）があれば、その表を小さく添える。
  import { describeCancelRule, type MemberCancelRule } from '$lib/partner-member-page';

  let {
    rankLabel,
    lines,
    cancelRules = null,
    compact = false
  }: {
    rankLabel: string;
    lines: string[];
    /** 専用ページのキャンセル規定（会員グレードの規定の方式では null） */
    cancelRules?: MemberCancelRule[] | null;
    /** 狭い所（予約の確認の右欄など）は文字を小さく */
    compact?: boolean;
  } = $props();
</script>

<section class={`rounded-lg border border-stone-200 bg-white ${compact ? 'px-3.5 py-3' : 'px-4 py-4 sm:px-5'}`}>
  <h3 class={`flex flex-wrap items-center gap-2 font-bold text-brand-900 ${compact ? 'text-sm' : 'text-base'}`}>
    会員特典
    <span class="rounded-full border border-stone-300 bg-stone-50 px-2 py-0.5 text-[11px] font-bold tracking-wide text-stone-600">◆ {rankLabel}</span>
  </h3>
  <ul class={`mt-2 space-y-1.5 ${compact ? 'text-xs leading-5' : 'text-sm leading-6'} text-stone-700`}>
    {#each lines as line, i (i)}
      <li class="flex gap-2"><span class="mt-[0.45em] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--pt-accent,#57534e)]"></span><span class="min-w-0 break-words">{line}</span></li>
    {/each}
  </ul>
  {#if cancelRules && cancelRules.length}
    <p class={`mt-3 font-medium text-stone-600 ${compact ? 'text-xs' : 'text-sm'}`}>専用ページのキャンセル規定</p>
    <ul class={`mt-1 flex flex-wrap gap-x-4 gap-y-0.5 ${compact ? 'text-xs' : 'text-sm'} text-stone-600`}>
      {#each cancelRules as r (r.days_before)}<li class="tabular-nums">{describeCancelRule(r)}</li>{/each}
    </ul>
  {/if}
</section>
