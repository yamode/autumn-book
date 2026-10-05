<script lang="ts">
  // 取引先専用ページ: お部屋とプラン（一休型）。検索バー（日程・泊数・人数）→ 並び順 → 部屋タイプごとの全幅カード。
  // 料金・空室は料金カレンダーと同じ月の JSON（fetchPortalMonth）から、連泊も含めて画面側で組み立てる。
  // 予約の金額・在庫は予約入力・確定時にサーバで改めて確かめる。
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import PartnerRoomModal from '$lib/components/PartnerRoomModal.svelte';
  import PartnerStayPanel from '$lib/components/PartnerStayPanel.svelte';
  import { canBookFor, partnerPlanName } from '$lib/partner-booking';
  import { roomParts, type PartnerRoomContent } from '$lib/partner-contents';
  import { fetchPortalMonth } from '$lib/partner-month-client';
  import type { PartnerRateDay } from '$lib/partner-pricing';
  import { addDaysIsoClient, partnerStayOffers, type PartnerStayOffer } from '$lib/partner-stay';

  let { data } = $props();
  const token = $derived($page.params.token ?? '');
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));
  const fmt = (iso: string) => {
    const t = new Date(`${iso}T00:00:00Z`);
    return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日（${WEEK[t.getUTCDay()]}）`;
  };

  // ---- 検索条件（下書き → 「検索」「この日程で検索」で URL に反映） ----
  // svelte-ignore state_referenced_locally
  let date = $state(data.params.date);
  // svelte-ignore state_referenced_locally
  let nights = $state(data.params.nights);
  // svelte-ignore state_referenced_locally
  let guests = $state(data.params.guests);
  // svelte-ignore state_referenced_locally
  let panelOpen = $state(!data.params.date);
  $effect(() => {
    date = data.params.date;
    nights = data.params.nights;
    guests = data.params.guests;
  });
  let bar = $state<HTMLDivElement | null>(null);
  $effect(() => {
    if (!panelOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (bar && !bar.contains(e.target as Node) && !document.querySelector('[data-room-info]')) panelOpen = false;
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  });
  function search() {
    if (!date) {
      panelOpen = true;
      return;
    }
    panelOpen = false;
    const q = new URLSearchParams({ date, nights: String(nights), guests: String(guests) });
    void goto(`/p/${token}/stay?${q}`, { noScroll: true, keepFocus: true });
  }

  // ---- 確定した条件の料金（チェックイン日から泊数ぶんの月を読む） ----
  let index = $state<Map<string, PartnerRateDay>>(new Map());
  let loading = $state(false);
  let loadError = $state('');
  $effect(() => {
    const { date: d, nights: n, guests: g } = data.params;
    if (!d) return;
    const yms = [...new Set(Array.from({ length: n }, (_, i) => addDaysIsoClient(d, i).slice(0, 7)))];
    let cancelled = false;
    loading = true;
    loadError = '';
    Promise.all(yms.map((ym) => fetchPortalMonth(token, ym, g)))
      .then((ms) => {
        if (cancelled) return;
        index = new Map(ms.flatMap((m) => m.days.map((day) => [day.date, day] as const)));
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
  const offers = $derived(
    data.params.date && !loading ? (partnerStayOffers((x) => index.get(x), data.params.date, data.params.nights, data.params.guests, { showInventory: data.showInventory }) ?? []) : []
  );
  const closedDay = $derived(!!data.params.date && index.get(data.params.date)?.closed === true);

  // ---- 部屋タイプごとのカード ----
  let sort = $state<'asc' | 'desc'>('asc');
  let expanded = $state<Record<string, boolean>>({});
  type Card = { code: string; name: string; content: PartnerRoomContent | null; plans: PartnerStayOffer[] };
  const byPrice = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : sort === 'asc' ? a - b : b - a);
  const cards = $derived.by((): Card[] => {
    const byRoom = new Map<string, PartnerStayOffer[]>();
    for (const o of offers) byRoom.set(o.roomCode, [...(byRoom.get(o.roomCode) ?? []), o]);
    const list: Card[] = [];
    for (const r of data.rooms) {
      if (r.capacityMax && r.capacityMax < data.params.guests) continue;
      list.push({ code: r.code, name: r.name, content: r, plans: byRoom.get(r.code) ?? [] });
      byRoom.delete(r.code);
    }
    // 紹介が無い部屋も、料金があれば出す
    for (const [code, plans] of byRoom) list.push({ code, name: plans[0].roomName, content: null, plans });
    for (const c of list) c.plans.sort((a, b) => byPrice(a.perPerson, b.perPerson));
    return list.sort((a, b) => Number(b.plans.length > 0) - Number(a.plans.length > 0) || byPrice(a.plans[0]?.perPerson ?? null, b.plans[0]?.perPerson ?? null));
  });
  const bookableCount = $derived(cards.filter((c) => c.plans.length).length);

  let infoRoom = $state<PartnerRoomContent | null>(null);
  const planAnchorOf = (o: PartnerStayOffer) => data.planAnchors.find((p) => p.planCode === o.planCode && p.planLabel === o.planName)?.anchor ?? null;
  const hasPerk = (code: string) => data.commonPerk || data.perkPlanCodes.includes(code);
  const canBook = $derived(!!data.params.date && data.booking.enabled && canBookFor(data.params.date, data.booking));
  const bookHref = (o: PartnerStayOffer) => {
    const q = new URLSearchParams({
      room: o.roomCode,
      plan: o.planCode,
      name: o.planName,
      date: data.params.date,
      guests: String(data.params.guests),
      nights: String(data.params.nights),
      from: `${$page.url.pathname}${$page.url.search}`
    });
    return `/p/${token}/book?${q}`;
  };
  const calendarHref = (code: string) =>
    `/p/${token}/calendar?${new URLSearchParams({ month: (data.params.date || data.today).slice(0, 7), guests: String(data.params.guests), room: code })}`;
  const checkout = $derived(data.params.date ? addDaysIsoClient(data.params.date, data.params.nights) : '');
</script>

<svelte:head>
  <title>お部屋とプラン｜{data.portal.facilityName}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
  <h2 class="text-2xl font-bold">お部屋とプラン</h2>
  <p class="mt-1 text-sm text-stone-500">ご宿泊日・泊数・人数を選ぶと、お部屋ごとに予約できるプランと料金（税込・入湯税別）が並びます。</p>

  <!-- 検索バー -->
  <div bind:this={bar} class="relative z-30 mt-4">
    <div class={`grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl bg-brand-900 p-2.5 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_auto] sm:gap-3 sm:p-3 ${panelOpen ? 'rounded-b-none' : ''}`}>
      <button type="button" onclick={() => (panelOpen = !panelOpen)} aria-expanded={panelOpen} class={`col-span-2 flex min-h-12 items-center gap-2 rounded-lg bg-white px-4 text-left text-base text-stone-800 sm:col-span-1 ${panelOpen ? 'ring-2 ring-[var(--pt-accent)]' : ''}`}>
        <span aria-hidden="true">📅</span>
        {#if date}{fmt(date)}〜 {nights}泊{:else}<span class="text-stone-500">ご宿泊日を選ぶ</span>{/if}
      </button>
      <label class="flex min-h-12 items-center gap-2 rounded-lg bg-white px-3 text-base text-stone-800">
        <span class="sr-only">1室の人数</span>
        <span aria-hidden="true">👤</span>
        <select bind:value={guests} class="w-full bg-transparent py-2 outline-none">
          {#each [1, 2, 3, 4, 5, 6] as g}<option value={g}>大人{g}名・1室</option>{/each}
        </select>
      </label>
      <button type="button" onclick={search} class="min-h-12 rounded-lg bg-accent-600 px-6 text-base font-semibold text-white hover:bg-accent-500">検索</button>
    </div>
    {#if panelOpen}
      <div class="absolute inset-x-0 top-full">
        <PartnerStayPanel {token} bind:date bind:nights {guests} maxNights={data.booking.maxNights} showInventory={data.showInventory} today={data.today} onApply={search} onClose={() => (panelOpen = false)} />
      </div>
    {/if}
  </div>

  {#if !data.params.date}
    <p class="mt-6 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">ご宿泊日をお選びください。</p>
  {:else}
    <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
      <p class="text-base">
        <span class="font-bold">{fmt(data.params.date)} 〜 {fmt(checkout)}・{data.params.nights}泊・大人{data.params.guests}名</span>
        {#if !loading && !loadError}<span class="ml-2 text-sm text-stone-500">予約できるお部屋 {bookableCount}</span>{/if}
      </p>
      <div class="flex gap-4 text-base" role="group" aria-label="並び順">
        {#each [['asc', '安い順'], ['desc', '高い順']] as [value, label]}
          <button type="button" aria-pressed={sort === value} onclick={() => (sort = value as 'asc' | 'desc')} class={`border-b-2 pb-1 ${sort === value ? 'border-brand-900 font-semibold' : 'border-transparent text-stone-500 hover:text-brand-800'}`}>{label}</button>
        {/each}
      </div>
    </div>
    {#if data.booking.enabled && !canBook}
      <p class="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">この宿泊日のご予約は受付を締め切りました。料金はご参考です。</p>
    {/if}

    {#if loading}
      <p class="mt-6 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500" role="status">料金を読み込んでいます…</p>
    {:else if loadError}
      <p class="mt-6 rounded-xl border border-rose-700/30 bg-rose-700/5 p-4 text-rose-700">{loadError}</p>
    {:else if closedDay}
      <p class="mt-6 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">この日は休館日です。別の日程をお選びください。</p>
    {:else}
      <div class="mt-4 space-y-5">
        {#each cards as card (card.code)}
          {@const parts = roomParts(card.name)}
          {@const photo = card.content?.photos[0]?.url}
          <article class="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm md:grid md:grid-cols-[280px_minmax(0,1fr)] md:rounded-2xl">
            <div class="border-b border-stone-200 md:border-b-0 md:border-r">
              {#if photo}
                <button type="button" class="block w-full" onclick={() => (infoRoom = card.content)} aria-label={`${parts.room} お部屋の紹介`}>
                  <img src={photo} alt={parts.room} class="aspect-[16/9] w-full object-cover md:aspect-[16/11]" loading="lazy" />
                </button>
              {/if}
              <div class="p-4 sm:p-5">
                {#if parts.building}<p class="text-xs tracking-wider text-stone-500">{parts.building}</p>{/if}
                <h3 class="text-lg font-bold leading-snug">{parts.room}</h3>
                {#if card.content}
                  <p class="mt-1.5 text-sm text-stone-500">定員 {card.content.capacityMin === card.content.capacityMax ? card.content.capacityMax : `${card.content.capacityMin}〜${card.content.capacityMax}`}名</p>
                  {#if card.content.amenities.length}
                    <div class="mt-2 flex flex-wrap gap-1.5">
                      {#each card.content.amenities.slice(0, 3) as a}<span class="rounded bg-stone-100 px-2 py-1 text-xs text-stone-600">{a}</span>{/each}
                    </div>
                  {/if}
                {/if}
                <div class="mt-3 grid grid-cols-2 gap-2 md:grid-cols-1">
                  {#if card.content}
                    <button type="button" onclick={() => (infoRoom = card.content)} class="rounded-md border border-stone-300 px-3 py-2 text-left text-sm font-medium hover:border-[var(--pt-accent)] hover:text-[var(--pt-accent)]">ⓘ お部屋の紹介</button>
                  {/if}
                  <a href={calendarHref(card.code)} class="rounded-md border border-stone-300 px-3 py-2 text-left text-sm font-medium hover:border-[var(--pt-accent)] hover:text-[var(--pt-accent)]">📅 空室カレンダー</a>
                </div>
              </div>
            </div>
            <div class="min-w-0">
              {#if card.plans.length}
                <div class="divide-y divide-stone-200">
                  {#each card.plans.slice(0, expanded[card.code] ? card.plans.length : 2) as o (o.planCode + o.planName)}
                    {@const anchor = planAnchorOf(o)}
                    <div class="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:p-6">
                      <div class="min-w-0">
                        <div class="mb-2 flex flex-wrap gap-1.5 text-xs">
                          {#if o.mealType}<span class="rounded bg-stone-100 px-2 py-1 text-stone-600">{mealLabel(o.mealType)}</span>{/if}
                          {#if o.advance}<span class="rounded bg-accent-500/10 px-2 py-1 font-medium text-accent-600">先行案内</span>{/if}
                          {#if hasPerk(o.planCode)}<span class="rounded bg-[var(--pt-accent)] px-2 py-1 font-bold text-white">専用特典</span>{/if}
                        </div>
                        <h4 class="text-base font-medium leading-6">{partnerPlanName(data.planNames, o.planCode, o.planName)}</h4>
                        <p class="mt-1.5 flex flex-wrap items-center gap-x-3 text-sm">
                          {#if anchor}<a href={`/p/${token}/plans#${anchor}`} class="text-[var(--pt-accent)] underline underline-offset-2">プランの紹介</a>{/if}
                          {#if data.showInventory && o.remaining != null && o.remaining <= 2}<span class="font-semibold text-rose-700">残りあと{o.remaining}室</span>{/if}
                        </p>
                      </div>
                      <div class="flex items-end justify-between gap-3 border-t border-stone-100 pt-3 sm:flex-col sm:items-end sm:border-0 sm:pt-0">
                        <div class="tabular-nums sm:text-right">
                          <p class="text-xl font-bold">{yen(o.perPerson)}<span class="ml-0.5 text-xs font-normal text-stone-500">/ 1名1泊{data.params.nights > 1 ? '（平均）' : ''}</span></p>
                          <p class="text-sm text-stone-500">1室 {data.params.nights}泊 {yen(o.totalPerPerson * data.params.guests)}</p>
                        </div>
                        {#if canBook}
                          <a href={bookHref(o)} class="shrink-0 rounded-lg bg-accent-600 px-5 py-2.5 text-base font-semibold text-white hover:bg-accent-500">予約する</a>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
                {#if card.plans.length > 2}
                  <div class="border-t border-stone-200 p-4 text-center sm:text-right">
                    <button type="button" aria-expanded={!!expanded[card.code]} onclick={() => (expanded[card.code] = !expanded[card.code])} class="w-full rounded-md border border-stone-300 px-5 py-2.5 text-sm font-semibold hover:border-[var(--pt-accent)] sm:w-auto sm:min-w-72">
                      {expanded[card.code] ? '閉じる' : `プランをすべて見る（${card.plans.length}件）`} <span aria-hidden="true">{expanded[card.code] ? '⌃' : '⌄'}</span>
                    </button>
                  </div>
                {/if}
              {:else}
                <p class="p-6 text-base text-stone-500">この日程・人数でご案内できるプランはありません。</p>
              {/if}
            </div>
          </article>
        {:else}
          <p class="rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">ご案内できるお部屋はありません。</p>
        {/each}
      </div>
    {/if}
  {/if}
</main>
<PartnerRoomModal bind:room={infoRoom} {token} />
