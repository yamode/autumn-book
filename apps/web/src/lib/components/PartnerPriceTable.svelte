<script lang="ts">
  import type { PartnerNightLine } from '$lib/partner-booking';
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
    totalNote = '',
    nightLines = []
  }: {
    lodging: number; // 宿泊料金（割引前・税込）
    guests: number;
    nights: number;
    discount?: number; // 予約時決済割引（円・正の数）
    discountLabel?: string; // 例: 2%引き
    bathTax?: number;
    total: number; // お支払い合計（割引後の宿泊料金＋入湯税）
    totalNote?: string; // 例: お支払い済み
    nightLines?: PartnerNightLine[]; // 泊ごとの内訳（partnerNightLines）。あれば宿泊料金を1泊1行で出す
  } = $props();

  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const basis = $derived(`大人${guests}名 × ${nights}泊`);
  // 宿泊料金は1室1泊を1行（2026-10-10 指示・2室2泊なら4行）。内訳の合計が宿泊料金と合うときだけ使い、合わない・無いときは1行にまとめる
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const dayLabel = (iso: string) => {
    const t = new Date(`${iso}T00:00:00Z`);
    return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEK[t.getUTCDay()]}）`;
  };
  const perNight = $derived(nightLines.length > 0 && nightLines.reduce((s, l) => s + l.amount, 0) === lodging ? nightLines : null);
  const multiRoom = $derived(new Set(nightLines.map((l) => l.room)).size > 1);
  const nightBasis = (l: PartnerNightLine) =>
    l.parts.length === 1 && l.parts[0].adults === 1
      ? '大人1名・税込'
      : `${l.parts.length === 1 ? '1名あたり ' : ''}${l.parts.map((p) => `${yen(p.unit)} × ${p.adults}名`).join(' ＋ ')}・税込`;
  // 1行にまとめるときも「1名あたり × 人数」で見せる（予約入力の右欄と同じ形）。
  // 宿泊料金は連泊なら全泊分の1名料金（日によって料金が違っても × 人数がそのまま合計になる）。
  // 割り切れないとき（部屋ごとに1名料金が違う複数室など）と大人1名のときは、従来の「大人N名 × N泊」に戻す
  const lodgingBasis = $derived(
    guests > 1 && lodging % guests === 0
      ? `1名あたり${nights > 1 ? `（${nights}泊分）` : ''} ${yen(lodging / guests)} × ${guests}名・税込`
      : `${basis}・税込`
  );
  const bathBasis = $derived(
    guests > 1 && bathTax % (guests * nights) === 0
      ? `1名あたり ${yen(bathTax / (guests * nights))} × ${guests}名${nights > 1 ? ` × ${nights}泊` : ''}`
      : basis
  );
</script>

<table class="w-full text-sm">
  <caption class="mb-1.5 text-left text-xs font-medium text-stone-500">料金の明細</caption>
  <tbody class="divide-y divide-stone-200 border-y border-stone-200">
    {#if perNight}
      {#each perNight as l (`${l.room}-${l.date}`)}
        <tr>
          <th scope="row" class="py-2 pr-3 text-left font-normal">宿泊料金 {multiRoom ? `${l.room + 1}室目 ` : ''}<span class="tabular-nums">{dayLabel(l.date)}</span><span class="ml-1 text-xs text-stone-500">（{nightBasis(l)}）</span></th>
          <td class="py-2 text-right tabular-nums">{yen(l.amount)}</td>
        </tr>
      {/each}
    {:else}
      <tr>
        <th scope="row" class="py-2 pr-3 text-left font-normal">宿泊料金<span class="ml-1 text-xs text-stone-500">（{lodgingBasis}）</span></th>
        <td class="py-2 text-right tabular-nums">{yen(lodging)}</td>
      </tr>
    {/if}
    {#if discount > 0}
      <tr class="text-accent-600">
        <th scope="row" class="py-2 pr-3 text-left font-normal">予約時決済割引{#if discountLabel}<span class="ml-1 text-xs">（{discountLabel}）</span>{/if}</th>
        <td class="py-2 text-right tabular-nums">−{yen(discount)}</td>
      </tr>
    {/if}
    {#if bathTax > 0}
      <tr>
        <th scope="row" class="py-2 pr-3 text-left font-normal">入湯税<span class="ml-1 text-xs text-stone-500">（{bathBasis}）</span></th>
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
