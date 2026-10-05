<script lang="ts">
  // 取引先専用ページ: プラン紹介の下に出す、そのプランだけの料金カレンダー（2か月を横並び・2026-10-03）。
  // データは料金カレンダーと同じ月の JSON（/p/<token>/calendar/month）。同じ月・人数はページ内で1回だけ取る。
  // 画面に入ってから読み込む（プランが多くても最初の表示を重くしない）。
  // 日付を押すと、その日に泊まれる部屋と料金を出し、予約へ進める。
  import { onMount } from 'svelte';
  import { isHoliday } from '$lib/holidays';
  import { canBookFor } from '$lib/partner-booking';
  import { roomParts } from '$lib/partner-contents';
  import type { PartnerRateDay } from '$lib/partner-pricing';
  import { fetchPortalMonth, type PortalMonthJson } from '$lib/partner-month-client';

  let {
    token,
    planCode,
    planName,
    showInventory,
    booking
  }: {
    token: string;
    planCode: string;
    planName: string;
    showInventory: boolean;
    booking: { enabled: boolean; leadDays: number; cutoffHour: number };
  } = $props();

  const pad = (n: number) => String(n).padStart(2, '0');
  const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const GUEST_MIN = 1;
  const GUEST_MAX = 6;

  const now = new Date(Date.now() + 9 * 3600 * 1000); // JST
  let start = $state({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  let guests = $state(2);
  // マス目の金額: 1名あたり（取引先の料金表と同じ）か、1室の合計（人数ぶん）か。選んだ方は次に開いたときも使う。
  const UNIT_KEY = 'pt-plan-cal-unit';
  let unit = $state<'person' | 'room'>('person');
  onMount(() => {
    try {
      if (localStorage.getItem(UNIT_KEY) === 'room') unit = 'room';
    } catch {
      /* 保存できない環境では毎回 1名あたり */
    }
  });
  function setUnit(u: 'person' | 'room') {
    unit = u;
    try {
      localStorage.setItem(UNIT_KEY, u);
    } catch {
      /* noop */
    }
  }
  const shown = (perPerson: number) => (unit === 'room' ? perPerson * guests : perPerson);
  let months = $state<PortalMonthJson[]>([]);
  let loading = $state(false);
  let loadError = $state('');
  let visible = $state(false);
  let selected = $state<string | null>(null);
  let root = $state<HTMLElement>();

  const addMonth = (y: number, m: number, d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1 };
  };
  const ym = (x: { year: number; month: number }) => `${x.year}-${pad(x.month)}`;

  onMount(() => {
    if (!root) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          visible = true;
          io.disconnect();
        }
      },
      { rootMargin: '300px' }
    );
    io.observe(root);
    return () => io.disconnect();
  });

  $effect(() => {
    if (!visible) return;
    const a = start;
    const b = addMonth(a.year, a.month, 1);
    const g = guests;
    let cancelled = false;
    loading = true;
    loadError = '';
    Promise.all([fetchPortalMonth(token, ym(a), g), fetchPortalMonth(token, ym(b), g)])
      .then((ms) => {
        if (cancelled) return;
        months = ms;
        // 先の2か月も先読みしておく（矢印を押したときにすぐ出す）
        const c = addMonth(a.year, a.month, 2);
        fetchPortalMonth(token, ym(c), g).catch(() => {});
      })
      .catch(() => {
        if (!cancelled) loadError = '料金を読み込めませんでした。時間をおいてお試しください。';
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  const bounds = $derived(months[0]?.bounds ?? null);
  const canPrev = $derived(!!bounds && ym(start) > bounds.earliest.slice(0, 7));
  const canNext = $derived(!!bounds && ym(addMonth(start.year, start.month, 1)) < bounds.latest.slice(0, 7));
  function shift(d: number) {
    start = addMonth(start.year, start.month, d);
    selected = null;
  }

  // その日にこのプランで泊まれる部屋（料金のあるもの。残室を見せる取引先は満室を除く）
  type Offer = { roomCode: string; roomName: string; perPerson: number; remaining: number | null };
  function offersOf(day: PartnerRateDay | undefined, g: number): Offer[] {
    if (!day || day.closed) return [];
    const out: Offer[] = [];
    for (const room of day.rooms) {
      if (showInventory && room.remainingRooms === 0) continue;
      const plan = room.plans.find((p) => p.planCode === planCode && p.planName === planName);
      const price = plan?.pricesPerPerson[String(g)];
      if (price != null && price > 0) out.push({ roomCode: room.roomCode, roomName: room.roomName, perPerson: price, remaining: room.remainingRooms });
    }
    return out.sort((x, y) => x.perPerson - y.perPerson);
  }

  type Cell = { iso: string; d: number; dow: number; holiday: boolean; inRange: boolean; min: number | null };
  function cellsOf(m: PortalMonthJson): (Cell | null)[] {
    const { year, month } = m.month;
    const byDate = new Map(m.days.map((d) => [d.date, d]));
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const out: (Cell | null)[] = Array(first).fill(null);
    for (let d = 1; d <= last; d += 1) {
      const iso = `${year}-${pad(month)}-${pad(d)}`;
      const offers = offersOf(byDate.get(iso), m.guests);
      out.push({
        iso,
        d,
        dow: (first + d - 1) % 7,
        holiday: isHoliday(iso),
        inRange: iso >= m.bounds.earliest && iso <= m.bounds.latest,
        min: offers.length ? offers[0].perPerson : null
      });
    }
    while (out.length % 7) out.push(null);
    return out;
  }

  const selectedOffers = $derived.by(() => {
    if (!selected) return [];
    const m = months.find((x) => selected!.startsWith(ym(x.month)));
    return offersOf(m?.days.find((d) => d.date === selected), guests);
  });
  const fmtDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}${isHoliday(iso) ? '・祝' : ''}）`;
  };
  const dayColor = (c: Cell) => (c.dow === 0 || c.holiday ? 'text-rose-600' : c.dow === 6 ? 'text-sky-600' : 'text-stone-700');
  const bookHref = (o: Offer, date: string) =>
    `/p/${token}/book?${new URLSearchParams({ room: o.roomCode, plan: planCode, name: planName, date, guests: String(guests) })}`;
</script>

<section bind:this={root} class="rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h4 class="text-lg font-bold">このプランの料金・空室</h4>
    <div class="flex items-center gap-2 rounded-lg border border-stone-200 px-2 py-1">
      <button type="button" class="flex h-9 w-9 items-center justify-center rounded bg-stone-100 text-xl leading-none disabled:opacity-40" disabled={guests <= GUEST_MIN} onclick={() => { guests -= 1; selected = null; }} aria-label="人数を減らす">−</button>
      <span class="min-w-[5.5rem] text-center text-base">大人{guests}名 1室</span>
      <button type="button" class="flex h-9 w-9 items-center justify-center rounded bg-[var(--pt-accent)] text-xl leading-none text-white disabled:opacity-40" disabled={guests >= GUEST_MAX} onclick={() => { guests += 1; selected = null; }} aria-label="人数を増やす">＋</button>
    </div>
  </div>
  <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
    <div class="inline-flex overflow-hidden rounded-md border border-stone-300 text-sm" role="group" aria-label="金額の表示">
      <button type="button" class={`px-3 py-1.5 ${unit === 'person' ? 'bg-[var(--pt-accent)] text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`} aria-pressed={unit === 'person'} onclick={() => setUnit('person')}>1名あたり</button>
      <button type="button" class={`border-l border-stone-300 px-3 py-1.5 ${unit === 'room' ? 'bg-[var(--pt-accent)] text-white' : 'bg-white text-stone-600 hover:bg-stone-50'}`} aria-pressed={unit === 'room'} onclick={() => setUnit('room')}>1室合計</button>
    </div>
    <p class="text-sm text-stone-500">1泊の{unit === 'room' ? `1室（大人${guests}名）合計` : '1名あたり'}の最安料金（税込・入湯税別）。日付を押すと部屋ごとの料金が見られます。</p>
  </div>

  <div class={`relative mt-4 transition-opacity ${loading ? 'opacity-50' : ''}`}>
    <button type="button" class="absolute left-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 disabled:opacity-30" disabled={!canPrev || loading} onclick={() => shift(-1)} aria-label="前の月">
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 6l-6 6 6 6" /></svg>
    </button>
    <button type="button" class="absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 disabled:opacity-30" disabled={!canNext || loading} onclick={() => shift(1)} aria-label="次の月">
      <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6" /></svg>
    </button>

    {#if loadError}
      <p class="py-10 text-center text-base text-rose-700">{loadError}</p>
    {:else if !months.length}
      <p class="py-16 text-center text-base text-stone-400">料金を読み込んでいます…</p>
    {:else}
      <div class="grid gap-6 md:grid-cols-2">
        {#each months as m, mi (ym(m.month))}
          <div class={mi === 1 ? 'hidden md:block' : ''}>
            <p class="mb-2 text-center text-lg font-bold leading-8">{m.month.year}年 {m.month.month}月</p>
            <div class="grid grid-cols-7 text-center text-sm">
              {#each WEEK as w, i}
                <div class={`py-1.5 font-medium ${i === 0 ? 'text-rose-600' : i === 6 ? 'text-sky-600' : 'text-stone-500'}`}>{w}</div>
              {/each}
            </div>
            <div class="grid grid-cols-7 border-t border-stone-200 text-center">
              {#each cellsOf(m) as c, i (c?.iso ?? `b-${i}`)}
                {#if !c}
                  <div class="min-h-[4.5rem] border-b border-stone-100"></div>
                {:else if c.min != null && c.inRange}
                  <button
                    type="button"
                    class={`min-h-[4.5rem] border-b border-stone-100 px-0.5 py-2 transition hover:bg-[var(--pt-accent-soft)] ${selected === c.iso ? 'bg-[var(--pt-accent-soft)] ring-1 ring-inset ring-[var(--pt-accent)]' : ''}`}
                    onclick={() => (selected = selected === c.iso ? null : c.iso)}
                    aria-pressed={selected === c.iso}
                  >
                    <span class={`block text-base ${dayColor(c)}`}>{c.d}</span>
                    <span class="mt-0.5 block text-xs font-semibold leading-tight tracking-tight text-[var(--pt-accent)] sm:text-sm">{shown(c.min).toLocaleString('ja-JP')}<span class="text-[11px] sm:text-xs">円</span></span>
                  </button>
                {:else}
                  <div class="min-h-[4.5rem] border-b border-stone-100 px-0.5 py-2 text-stone-300">
                    <span class="block text-base">{c.d}</span>
                    <span class="mt-0.5 block text-xs leading-tight">{#if c.inRange}<span class="sm:hidden">×</span><span class="hidden sm:inline">空室なし</span>{:else}-{/if}</span>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  {#if selected}
    <div class="mt-4 rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] p-3 sm:p-4">
      <p class="text-lg font-bold">{fmtDate(selected)} から1泊・大人{guests}名</p>
      {#if !selectedOffers.length}
        <p class="mt-1 text-base text-stone-500">この日は空室がありません。</p>
      {:else}
        <ul class="mt-2 divide-y divide-stone-200 rounded-md bg-white">
          {#each selectedOffers as o (o.roomCode)}
            {@const rp = roomParts(o.roomName)}
            <li class="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div class="min-w-0">
                {#if rp.building}<p class="text-sm text-stone-500">{rp.building}</p>{/if}
                <p class="text-lg font-medium">{rp.room}</p>
                {#if showInventory && o.remaining != null && o.remaining <= 2}<p class="text-sm text-rose-700">残り{o.remaining}室</p>{/if}
              </div>
              <div class="flex items-center gap-3">
                <div class="text-right">
                  <p class="text-lg font-bold">{yen(o.perPerson * guests)}</p>
                  <p class="text-sm text-stone-500">1名 {yen(o.perPerson)}</p>
                </div>
                {#if booking.enabled && canBookFor(selected, booking)}
                  <a href={bookHref(o, selected)} class="rounded-lg bg-accent-600 px-5 py-2.5 text-base font-medium text-white hover:bg-accent-500">予約へ進む</a>
                {:else if booking.enabled}
                  <span class="text-sm text-stone-500">受付締切</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>
