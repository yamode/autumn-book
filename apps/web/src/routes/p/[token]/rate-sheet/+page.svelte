<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  // 取引先専用ページ: 料金表のダウンロード（CSV / PDF。2026-10-09・docs/partner-rank-rates.md §5.3）。
  // 出力は GET（/rate-sheet/csv・/rate-sheet/pdf）。PDF を作れない環境では印刷用のページ（新しいタブ）に切り替わる。
  import { page } from '$app/stores';
  import { untrack } from 'svelte';
  import { shiftYm } from '$lib/partner-rate-sheet';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const token = $derived($page.params.token);
  const ymLabel = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
  const jpDate = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;

  let from = $state(untrack(() => data.months[0] ?? ''));
  let months = $state(3);
  let format = $state<'pdf' | 'csv'>('pdf');
  let guests = $state<number[]>(untrack(() => (data.guestOptions.includes(2) ? [2] : data.guestOptions.slice(0, 1))));

  // 選んだ期間のうち公開範囲外の月（出力には載らない）
  const outside = $derived.by(() => {
    if (!from) return [] as string[];
    const lastYm = data.bounds.latest.slice(0, 7);
    return Array.from({ length: months }, (_, i) => shiftYm(from, i)).filter((ym) => ym > lastYm);
  });
  const lastIncluded = $derived(outside.length ? shiftYm(outside[0], -1) : shiftYm(from, months - 1));
  function toggleGuest(g: number) {
    guests = guests.includes(g) ? guests.filter((x) => x !== g) : [...guests, g].sort((a, b) => a - b);
  }
  const action = $derived(`/p/${token}/rate-sheet/${format}`);
  const canSubmit = $derived(!!from && (format === 'csv' || guests.length > 0));
  const input = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
  const chip = (on: boolean) =>
    `inline-flex min-w-[3.25rem] cursor-pointer items-center justify-center rounded-full border px-3 py-1.5 text-sm transition ${on ? 'border-[var(--pt-accent)] bg-[var(--pt-accent-soft)] font-medium text-[var(--pt-accent)]' : 'border-stone-300 bg-white text-stone-600 hover:bg-stone-50'}`;
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, '料金表')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-3xl px-4 pb-10 pt-6 sm:px-6">
  <h2 class="text-2xl font-bold">料金表</h2>
  {#if data.portal.noFacilityMessage}
    <!-- オンの施設が無い取引先（N9）は施設名の説明を出さず、案内だけ（ヘッダーの下にも同じ案内） -->
    <p class="mt-1 text-sm text-stone-500">現在ご案内できる料金表はありません。</p>
  {:else}
    <p class="mt-1 text-sm text-stone-500">{data.portal.facilityName}の貴社専用料金を、CSV または PDF（月カレンダー＋料金区分ごとの料金表）でお渡しします。</p>
  {/if}

  {#if data.portal.noFacilityMessage}
    <!-- 入力欄は出さない -->
  {:else if !data.months.length}
    <p class="mt-5 rounded-xl border border-stone-200 bg-white px-4 py-3 text-stone-600">現在ご案内できる期間がありません。</p>
  {:else}
    <form method="GET" {action} target={format === 'pdf' ? '_blank' : undefined} class="mt-5 grid gap-5 rounded-xl border border-stone-200 bg-white p-4 sm:p-6">
      <div class="grid gap-4 sm:grid-cols-2">
        <label class="block min-w-0">
          <span class="mb-1 block text-sm font-medium">開始月</span>
          <select name="from" bind:value={from} class={input}>
            {#each data.months as ym (ym)}<option value={ym}>{ymLabel(ym)}</option>{/each}
          </select>
        </label>
        <label class="block min-w-0">
          <span class="mb-1 block text-sm font-medium">月数</span>
          <select name="months" bind:value={months} class={input}>
            {#each Array.from({ length: 12 }, (_, i) => i + 1) as n (n)}<option value={n}>{n}か月</option>{/each}
          </select>
        </label>
      </div>
      <p class="-mt-2 text-xs leading-5 text-stone-500">
        公開期間は {jpDate(data.bounds.earliest)}〜{jpDate(data.bounds.latest)} です。
        {#if outside.length}
          <span class="text-amber-700">{ymLabel(outside[0])}以降は公開範囲外のため載りません（{ymLabel(from)}〜{ymLabel(lastIncluded)}を出力します）。</span>
        {/if}
      </p>

      <fieldset class="min-w-0">
        <legend class="mb-1 text-sm font-medium">形式</legend>
        <div class="flex flex-wrap gap-2">
          <label class={chip(format === 'pdf')}><input type="radio" class="sr-only" bind:group={format} value="pdf" />PDF</label>
          <label class={chip(format === 'csv')}><input type="radio" class="sr-only" bind:group={format} value="csv" />CSV</label>
        </div>
        <p class="mt-1.5 text-xs leading-5 text-stone-500">
          {#if format === 'pdf'}
            A4 横。各日を料金区分の色で塗った月カレンダーと、区分ごとの料金表（選んだ人数ごと）です。作成に数十秒かかることがあります。
          {:else}
            1行 = 日付 × 部屋タイプ × プラン × 人数（すべての人数）。Excel でそのまま開けます。
          {/if}
        </p>
      </fieldset>

      {#if format === 'pdf'}
        <fieldset class="min-w-0">
          <legend class="mb-1 text-sm font-medium">料金表の人数（1室あたり・複数選べます）</legend>
          <div class="flex flex-wrap gap-2">
            {#each data.guestOptions as g (g)}
              <label class={chip(guests.includes(g))}>
                <input type="checkbox" class="sr-only" checked={guests.includes(g)} onchange={() => toggleGuest(g)} />{g}名
              </label>
            {/each}
          </div>
          <input type="hidden" name="guests" value={guests.join(',')} />
          {#if !guests.length}<p class="mt-1.5 text-xs text-rose-700">人数を1つ以上選んでください。</p>{/if}
        </fieldset>
      {/if}

      <p class="text-xs leading-5 text-stone-500">料金は1名1泊・税込・入湯税別です。残室により予約できない日があります。発行日時点の料金です。</p>
      <div>
        <button
          type="submit"
          disabled={!canSubmit}
          class="w-full rounded-lg bg-accent-600 px-5 py-2.5 font-medium text-white transition hover:bg-accent-700 disabled:opacity-50 sm:w-auto"
        >{format === 'pdf' ? 'PDF をダウンロード' : 'CSV をダウンロード'}</button>
      </div>
    </form>
  {/if}
</main>
