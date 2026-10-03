<script lang="ts">
  // 取引先専用ページ: 「キャンセルポリシー」「お子様について」の2列の表（2026-10-03）。行も案内文も無ければ何も出さない。
  import type { TermsRow } from '$lib/partner-plan-terms';

  let { title, rows, note = '' }: { title: string; rows: TermsRow[]; note?: string } = $props();
</script>

{#if rows.length || note}
  <section>
    {#if title}<h4 class="mb-3 text-lg font-bold">{title}</h4>{/if}
    {#if rows.length}
      <table class="w-full border-collapse overflow-hidden rounded-lg border border-stone-200 bg-white text-sm">
        <tbody>
          {#each rows as r (r.label)}
            <tr class="border-b border-stone-200 last:border-b-0">
              <th class="w-2/5 bg-stone-50 px-3 py-2.5 text-left font-normal text-stone-600 sm:w-1/4 sm:px-4">{r.label}</th>
              <td class="px-3 py-2.5 sm:px-4">{r.value}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
    {#if note}<p class="mt-2 whitespace-pre-line text-sm text-stone-600">{note}</p>{/if}
  </section>
{/if}
