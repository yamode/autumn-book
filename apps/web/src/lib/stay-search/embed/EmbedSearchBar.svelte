<script lang="ts">
  // HP 配布の <yamado-search-bar> の中身（main.ts が Shadow DOM の中に mount する）。
  // 見た目と操作は取引先ページと同じ共通部品（StaySearchBar / StaySearchPanel）。ここでは
  // 空き日（/api/stay-calendar）の取得と、検索での遷移（E2・dataLayer）だけを受け持つ。
  import StaySearchBar from '$lib/components/stay-search/StaySearchBar.svelte';
  import StaySearchPanel, { type StayDayView } from '$lib/components/stay-search/StaySearchPanel.svelte';
  import { STAY_SEARCH_LABELS } from '$lib/stay-search/labels';
  import {
    LIMITS,
    MONTHS_AHEAD,
    buildSearchUrl,
    calendarUrl,
    dayState,
    parseCalendar,
    searchEvent,
    shiftYm,
    todayJst,
    type StayCalendarData,
    type StaySearchLang
  } from '$lib/stay-search/params';

  let {
    origin,
    facility,
    lang,
    utmSource = '',
    utmContent = ''
  }: { origin: string; facility: string; lang: StaySearchLang; utmSource?: string; utmContent?: string } = $props();

  const labels = $derived(STAY_SEARCH_LABELS[lang]);
  const today = todayJst();
  const latestYm = shiftYm(today.slice(0, 7), MONTHS_AHEAD);

  let date = $state('');
  let nights = $state<number>(LIMITS.nights.def);
  let guests = $state<number>(LIMITS.adults.def);
  let rooms = $state<number>(LIMITS.rooms.def);
  let open = $state<'' | 'date' | 'guests'>('');

  // 空き日（泊数×人数ごとにキャッシュ。続けて変えたら前の取得は捨てる）。取れなくても日付は選べる
  const cache = new Map<string, StayCalendarData>();
  let data = $state<StayCalendarData | null>(null);
  let loading = $state(false);
  let failed = $state(false);
  $effect(() => {
    if (open !== 'date') return;
    const key = `${facility}|${nights}|${guests}`;
    const hit = cache.get(key);
    if (hit) {
      data = hit;
      loading = false;
      failed = false;
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    data = null;
    loading = true;
    failed = false;
    fetch(calendarUrl(origin, facility, nights, guests), { credentials: 'omit', signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`http_${r.status}`))))
      .then((json) => {
        const parsed = parseCalendar(json);
        if (!parsed) throw new Error('bad_response');
        cache.set(key, parsed);
        if (!ctrl.signal.aborted) data = parsed;
      })
      .catch(() => {
        if (!ctrl.signal.aborted) failed = true;
      })
      .finally(() => {
        clearTimeout(timer);
        if (!ctrl.signal.aborted) loading = false;
      });
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  });

  function day(iso: string): StayDayView {
    const st = dayState(iso, today, data);
    return { price: st.price, disabled: st.disabled, mark: st.closed ? 'closed' : st.unavailable ? 'dash' : '' };
  }

  function search() {
    const url = buildSearchUrl(origin, { facility, lang, checkin: date, nights, adults: guests, rooms, utmSource, utmContent });
    if (!url) return;
    // Shadow DOM の中の操作は GTM の自動リンク計測に乗らないので、部品が自分で積む（設計書 §3.5）
    try {
      const dl = (window as unknown as { dataLayer?: { push?: (e: unknown) => void } }).dataLayer;
      if (dl && typeof dl.push === 'function') dl.push(searchEvent(facility, { checkin: date, nights, adults: guests, rooms }));
    } catch {
      // 計測に失敗しても遷移はする
    }
    window.location.href = url;
  }
</script>

<div role="search" aria-label={labels.region} {lang}>
  <StaySearchBar bind:date bind:nights bind:guests bind:rooms bind:open maxGuests={LIMITS.adults.max} maxRooms={LIMITS.rooms.max} {lang} {labels} onSearch={search}>
    {#snippet datePanel({ close })}
      <StaySearchPanel bind:date bind:nights {guests} {rooms} maxNights={LIMITS.nights.max} {today} {latestYm} loading={loading && !data} {failed} {day} {lang} {labels} onApply={search} onClose={close} />
    {/snippet}
  </StaySearchBar>
</div>
