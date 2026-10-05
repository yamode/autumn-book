<script lang="ts">
  // 取引先専用ページ: 料金カレンダー（2026-10-06 に一休型へ一本化。旧「お部屋とプラン」）。
  // 検索バー（Airbnb 風）→ 並び順 → 部屋タイプごとの全幅カード（一休のカードを再現）。
  // 日付を選ぶ前から全部屋のカードを出し、料金は今後3か月の最安〜。日程を選ぶと、その日程・人数・室数で
  // 予約できるプランと料金に切り替える。料金・空室は月の JSON（fetchPortalMonth）から画面側で組み立て、
  // 予約の金額・在庫は予約入力・確定時にサーバで改めて確かめる。
  import { goto } from '$app/navigation';
  import { navigating } from '$app/state';
  import { page } from '$app/stores';
  import PartnerRoomCalendarModal from '$lib/components/PartnerRoomCalendarModal.svelte';
  import PartnerRoomModal from '$lib/components/PartnerRoomModal.svelte';
  import PartnerSearchBar from '$lib/components/PartnerSearchBar.svelte';
  import { canBookFor, partnerPlanName } from '$lib/partner-booking';
  import { roomParts, type PartnerRoomContent } from '$lib/partner-contents';
  import { fetchPortalMonth } from '$lib/partner-month-client';
  import type { PartnerRateDay } from '$lib/partner-pricing';
  import { addDaysIsoClient, partnerReferencePlans, partnerStayOffers } from '$lib/partner-stay';

  let { data } = $props();
  const token = $derived($page.params.token ?? '');
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const num = (n: number) => n.toLocaleString('ja-JP');
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付' : m === '朝食' ? '朝食付' : m === '素泊' ? '食事なし' : (m ?? ''));
  const fmt = (iso: string) => {
    const t = new Date(`${iso}T00:00:00Z`);
    return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日（${WEEK[t.getUTCDay()]}）`;
  };
  const shiftYm = (ym: string, d: number) => {
    const [y, m] = ym.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
  };

  // ---- 検索条件（下書き → 「検索」で URL に反映） ----
  // svelte-ignore state_referenced_locally
  let date = $state(data.params.date);
  // svelte-ignore state_referenced_locally
  let nights = $state(data.params.nights);
  // svelte-ignore state_referenced_locally
  let guests = $state(data.params.guests);
  // svelte-ignore state_referenced_locally
  let rooms = $state(data.params.rooms);
  let openPanel = $state<'' | 'date' | 'guests'>('');
  $effect(() => {
    date = data.params.date;
    nights = data.params.nights;
    guests = data.params.guests;
    rooms = data.params.rooms;
  });
  function search() {
    openPanel = '';
    const q = new URLSearchParams({ nights: String(nights), guests: String(guests), rooms: String(rooms) });
    if (date) q.set('date', date);
    void goto(`/p/${token}/calendar?${q}`, { noScroll: true, keepFocus: true });
  }

  // ---- 料金の読み込み（日程あり: チェックインから泊数ぶん／日程なし: 今後3か月） ----
  const dated = $derived(!!data.params.date);
  let index = $state<Map<string, PartnerRateDay>>(new Map());
  let loading = $state(true);
  let loadError = $state('');
  $effect(() => {
    const { date: d, nights: n, guests: g } = data.params;
    const yms = d
      ? [...new Set(Array.from({ length: n }, (_, i) => addDaysIsoClient(d, i).slice(0, 7)))]
      : [0, 1, 2].map((i) => shiftYm(data.today.slice(0, 7), i));
    let cancelled = false;
    loading = true;
    loadError = '';
    // 日程なしの2・3か月目は公開範囲外なら空でよい（取れなくても1か月目で出す）
    Promise.all(yms.map((ym, i) => (d || i === 0 ? fetchPortalMonth(token, ym, g) : fetchPortalMonth(token, ym, g).catch(() => null))))
      .then((ms) => {
        if (cancelled) return;
        index = new Map(ms.flatMap((m) => (m ? m.days.map((day) => [day.date, day] as const) : [])));
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
  const closedDay = $derived(dated && index.get(data.params.date)?.closed === true);

  // ---- 部屋タイプごとのカード（プラン行は日程の有無で中身が変わる） ----
  type Row = {
    roomCode: string;
    roomName: string;
    planCode: string;
    planName: string;
    mealType: string | null;
    advance: boolean;
    /** 1名1泊（日程ありは全泊の平均、日程なしは今後3か月の最安） */
    perPerson: number;
    /** 日程ありのとき: 全室・全泊の合計 */
    total: number | null;
    remaining: number | null;
  };
  const rows = $derived.by((): Row[] => {
    if (loading) return [];
    const p = data.params;
    if (p.date) {
      return (partnerStayOffers((x) => index.get(x), p.date, p.nights, p.guests, { showInventory: data.showInventory, rooms: p.rooms }) ?? []).map((o) => ({
        ...o,
        total: o.totalPerPerson * p.guests * p.rooms
      }));
    }
    return partnerReferencePlans([...index.values()], p.guests, { showInventory: data.showInventory, from: data.today }).map((o) => ({
      ...o,
      perPerson: o.minPerPerson,
      total: null,
      remaining: null
    }));
  });
  let sort = $state<'asc' | 'desc'>('asc');
  let expanded = $state<Record<string, boolean>>({});
  type Card = { code: string; name: string; content: PartnerRoomContent | null; rows: Row[] };
  const byPrice = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : sort === 'asc' ? a - b : b - a);
  const cards = $derived.by((): Card[] => {
    const byRoom = new Map<string, Row[]>();
    for (const r of rows) byRoom.set(r.roomCode, [...(byRoom.get(r.roomCode) ?? []), r]);
    const list: Card[] = [];
    for (const r of data.rooms) {
      if (r.capacityMax && r.capacityMax < data.params.guests) continue;
      list.push({ code: r.code, name: r.name, content: r, rows: byRoom.get(r.code) ?? [] });
      byRoom.delete(r.code);
    }
    // 紹介が無い部屋も、料金があれば出す
    for (const [code, rs] of byRoom) list.push({ code, name: rs[0].roomName, content: null, rows: rs });
    for (const c of list) c.rows.sort((a, b) => byPrice(a.perPerson, b.perPerson));
    return list.sort((a, b) => Number(b.rows.length > 0) - Number(a.rows.length > 0) || byPrice(a.rows[0]?.perPerson ?? null, b.rows[0]?.perPerson ?? null));
  });
  const bookableCount = $derived(cards.filter((c) => c.rows.length).length);

  let infoRoom = $state<PartnerRoomContent | null>(null);
  let calendarRoom = $state<{ code: string; name: string } | null>(null);
  const planAnchorOf = (r: Row) => data.planAnchors.find((p) => p.planCode === r.planCode && p.planLabel === r.planName)?.anchor ?? null;
  const hasPerk = (code: string) => data.commonPerk || data.perkPlanCodes.includes(code);
  const canBook = $derived(dated && data.booking.enabled && canBookFor(data.params.date, data.booking));
  const bookHref = (r: Row) => {
    const p = data.params;
    const q = new URLSearchParams({
      room: r.roomCode,
      plan: r.planCode,
      name: r.planName,
      date: p.date,
      guests: String(p.guests),
      nights: String(p.nights),
      rooms: String(p.rooms),
      from: `${$page.url.pathname}${$page.url.search}`
    });
    return `/p/${token}/book?${q}`;
  };
  // 検索中（ページのデータを取り直している間）は一覧を薄くする。本番では1〜2秒かかり、古い一覧のままに見えるため
  const searching = $derived(!!navigating.to && navigating.to.url.pathname === $page.url.pathname);
  // 空室カレンダーで日付を選んだら、その日程で検索し直し、読み込みが終わってからその部屋のカードへ
  let scrollTo = $state<{ code: string; date: string } | null>(null);
  function pickFromCalendar(iso: string) {
    const code = calendarRoom?.code;
    calendarRoom = null;
    date = iso;
    if (code) scrollTo = { code, date: iso };
    search();
  }
  $effect(() => {
    if (!scrollTo || searching || loading || data.params.date !== scrollTo.date) return;
    const code = scrollTo.code;
    scrollTo = null;
    requestAnimationFrame(() => document.getElementById(`room-${code}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });
  const checkout = $derived(dated ? addDaysIsoClient(data.params.date, data.params.nights) : '');
  const guestText = $derived(`大人${data.params.guests}名${data.params.rooms > 1 ? ` × ${data.params.rooms}室` : ''}`);
</script>

<svelte:head>
  <title>料金カレンダー｜{data.portal.facilityName}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-6xl px-4 py-6 sm:px-6">
  <div class="relative z-30">
    <PartnerSearchBar
      {token}
      bind:date
      bind:nights
      bind:guests
      bind:rooms
      bind:open={openPanel}
      maxNights={data.booking.maxNights}
      maxRooms={data.booking.maxRooms}
      showInventory={data.showInventory}
      today={data.today}
      onSearch={search}
    />
  </div>

  <div class="mt-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      {#if dated}
        <p class="text-lg font-bold">{fmt(data.params.date)} 〜 {fmt(checkout)}・{data.params.nights}泊・{guestText}</p>
        {#if !loading && !loadError && !closedDay}<p class="text-sm text-stone-500">予約できるお部屋 {bookableCount}件</p>{/if}
      {:else}
        <p class="text-lg font-bold">すべてのお部屋とプラン</p>
        <p class="text-sm text-stone-500">料金は{guestText}でご利用時の、今後3か月の最安です。ご宿泊日を選ぶと、その日の料金と空室に切り替わります。</p>
      {/if}
    </div>
    <div class="flex gap-5 text-base" role="group" aria-label="並び順">
      {#each [['asc', '安い順'], ['desc', '高い順']] as [value, label]}
        <button type="button" aria-pressed={sort === value} onclick={() => (sort = value as 'asc' | 'desc')} class={`border-b-2 pb-1 ${sort === value ? 'border-brand-900 font-bold' : 'border-transparent text-stone-500 hover:text-brand-800'}`}>{label}</button>
      {/each}
    </div>
  </div>
  {#if dated && data.booking.enabled && !canBook}
    <p class="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">この宿泊日のご予約は受付を締め切りました。料金はご参考です。</p>
  {/if}

  {#if searching}
    <p class="mt-3 text-sm text-stone-500" role="status">検索しています…</p>
  {/if}
  {#if loading}
    <div class="mt-5 space-y-5" aria-label="読み込み中">
      {#each [0, 1] as i (i)}<div class="h-64 animate-pulse rounded-lg border border-stone-200 bg-white"></div>{/each}
    </div>
  {:else if loadError}
    <p class="mt-5 rounded-xl border border-rose-700/30 bg-rose-700/5 p-4 text-rose-700">{loadError}</p>
  {:else if closedDay}
    <p class="mt-5 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">この日は休館日です。別の日程をお選びください。</p>
  {:else}
    <div class={`mt-4 space-y-6 transition-opacity ${searching ? 'pointer-events-none opacity-40' : ''}`}>
      {#each cards as card (card.code)}
        {@const parts = roomParts(card.name)}
        {@const photo = card.content?.photos[0]?.url}
        <!-- 一休のカード: 左に写真と部屋、右にプラン行 -->
        <article id={`room-${card.code}`} class="scroll-mt-24 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] md:grid md:grid-cols-[280px_minmax(0,1fr)]">
          <div class="border-b border-stone-200 md:border-b-0 md:border-r">
            {#if photo}
              <button type="button" class="block w-full" onclick={() => (infoRoom = card.content)} aria-label={`${parts.room} お部屋の紹介`}>
                <img src={photo} alt={parts.room} class="aspect-[16/10] w-full object-cover" loading="lazy" />
              </button>
            {/if}
            <div class="px-5 py-4">
              {#if card.content}
                <button type="button" onclick={() => (infoRoom = card.content)} class="text-left text-base font-bold leading-snug text-sky-700 hover:underline">
                  {#if parts.building}{parts.building}｜{/if}{parts.room}
                </button>
              {:else}
                <p class="text-base font-bold leading-snug text-sky-700">{#if parts.building}{parts.building}｜{/if}{parts.room}</p>
              {/if}
              {#if card.content}
                <p class="mt-2 text-sm text-stone-600">
                  <span class="font-bold">定員</span> {card.content.capacityMin === card.content.capacityMax ? `${card.content.capacityMax}名` : `${card.content.capacityMin}名〜${card.content.capacityMax}名`}
                  {#if card.content.amenities.length}<span class="text-stone-400">｜</span>{card.content.amenities.slice(0, 3).join('・')}{/if}
                </p>
              {/if}
              <button type="button" onclick={() => (calendarRoom = { code: card.code, name: card.name })} class="mt-4 rounded-md border border-stone-300 px-4 py-2 text-sm font-bold text-brand-900 hover:border-brand-900">空室カレンダー</button>
            </div>
          </div>
          <div class="min-w-0">
            {#if card.rows.length}
              <div class="divide-y divide-stone-200">
                {#each card.rows.slice(0, expanded[card.code] ? card.rows.length : 2) as r (r.planCode + r.planName)}
                  {@const anchor = planAnchorOf(r)}
                  <div class="grid gap-3 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
                    <div class="min-w-0">
                      <p class="text-[15px] leading-7 text-brand-900">{partnerPlanName(data.planNames, r.planCode, r.planName)}</p>
                      <p class="mt-3 text-sm text-brand-900">
                        {#if data.times}<span class="font-bold">IN</span> {data.times.checkin}<span class="ml-3 font-bold">OUT</span> {data.times.checkout}{/if}
                        {#if dated && data.showInventory && r.remaining != null && r.remaining <= 2}<span class="ml-3 font-bold text-rose-600">残りあと{r.remaining}室</span>{/if}
                      </p>
                      <p class="mt-1.5 flex flex-wrap gap-x-3 text-sm">
                        {#if anchor}<a href={`/p/${token}/plans#${anchor}`} class="text-sky-700 hover:underline">プランの紹介</a>{/if}
                        {#if r.advance}<span class="font-medium text-accent-600">先行案内</span>{/if}
                      </p>
                    </div>
                    <div class="flex flex-col items-end justify-between gap-2 text-right">
                      {#if hasPerk(r.planCode)}<p class="text-xs font-bold text-amber-700">専用特典つき</p>{/if}
                      <p class="flex flex-wrap items-baseline justify-end gap-x-1.5 text-sm text-brand-900">
                        {#if r.mealType}<span class="rounded-sm border border-amber-600 px-1 text-[11px] leading-4 text-amber-700">{mealLabel(r.mealType)}</span>{/if}
                        <span>{data.params.guests}名 税込</span>
                        <span class="text-2xl font-bold tabular-nums">{num(r.perPerson * data.params.guests)}</span><span class="font-bold">円〜</span>
                      </p>
                      <p class="text-xs text-stone-500">
                        {#if dated}
                          1室1泊{data.params.nights > 1 ? '（平均）' : ''}{#if r.total != null && (data.params.nights > 1 || data.params.rooms > 1)}・{data.params.rooms > 1 ? `${data.params.rooms}室` : ''}{data.params.nights}泊 合計 {num(r.total)}円{/if}
                        {:else}
                          1室1泊・今後3か月の最安
                        {/if}
                      </p>
                      {#if dated && canBook}
                        <a href={bookHref(r)} class="mt-1 rounded-md bg-green-600 px-5 py-2.5 text-base font-bold text-white hover:bg-green-700">詳細・予約</a>
                      {:else if !dated}
                        <button type="button" onclick={() => (calendarRoom = { code: card.code, name: card.name })} class="mt-1 rounded-md bg-green-600 px-5 py-2.5 text-base font-bold text-white hover:bg-green-700">空室を見る</button>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
              {#if card.rows.length > 2}
                <div class="border-t border-stone-200 px-5 py-4 text-right">
                  <button type="button" aria-expanded={!!expanded[card.code]} onclick={() => (expanded[card.code] = !expanded[card.code])} class="w-full rounded-md border border-stone-300 px-6 py-2.5 text-sm font-bold text-sky-700 hover:border-sky-700 sm:w-auto sm:min-w-72">
                    {expanded[card.code] ? '閉じる' : `プランをすべてみる（${card.rows.length}件）`} <span aria-hidden="true" class={`ml-1 inline-block transition ${expanded[card.code] ? 'rotate-180' : ''}`}>⌄</span>
                  </button>
                </div>
              {/if}
            {:else}
              <p class="px-5 py-6 text-base text-stone-500">{dated ? 'この日程・人数・室数でご案内できるプランはありません。' : 'ご案内できるプランはありません。'}</p>
            {/if}
          </div>
        </article>
      {:else}
        <p class="rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">ご案内できるお部屋はありません。</p>
      {/each}
    </div>
  {/if}
</main>

<PartnerRoomCalendarModal
  bind:room={calendarRoom}
  {token}
  guests={data.params.guests}
  nights={data.params.nights}
  rooms={data.params.rooms}
  showInventory={data.showInventory}
  today={data.today}
  selected={data.params.date}
  onPick={pickFromCalendar}
/>
<PartnerRoomModal bind:room={infoRoom} {token} />
