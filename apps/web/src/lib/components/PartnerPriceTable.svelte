<script lang="ts">
  // 料金の明細（表）。取引先ページの予約確認・予約一覧で共通。
  // 宿泊料金（割引前）→ 予約時決済割引 → 入湯税 → 合計 の順に並べる。宿泊料金はキャンセル料の基準（入湯税は含めない）。
  let {
    lodging,
    guests,
    nights,
    discount = 0,
    discountLabel = '',
    bathTax = 0,
    total,
    totalNote = ''
  }: {
    lodging: number; // 宿泊料金（割引前・税込）
    guests: number;
    nights: number;
    discount?: number; // 予約時決済割引（円・正の数）
    discountLabel?: string; // 例: 2%引き
    bathTax?: number;
    total: number; // お支払い合計（割引後の宿泊料金＋入湯税）
    totalNote?: string; // 例: お支払い済み
  } = $props();

  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const basis = $derived(`大人${guests}名 × ${nights}泊`);
</script>

<table class="w-full text-sm">
  <caption class="mb-1.5 text-left text-xs font-medium text-stone-500">料金の明細</caption>
  <tbody class="divide-y divide-stone-200 border-y border-stone-200">
    <tr>
      <th scope="row" class="py-2 pr-3 text-left font-normal">宿泊料金<span class="ml-1 text-xs text-stone-500">（{basis}・税込）</span></th>
      <td class="py-2 text-right tabular-nums">{yen(lodging)}</td>
    </tr>
    {#if discount > 0}
      <tr class="text-accent-600">
        <th scope="row" class="py-2 pr-3 text-left font-normal">予約時決済割引{#if discountLabel}<span class="ml-1 text-xs">（{discountLabel}）</span>{/if}</th>
        <td class="py-2 text-right tabular-nums">−{yen(discount)}</td>
      </tr>
    {/if}
    {#if bathTax > 0}
      <tr>
        <th scope="row" class="py-2 pr-3 text-left font-normal">入湯税<span class="ml-1 text-xs text-stone-500">（{basis}）</span></th>
        <td class="py-2 text-right tabular-nums">{yen(bathTax)}</td>
      </tr>
    {/if}
  </tbody>
  <tfoot>
    <tr>
      <th scope="row" class="pt-2.5 pr-3 text-left font-bold">合計{#if totalNote}<span class="ml-1 text-xs font-normal text-stone-500">（{totalNote}）</span>{/if}</th>
      <td class="pt-2.5 text-right text-base font-bold tabular-nums">{yen(total)}</td>
    </tr>
  </tfoot>
</table>
