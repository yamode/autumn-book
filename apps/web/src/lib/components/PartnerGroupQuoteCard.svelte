<script lang="ts" module>
  import type { CreditMonth } from '$lib/partner-credit';
  /** POST /p/[token]/book/quote の quote のうち、団体の入力で使う部分（BookingQuote と同じ形） */
  export type GroupQuoteView =
    | {
        ok: true;
        nights: number;
        rooms: { adults: number; nights: { date: string; unit_price: number }[]; subtotal: number }[];
        total: number;
        bathTax: number;
        remaining: number | null;
        credit: { over: boolean; months: CreditMonth[] } | null;
      }
    | { ok: false; message: string };
</script>

<script lang="ts">
  // 団体予約の入力（/p/[token]/group/new）の「自動計算額」カード（docs/partner-group-booking.md §7.1・§8.1）。
  // 料金は取引先料金で自動計算（個人予約と同じ見積）。明細は1泊1行・「1名あたり ○円 × 人数」（PartnerPriceTable）。
  // 計算できないときも照会は送れる（「料金は宿からの回答でご案内します」）。定員超えだけは送れない。
  import PartnerPriceTable from '$lib/components/PartnerPriceTable.svelte';
  import { partnerNightLines } from '$lib/partner-booking';
  import { CREDIT_UNIT_NOTE, creditMonthText } from '$lib/partner-credit';
  import { GROUP_QUOTE_STATUS_TEXT, groupQuoteStatusOf } from '$lib/partner-group';

  let {
    quote,
    quoting = false,
    pending = '',
    roomCount,
    showInventory = false,
    deadlineOk = true,
    deadlineText = ''
  }: {
    quote: GroupQuoteView | null;
    quoting?: boolean;
    /** まだ計算できない理由（部屋タイプ・日付が未入力など）。空なら quote を出す */
    pending?: string;
    roomCount: number;
    showInventory?: boolean;
    /** チェックイン日が照会の締切内か（canInquireFor） */
    deadlineOk?: boolean;
    deadlineText?: string;
  } = $props();

  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const adultsOf = (q: Extract<GroupQuoteView, { ok: true }>) => q.rooms.reduce((s, r) => s + r.adults, 0);
  const failStatus = $derived(quote && !quote.ok ? groupQuoteStatusOf(quote.message) : null);
  const short = $derived(quote?.ok && quote.remaining != null && quote.remaining < roomCount);
</script>

<section class="rounded-xl border border-stone-200 bg-white p-4 sm:p-5" aria-live="polite" aria-busy={quoting}>
  <div class="flex items-baseline justify-between gap-3">
    <h3 class="font-bold">自動計算額</h3>
    {#if quoting}<span class="text-xs text-stone-500">計算しています…</span>{/if}
  </div>
  {#if !deadlineOk}
    <p class="mt-2 rounded-lg bg-rose-700/5 px-3 py-2 text-sm text-rose-700">この日程の照会は締め切りました（{deadlineText}）。</p>
  {/if}
  {#if pending}
    <p class="mt-2 text-sm text-stone-500">{pending}</p>
  {:else if !quote}
    <div class="mt-3 space-y-2" aria-hidden="true"><div class="shimmer h-4 w-2/3"></div><div class="shimmer h-4 w-1/2 opacity-70"></div></div>
  {:else if !quote.ok}
    <p class={`mt-2 rounded-lg px-3 py-2 text-sm ${failStatus === 'capacity' ? 'bg-rose-700/5 text-rose-700' : 'bg-stone-50 text-stone-700'}`}>
      {failStatus && GROUP_QUOTE_STATUS_TEXT[failStatus] ? GROUP_QUOTE_STATUS_TEXT[failStatus] : quote.message}
      {#if failStatus === 'capacity'}<span class="block text-xs">部屋ごとの人数を直してください（このままでは送れません）。</span>
      {:else}<span class="block text-xs text-stone-500">このまま照会を送れます（{quote.message}）。</span>{/if}
    </p>
  {:else}
    {@const adults = adultsOf(quote)}
    <p class="mt-1 text-2xl font-bold tabular-nums text-accent-600">{yen(quote.total + quote.bathTax)}</p>
    <p class="text-xs text-stone-500">宿泊料金 {yen(quote.total)}{quote.bathTax > 0 ? `・入湯税 ${yen(quote.bathTax)}` : ''}（税込・大人{adults}名・{roomCount}室・{quote.nights}泊）</p>
    <div class="mt-3">
      <PartnerPriceTable lodging={quote.total} guests={adults} nights={quote.nights} bathTax={quote.bathTax} total={quote.total + quote.bathTax} nightLines={partnerNightLines(quote.rooms)} />
    </div>
    {#if showInventory && quote.remaining != null}
      <p class={`mt-3 text-sm ${short ? 'font-medium text-amber-800' : 'text-stone-600'}`}>
        空室の目安: 残り {quote.remaining} 室{#if short}（ご希望の {roomCount} 室に足りません。照会は送れます・宿からご連絡します）{/if}
      </p>
    {/if}
    {#if quote.credit}
      {@const c = quote.credit}
      <div class={`mt-3 rounded-lg border px-3 py-2.5 text-sm ${c.over ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-stone-50'}`}>
        <p class="font-bold">御社の受付枠</p>
        <ul class="mt-1 space-y-1">
          {#each c.months as m (m.month)}
            {@const t = creditMonthText(m)}
            <li>{t.head}{#if t.after}<span class={`block text-[13px] ${m.over ? 'font-medium text-amber-800' : 'text-stone-600'}`}>／{t.after}</span>{/if}</li>
          {/each}
        </ul>
        <p class="mt-1.5 text-xs text-stone-500">{CREDIT_UNIT_NOTE}</p>
        {#if c.over}<p class="mt-1.5 text-[13px] font-medium text-amber-800">受付枠を超えますが、このまま照会を送れます（宿が確認してご回答します）。</p>{/if}
      </div>
    {/if}
    <p class="mt-3 text-xs text-stone-500">料金は照会の時点の御社向け料金です。確定の料金は宿からの回答でご案内します。</p>
  {/if}
</section>
