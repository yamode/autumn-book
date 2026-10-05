<script lang="ts">
  // 取引先専用ページ「お部屋とプラン」の検索バーから開く日付パネル（2か月横並び・スマホは1か月）。
  // 泊数を変えると、どこかの部屋・プランで全泊空いている日だけに料金（1名1泊の最安）を出す。
  // 日付を押しても閉じず、「この日程で検索」で確定する。
  import { isHoliday } from '$lib/holidays';
  import { partnerStayOffers } from '$lib/partner-stay';
  import { fetchPortalMonth, type PortalMonthJson } from '$lib/partner-month-client';

  let {
    token,
    date = $bindable(''),
    nights = $bindable(1),
    guests,
    maxNights,
    showInventory,
    today,
    onApply,
    onClose
  }: {
    token: string;
    date: string;
    nights: number;
    guests: number;
    maxNights: number;
    showInventory: boolean;
    today: string;
    onApply: () => void;
    onClose: () => void;
  } = $props();

  const pad = (n: number) => String(n).padStart(2, '0');
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const shiftYm = (ym: string, d: number) => {
    const [y, m] = ym.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
  };
  // svelte-ignore state_referenced_locally
  let leftYm = $state((date || today).slice(0, 7));
  let months = $state<PortalMonthJson[]>([]);
  let loading = $state(false);
  let failed = $state(false);

  // 表示する2か月＋連泊の判定用に次の月
  $effect(() => {
    const yms = [leftYm, shiftYm(leftYm, 1), shiftYm(leftYm, 2)];
    const g = guests;
    let cancelled = false;
    loading = true;
    failed = false;
    Promise.all(yms.map((ym) => fetchPortalMonth(token, ym, g).catch(() => null)))
      .then((ms) => {
        if (cancelled) return;
        months = ms.filter((m): m is PortalMonthJson => !!m);
        failed = !ms[0];
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });
  const bounds = $derived(months[0]?.bounds ?? null);
  const index = $derived(new Map(months.flatMap((m) => m.days.map((d) => [d.date, d] as const))));
  const shown = $derived([leftYm, shiftYm(leftYm, 1)]);
  const latestYm = $derived(bounds ? bounds.latest.slice(0, 7) : shiftYm(today.slice(0, 7), 12));

  function cellsOf(ym: string) {
    const [year, month] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const out: ({ iso: string; dow: number; min: number | null; closed: boolean; inRange: boolean } | null)[] = Array(first).fill(null);
    for (let d = 1; d <= last; d += 1) {
      const iso = `${ym}-${pad(d)}`;
      const inRange = !!bounds && iso >= bounds.earliest && iso <= bounds.latest;
      const offers = inRange ? partnerStayOffers((x) => index.get(x), iso, nights, guests, { showInventory }) : null;
      out.push({ iso, dow: (first + d - 1) % 7, min: offers?.length ? offers[0].perPerson : null, closed: index.get(iso)?.closed === true, inRange });
    }
    return out;
  }
  const checkout = $derived.by(() => {
    if (!date) return '';
    const t = new Date(`${date}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + nights);
    return t.toISOString().slice(0, 10);
  });
  const md = (iso: string) => {
    const t = new Date(`${iso}T00:00:00Z`);
    return `${t.getUTCMonth() + 1}/${t.getUTCDate()}（${WEEK[t.getUTCDay()]}）`;
  };
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && !document.querySelector('[data-room-info]')) onClose(); }} />

<div role="dialog" aria-label="ご宿泊日" class="rounded-b-xl border border-t-0 border-stone-300 bg-white px-4 pb-4 pt-3 shadow-lg sm:px-5">
  <div class="flex flex-wrap items-center gap-3 border-b border-stone-100 pb-3">
    <span class="text-base text-stone-600">泊数</span>
    <button type="button" disabled={nights <= 1} onclick={() => (nights -= 1)} class="flex h-9 w-9 items-center justify-center rounded bg-stone-100 text-xl text-brand-800 disabled:opacity-30" aria-label="泊数を減らす">−</button>
    <span class="min-w-10 text-center text-base font-medium tabular-nums">{nights}泊</span>
    <button type="button" disabled={nights >= maxNights} onclick={() => (nights += 1)} class="flex h-9 w-9 items-center justify-center rounded bg-[var(--pt-accent)] text-xl text-white disabled:opacity-30" aria-label="泊数を増やす">＋</button>
    {#if loading}<span class="text-sm text-stone-500" role="status">空き状況を確認中…</span>{:else if failed}<span class="text-sm text-rose-700" role="status">料金を読み込めませんでした</span>{:else}<span class="text-sm text-stone-400">泊数を変えると空き日がすぐ変わります</span>{/if}
    <span class="ml-auto text-sm text-stone-500">{guests}名1室・1名1泊の最安</span>
    <button type="button" onclick={onClose} class="flex h-9 w-9 items-center justify-center rounded-full text-xl text-stone-500 hover:bg-stone-100" aria-label="閉じる">×</button>
  </div>
  <div class="relative mt-3 grid gap-6 md:grid-cols-2">
    <button type="button" disabled={leftYm <= today.slice(0, 7)} onclick={() => (leftYm = shiftYm(leftYm, -1))} class="absolute left-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 disabled:opacity-30" aria-label="前の月">‹</button>
    <button type="button" disabled={shiftYm(leftYm, 1) >= latestYm} onclick={() => (leftYm = shiftYm(leftYm, 1))} class="absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 disabled:opacity-30" aria-label="次の月">›</button>
    {#each shown as ym, mi (ym)}
      {@const [y, m] = ym.split('-').map(Number)}
      <section class={mi === 1 ? 'hidden md:block' : ''} aria-label={`${y}年${m}月`}>
        <h3 class="mb-2 text-center text-lg font-bold leading-8">{y}年 {m}月</h3>
        <div class="grid grid-cols-7 text-center text-sm">
          {#each WEEK as w, i}<div class={`py-1.5 font-medium ${i === 0 ? 'text-rose-600' : i === 6 ? 'text-sky-600' : 'text-stone-500'}`}>{w}</div>{/each}
        </div>
        <div class="grid grid-cols-7 border-t border-stone-200 text-center">
          {#each cellsOf(ym) as c, i (c?.iso ?? `b-${i}`)}
            {#if !c}
              <div class="min-h-16 border-b border-stone-100"></div>
            {:else}
              {@const selected = c.iso === date}
              {@const inStay = !!date && c.iso > date && c.iso < checkout}
              <button
                type="button"
                disabled={c.min == null}
                aria-pressed={selected}
                onclick={() => (date = c.iso)}
                class={`min-h-16 border-b border-stone-100 px-0.5 py-1.5 transition ${selected ? 'rounded bg-[var(--pt-accent)] text-white' : inStay ? 'bg-[var(--pt-accent-soft)]' : c.min != null ? 'hover:bg-[var(--pt-accent-soft)]' : 'text-stone-300'}`}
              >
                <span class={`block text-base ${selected ? '' : c.min == null ? '' : c.dow === 0 || isHoliday(c.iso) ? 'text-rose-600' : c.dow === 6 ? 'text-sky-600' : 'text-stone-800'}`}>{Number(c.iso.slice(8))}</span>
                {#if c.min != null}
                  <span class={`block text-xs font-semibold tracking-tight sm:text-sm ${selected ? 'text-white' : 'text-[var(--pt-accent)]'}`}>{c.min.toLocaleString('ja-JP')}<span class="text-[11px]">円</span></span>
                {:else if c.inRange && c.closed}
                  <span class="block text-xs">休館日</span>
                {:else if c.inRange && c.iso >= today}
                  <span class="block text-xs">—</span>
                {/if}
              </button>
            {/if}
          {/each}
        </div>
      </section>
    {/each}
  </div>
  <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
    <p class="text-base text-stone-700">
      {#if date}{md(date)} 〜 {md(checkout)}・{nights}泊{:else}ご宿泊日をお選びください{/if}
      <span class="ml-2 text-sm text-stone-400">— は満室・料金なし</span>
    </p>
    <button type="button" disabled={!date} onclick={onApply} class="rounded-lg bg-accent-600 px-5 py-2.5 text-base font-semibold text-white hover:bg-accent-500 disabled:opacity-40">この日程で検索</button>
  </div>
</div>
