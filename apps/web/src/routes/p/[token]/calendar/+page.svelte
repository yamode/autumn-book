<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { replaceState } from '$app/navigation';
  import PartnerRoomModal from '$lib/components/PartnerRoomModal.svelte';
  import { partnerStayOffers } from '$lib/partner-stay';
  import type { PartnerRoomContent } from '$lib/partner-contents';
  import { page } from '$app/stores';
  import { isHoliday } from '$lib/holidays';
  import { planAnchor, roomAnchor } from '$lib/partner-contents';
  import { partnerPlanName } from '$lib/partner-booking';
  import type { PartnerRateDay } from '$lib/partner-pricing';
  import type { PortalMonth } from '$lib/server/partners/portal-month';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const pad = (n: number) => String(n).padStart(2, '0');
  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const GUEST_OPTIONS = [1, 2, 3, 4, 5, 6];

  // ---- 月データ（一度取った月は手元に残し、前後の月は先読みする） ----
  const initial = untrack(() => data.initial);
  const keyOf = (ym: string, guests: number) => `${ym}|${guests}`;
  const ymOf = (m: PortalMonth) => `${m.month.year}-${pad(m.month.month)}`;
  const monthCache = new Map<string, PortalMonth>([[keyOf(ymOf(initial), initial.guests), initial]]);
  const inflight = new Map<string, Promise<PortalMonth>>();
  const viewed = new Set<string>([keyOf(ymOf(initial), initial.guests)]);
  // monthCache は素の Map なので、増えたことを画面に知らせる番号（連泊の判定は複数の月をまたいで見る）
  let cacheVersion = $state(0);

  let current = $state<PortalMonth>(initial);
  let guests = $state(initial.guests);
  let loading = $state(false);
  let loadError = $state('');
  let roomFilter = $state('');
  let selected = $state<string | null>(null);
  // 泊数（連泊は同じ部屋・同じプランで全泊空いている日だけ出す）
  let nights = $state(1);
  const maxNights = $derived(Math.max(1, data.booking.maxNights ?? 7));
  let infoRoom = $state<PartnerRoomContent | null>(null);
  const roomContent = (code: string) => (data.introRoomContents ?? []).find((r) => r.code === code) ?? null;

  const token = $derived($page.params.token);
  const bounds = $derived(current.bounds);

  function fetchMonth(ym: string, g: number, view: boolean): Promise<PortalMonth> {
    const key = keyOf(ym, g);
    const cached = monthCache.get(key);
    if (cached) return Promise.resolve(cached);
    const running = inflight.get(key);
    if (running) return running;
    const p = fetch(`/p/${token}/calendar/month?month=${ym}&guests=${g}&view=${view ? 1 : 0}`, { headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          location.href = `/p/${token}`;
          throw new Error('ログインが切れました。');
        }
        if (!res.ok) throw new Error('料金を読み込めませんでした。');
        const body = (await res.json()) as PortalMonth;
        monthCache.set(key, body);
        cacheVersion += 1;
        if (view) viewed.add(key);
        return body;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  const shiftYm = (ym: string, delta: number) => {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  };
  const ymInBounds = (ym: string) => `${ym}-31` >= bounds.earliest && `${ym}-01` <= bounds.latest;

  // 表示中の月の前後を裏で読んでおく（切り替えを待たせない）。
  function prefetchAround(ym: string, g: number) {
    for (const d of [1, -1, 2]) {
      const next = shiftYm(ym, d);
      if (ymInBounds(next)) fetchMonth(next, g, false).catch(() => {});
    }
  }

  let requestSeq = 0;
  async function show(ym: string, g: number) {
    const seq = ++requestSeq;
    const key = keyOf(ym, g);
    selected = null;
    loadError = '';
    guests = g;
    const url = new URL($page.url);
    url.searchParams.set('month', ym);
    url.searchParams.set('guests', String(g));
    replaceState(url, {});
    const cached = monthCache.get(key);
    if (cached) {
      current = cached;
      // 先読みで取っていた月も、表示した時点で閲覧として記録する。
      if (!viewed.has(key)) {
        viewed.add(key);
        fetch(`/p/${token}/calendar/month?month=${ym}&guests=${g}&view=1`).catch(() => {});
      }
    } else {
      loading = true;
      try {
        const body = await fetchMonth(ym, g, true);
        if (seq !== requestSeq) return;
        current = body;
      } catch (e) {
        if (seq === requestSeq) loadError = e instanceof Error ? e.message : '料金を読み込めませんでした。';
      } finally {
        if (seq === requestSeq) loading = false;
      }
    }
    prefetchAround(ym, g);
  }

  // ---- 公開期間の料金の幅（1名1泊の最低〜最高）。公開範囲全体を読むので重く、表示後に別で取りに行く ----
  // 取得中はスケルトン、取れなかった・料金が無いときはカードごと出さない。
  // min / max は根拠つき（どの日・部屋・プラン・人数の料金か）。金額にマウスを乗せる・タップするとツールチップで出す。
  type PriceBasis = { date: string; roomName: string; planCode?: string; planName: string; guests: number };
  type PriceExtreme = { price: number; count: number; samples: PriceBasis[] };
  let priceRange = $state<{ min: PriceExtreme; max: PriceExtreme; from: string; to: string } | null>(null);
  let priceRangeState = $state<'loading' | 'done' | 'hidden'>('loading');
  const isExtreme = (v: unknown): v is PriceExtreme =>
    !!v && typeof v === 'object' && typeof (v as PriceExtreme).price === 'number' && Array.isArray((v as PriceExtreme).samples);
  async function loadPriceRange() {
    try {
      const res = await fetch(`/p/${token}/calendar/range`, { headers: { accept: 'application/json' } });
      const j = (await res.json().catch(() => null)) as { min?: unknown; max?: unknown; from?: string; to?: string } | null;
      if (!res.ok || !j || !isExtreme(j.min) || !isExtreme(j.max) || !j.from || !j.to) {
        priceRangeState = 'hidden';
        return;
      }
      priceRange = { min: j.min, max: j.max, from: j.from, to: j.to };
      priceRangeState = 'done';
    } catch {
      priceRangeState = 'hidden';
    }
  }
  const md = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number);
    return `${m}月${d}日`;
  };
  // 公開期間は年をまたぐので年まで出す（例: 2026年10月1日）
  const ymdLabel = (iso: string) => `${Number(iso.slice(0, 4))}年${md(iso)}`;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const mdw = (iso: string) => `${md(iso)}（${WD[new Date(`${iso}T00:00:00Z`).getUTCDay()]}）`;
  // ツールチップ: PC はマウスを乗せる／フォーカスで、スマホはタップで開閉（外側タップ・Esc で閉じる）
  // マウス・フォーカス・タップ固定を別々に持つ（1つにまとめると、フォーカス中にマウスが通過して閉じる等が起きる）
  let tipPinned = $state<'min' | 'max' | null>(null);
  let tipHover = $state<'min' | 'max' | null>(null);
  let tipFocus = $state<'min' | 'max' | null>(null);
  const tipOpen = $derived(tipHover ?? tipFocus ?? tipPinned);
  function closeTip() {
    tipPinned = null;
    tipHover = null;
    tipFocus = null;
  }
  // 最低＝最高なら金額は1つだけ出す
  const rangeKinds = $derived<('min' | 'max')[]>(priceRange && priceRange.max.price !== priceRange.min.price ? ['min', 'max'] : ['min']);
  const tipFor = $derived(tipOpen && priceRange ? { kind: tipOpen, ex: priceRange[tipOpen] } : null);

  onMount(() => {
    prefetchAround(ymOf(initial), initial.guests);
    void loadPriceRange();
  });

  const currentYm = $derived(ymOf(current));
  const canPrev = $derived(ymInBounds(shiftYm(currentYm, -1)));
  const canNext = $derived(ymInBounds(shiftYm(currentYm, 1)));
  // すぐ飛べる月（公開範囲内・最大12か月）。
  const monthTabs = $derived.by(() => {
    const out: string[] = [];
    let ym = bounds.earliest.slice(0, 7);
    while (out.length < 12 && `${ym}-01` <= bounds.latest) {
      out.push(ym);
      ym = shiftYm(ym, 1);
    }
    return out;
  });

  // ---- 表示用の計算 ----
  const byDate = $derived(new Map(current.days.map((d) => [d.date, d])));
  // 絞り込みの候補は、この月に料金がある（＝この取引先に公開している）部屋だけ。
  const shownRooms = $derived.by(() => {
    const codes = new Set(current.days.flatMap((d) => d.rooms.map((r) => r.roomCode)));
    return current.rooms.filter((r) => codes.has(r.roomCode));
  });
  // 選んでいた部屋が、切り替えた月に無ければ「すべて」に戻す。
  $effect(() => {
    if (roomFilter && !shownRooms.some((r) => r.roomCode === roomFilter)) roomFilter = '';
  });
  const visibleRooms = (day: PartnerRateDay) => (roomFilter ? day.rooms.filter((r) => r.roomCode === roomFilter) : day.rooms);
  function cheapest(day: PartnerRateDay): number | null {
    let min: number | null = null;
    for (const room of visibleRooms(day)) {
      if (data.showInventory && room.remainingRooms === 0) continue;
      for (const plan of room.plans) {
        const p = plan.pricesPerPerson[String(current.guests)];
        if (p != null && (min == null || p < min)) min = p;
      }
    }
    return min;
  }
  function remaining(day: PartnerRateDay): number | null {
    if (!data.showInventory) return null;
    if (!roomFilter) return day.remainingRooms;
    return day.rooms.find((r) => r.roomCode === roomFilter)?.remainingRooms ?? null;
  }
  // ---- 連泊（2泊以上）: 読み込んだ全部の月から日を引き、翌月も読んでおく ----
  const dayIndex = $derived.by(() => {
    void cacheVersion;
    const map = new Map<string, PartnerRateDay>();
    for (const [key, m] of monthCache) if (key.endsWith(`|${guests}`)) for (const d of m.days) map.set(d.date, d);
    for (const d of current.days) map.set(d.date, d);
    return map;
  });
  $effect(() => {
    if (nights <= 1) return;
    const next = shiftYm(currentYm, 1);
    if (ymInBounds(next)) fetchMonth(next, guests, false).catch(() => {});
  });
  const stayOffersOn = (iso: string) =>
    partnerStayOffers((d) => dayIndex.get(d), iso, nights, current.guests, { showInventory: data.showInventory, roomCode: roomFilter || undefined });
  // マス目の最安・残室（連泊用）。判定できない・泊まれない日は min=null（「—」）
  function stayCell(iso: string): { min: number | null; rest: number | null } {
    const offers = stayOffersOn(iso);
    if (!offers || !offers.length) return { min: null, rest: null };
    const rests = offers.map((o) => o.remaining).filter((n): n is number => n != null);
    return { min: offers[0].perPerson, rest: data.showInventory && rests.length ? Math.max(...rests) : null };
  }

  // 空室の目安（autumn-book と同じ: 0=× / 1=△ / 3室まで=○ / それ以上=◎）。残り2室以下は実数も出す。
  const markOf = (rest: number | null) => (rest == null ? '' : rest <= 0 ? '×' : rest === 1 ? '△' : rest <= 3 ? '○' : '◎');

  type Cell = { iso: string; day?: PartnerRateDay; min: number | null; rest: number | null; inRange: boolean; dow: number; holiday: boolean };
  const cells = $derived.by(() => {
    const { year, month } = current.month;
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const out: (Cell | null)[] = Array(first).fill(null);
    for (let d = 1; d <= last; d += 1) {
      const iso = `${year}-${pad(month)}-${pad(d)}`;
      const day = byDate.get(iso);
      const open = day && !day.closed;
      const stay = open && nights > 1 ? stayCell(iso) : null;
      out.push({
        iso,
        day,
        min: open ? (stay ? stay.min : cheapest(day)) : null,
        rest: open ? (stay ? stay.rest : remaining(day)) : null,
        inRange: iso >= bounds.earliest && iso <= bounds.latest,
        dow: (first + d - 1) % 7,
        holiday: isHoliday(iso)
      });
    }
    while (out.length % 7) out.push(null);
    return out;
  });
  const monthMin = $derived.by(() => {
    let min: number | null = null;
    for (const c of cells) if (c?.min != null && (c.rest == null || c.rest > 0) && (min == null || c.min < min)) min = c.min;
    return min;
  });

  const selectedDay = $derived(selected ? byDate.get(selected) : undefined);
  // 日別パネルの部屋×プラン（1泊はその日の料金、連泊は全泊そろうものの1泊平均）
  type PanelPlan = { planCode: string; planName: string; mealType: string | null; advance: boolean; price: number; total: number };
  type PanelRoom = { roomCode: string; roomName: string; remainingRooms: number | null; plans: PanelPlan[] };
  const panelRooms = $derived.by((): PanelRoom[] | null => {
    if (!selectedDay || selectedDay.closed) return [];
    if (nights <= 1) {
      return visibleRooms(selectedDay).map((room) => ({
        roomCode: room.roomCode,
        roomName: room.roomName,
        remainingRooms: room.remainingRooms,
        plans: room.plans
          .map((plan) => ({ plan, price: plan.pricesPerPerson[String(current.guests)] }))
          .filter((x): x is { plan: typeof x.plan; price: number } => x.price != null)
          .map(({ plan, price }) => ({ planCode: plan.planCode, planName: plan.planName, mealType: plan.mealType, advance: plan.advance, price, total: price }))
      }));
    }
    const offers = stayOffersOn(selectedDay.date);
    if (!offers) return null;
    const rooms = new Map<string, PanelRoom>();
    for (const o of offers) {
      const room = rooms.get(o.roomCode) ?? { roomCode: o.roomCode, roomName: o.roomName, remainingRooms: o.remaining, plans: [] };
      if (o.remaining != null) room.remainingRooms = room.remainingRooms == null ? o.remaining : Math.max(room.remainingRooms, o.remaining);
      room.plans.push({ planCode: o.planCode, planName: o.planName, mealType: o.mealType, advance: o.advance, price: o.perPerson, total: o.totalPerPerson });
      rooms.set(o.roomCode, room);
    }
    return [...rooms.values()];
  });
  // 予約入力の「戻る」でこの画面（同じ月・人数）に戻す
  const bookHref = (roomCode: string, plan: { planCode: string; planName: string }, date: string) => {
    const q = new URLSearchParams({ room: roomCode, plan: plan.planCode, name: plan.planName, date, guests: String(current.guests), nights: String(nights) });
    q.set('from', `${$page.url.pathname}?${new URLSearchParams({ month: currentYm, guests: String(current.guests) })}`);
    return `/p/${token}/book?${q}`;
  };
  const fmtDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}${isHoliday(iso) ? '・祝' : ''}）`;
  };
  // 取引先向けのプラン名（管理画面で付けた名前。無ければ社内向けの調整表記と区分の前置きを落とした既定の表示名）
  const planLabel = (code: string | undefined, name: string) => partnerPlanName(data.planNames, code, name);
  const roomParts = (name: string) => {
    const [a, b] = name.split('│');
    return b ? { building: a.replace(/-+$/, '').trim(), room: b.trim() } : { building: '', room: name };
  };
  const dowColor = (c: Cell) => (c.dow === 0 || c.holiday ? 'text-rose-700' : c.dow === 6 ? 'text-sky-700' : '');

  // 予約の受付締切（宿泊日の N 日前の H 時・JST）。確定時にサーバで再確認する。
  function bookable(iso: string): boolean {
    if (!data.booking.enabled) return false;
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - data.booking.leadDays);
    const deadline = Date.parse(`${d.toISOString().slice(0, 10)}T${String(data.booking.cutoffHour).padStart(2, '0')}:00:00Z`) - 9 * 3600 * 1000;
    return Date.now() < deadline;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // お部屋の紹介のモーダルが開いているときは、そちらだけ閉じる
      if (document.querySelector('[data-room-info]')) return;
      // 料金の根拠のツールチップが開いていれば、それだけ閉じる（日別パネルは閉じない）
      if (tipOpen) {
        closeTip();
        (document.activeElement as HTMLElement | null)?.blur?.();
      } else selected = null;
    }
  }
</script>

<svelte:window onkeydown={onKey} onclick={() => (tipPinned = null)} />

<svelte:head>
  <title>{current.month.year}年{current.month.month}月 | {data.portal.facilityName} 料金カレンダー</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-6xl px-4 pb-6 pt-6 sm:px-6">
  <!-- 公開期間の料金の幅（あとから読み込む。取れなければ出さない） -->
  {#if priceRangeState !== 'hidden'}
    <section class="relative z-30 mb-4 rounded-xl border border-stone-200 bg-white px-4 py-3 sm:px-5">
      <p class="text-xs text-stone-500">公開期間の料金（1名1泊・税込・入湯税別）</p>
      {#if priceRangeState === 'loading' || !priceRange}
        <div class="mt-1.5 h-7 w-56 max-w-full animate-pulse rounded bg-stone-100" aria-label="読み込み中"></div>
      {:else}
        <p class="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5" aria-live="polite">
          <span class="text-xl font-bold tabular-nums text-brand-900">
            {#each rangeKinds as kind, i (kind)}
              {#if i > 0}<span class="px-1 font-normal text-stone-400">〜</span>{/if}
              <button
                type="button"
                class="cursor-help rounded underline decoration-stone-300 decoration-dotted underline-offset-4 outline-none hover:decoration-[var(--pt-accent)] focus-visible:ring-2 focus-visible:ring-[var(--pt-accent-soft)]"
                aria-describedby={tipOpen === kind ? 'price-range-tip' : undefined}
                aria-expanded={tipOpen === kind}
                onmouseenter={() => (tipHover = kind)}
                onmouseleave={() => (tipHover = null)}
                onfocus={() => (tipFocus = kind)}
                onblur={() => (tipFocus = null)}
                onclick={(e) => {
                  e.stopPropagation();
                  if (tipOpen === kind) {
                    // 開いている金額をもう一度押したら閉じる（スマホのタップは hover・focus も立つので全部消す）
                    closeTip();
                    e.currentTarget.blur();
                  } else {
                    tipPinned = kind;
                  }
                }}
              >{yen(priceRange[kind].price)}</button>
            {/each}
          </span>
          <span class="text-sm text-stone-500">（{ymdLabel(priceRange.from)}〜{ymdLabel(priceRange.to)}）</span>
          <span class="text-xs text-stone-400">金額にマウスを乗せる（タップする）と、どの日・お部屋・プランの料金か表示します</span>
        </p>
        {#if tipFor}
          <div
            id="price-range-tip"
            role="tooltip"
            class="absolute left-2 right-2 top-full mt-1 rounded-lg border border-stone-200 bg-white p-3 text-sm shadow-lg sm:left-4 sm:right-auto sm:w-[28rem]"
          >
            <p class="mb-1.5 font-medium text-brand-900">
              {tipFor.kind === 'min' ? '最低料金' : '最高料金'} {yen(tipFor.ex.price)}（1名1泊）
              {#if tipFor.ex.count > 1}<span class="text-xs font-normal text-stone-500">・該当 {tipFor.ex.count.toLocaleString('ja-JP')} 件</span>{/if}
            </p>
            <ul class="space-y-1">
              {#each tipFor.ex.samples as s (`${s.date}|${s.roomName}|${s.planName}|${s.guests}`)}
                <li class="leading-5">
                  <span class="tabular-nums text-stone-700">{mdw(s.date)}</span>
                  <span class="text-stone-600">・{s.roomName}・{planLabel(s.planCode, s.planName)}・{s.guests}名1室</span>
                </li>
              {/each}
            </ul>
            {#if tipFor.ex.count > tipFor.ex.samples.length}
              <p class="mt-1 text-xs text-stone-500">ほか {(tipFor.ex.count - tipFor.ex.samples.length).toLocaleString('ja-JP')} 件（日付の早い順に表示）</p>
            {/if}
          </div>
        {/if}
      {/if}
    </section>
  {/if}

  <!-- 条件 -->
  <section class="mb-5 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <button type="button" aria-label="前の月" disabled={!canPrev} onclick={() => show(shiftYm(currentYm, -1), guests)} class="nav-btn">
          <svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <h2 class="min-w-36 text-center text-2xl font-bold tracking-wide">
          <span class="text-lg font-medium text-stone-500">{current.month.year}年</span>{current.month.month}月
        </h2>
        <button type="button" aria-label="次の月" disabled={!canNext} onclick={() => show(shiftYm(currentYm, 1), guests)} class="nav-btn">
          <svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="shrink-0 whitespace-nowrap text-sm text-stone-500">ご利用人数</span>
        <div class="flex max-w-full overflow-x-auto rounded-full bg-stone-50 p-1" role="radiogroup" aria-label="1室の利用人数">
          {#each GUEST_OPTIONS as g}
            <button
              type="button"
              role="radio"
              aria-checked={guests === g}
              onclick={() => show(currentYm, g)}
              class={`whitespace-nowrap rounded-full px-2.5 py-1 text-base tabular-nums transition sm:px-3 ${guests === g ? 'bg-brand-800 font-medium text-white shadow-sm' : 'text-stone-500 hover:text-brand-800'}`}
            >{g}名</button>
          {/each}
        </div>
        <span class="ml-2 shrink-0 whitespace-nowrap text-sm text-stone-500">泊数</span>
        <div class="flex items-center gap-1.5 rounded-full bg-stone-50 p-1">
          <button type="button" aria-label="泊数を減らす" disabled={nights <= 1} onclick={() => (nights -= 1)} class="flex h-8 w-8 items-center justify-center rounded-full text-lg text-brand-800 hover:bg-white disabled:opacity-30">−</button>
          <span class="min-w-10 text-center text-base font-medium tabular-nums">{nights}泊</span>
          <button type="button" aria-label="泊数を増やす" disabled={nights >= maxNights} onclick={() => (nights += 1)} class="flex h-8 w-8 items-center justify-center rounded-full bg-brand-800 text-lg text-white disabled:opacity-30">＋</button>
        </div>
      </div>
    </div>

    <div class="-mx-1 mt-4 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
      {#each monthTabs as ym}
        {@const [y, m] = ym.split('-').map(Number)}
        <button
          type="button"
          onclick={() => show(ym, guests)}
          class={`shrink-0 rounded-full border px-3.5 py-1 text-sm transition ${ym === currentYm ? 'border-accent-500 bg-accent-500/10 font-semibold text-accent-600' : 'border-stone-200 text-stone-500 hover:border-stone-300 hover:text-brand-900'}`}
        >{m === 1 || ym === monthTabs[0] ? `${y}年` : ''}{m}月</button>
      {/each}
    </div>

    {#if shownRooms.length > 1}
      <div class="-mx-1 mt-3 flex gap-1.5 overflow-x-auto border-t border-stone-200 px-1 pb-1 pt-3 [scrollbar-width:none]">
        <button type="button" onclick={() => (roomFilter = '')} class={`chip ${roomFilter === '' ? 'chip-on' : ''}`}>すべてのお部屋</button>
        {#each shownRooms as room}
          {@const rp = roomParts(room.name)}
          <button type="button" onclick={() => (roomFilter = room.roomCode)} class={`chip ${roomFilter === room.roomCode ? 'chip-on' : ''}`} title={room.name}>
            {#if rp.building}<span class="opacity-70">{rp.building}</span> {/if}{rp.room}
          </button>
        {/each}
      </div>
    {/if}
  </section>

  <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
    <!-- カレンダー -->
    <section class="relative">
      <div class="mb-2 flex flex-wrap items-end justify-between gap-2 px-1">
        <p class="text-sm leading-5 text-stone-500">
          <strong class="font-medium text-brand-900">{current.guests}名1室{nights > 1 ? `・${nights}泊` : ''}</strong>でご利用時の、お一人様あたりの{nights > 1 ? '1泊平均の' : ''}最低料金（税込・入湯税別）
        </p>
        {#if data.showInventory}
          <p class="flex gap-3 text-xs text-stone-500">
            <span><b class="text-[var(--pt-accent)]">◎</b> 空室あり</span>
            <span><b class="text-[var(--pt-accent)]">○</b> 残りわずか</span>
            <span><b class="text-amber-700">△</b> 残り1室</span>
            <span><b>×</b> 満室</span>
          </p>
        {/if}
      </div>

      <div class="overflow-hidden rounded-xl border border-stone-200 bg-white">
        <div class="grid grid-cols-7 border-b border-stone-200 bg-stone-50/60">
          {#each WEEK as w, i}
            <div class={`py-2 text-center text-sm font-medium ${i === 0 ? 'text-rose-700' : i === 6 ? 'text-sky-700' : 'text-stone-500'}`}>{w}</div>
          {/each}
        </div>
        <div class={`grid grid-cols-7 gap-px bg-stone-200 transition-opacity ${loading ? 'opacity-50' : ''}`}>
          {#each cells as c, i (c?.iso ?? `blank-${i}`)}
            {#if !c}
              <div class="min-h-[84px] bg-stone-50/50 sm:min-h-[104px]"></div>
            {:else}
              {@const soldOut = c.rest === 0}
              {@const bookable = c.inRange && !!c.day && !c.day.closed && c.min != null}
              <button
                type="button"
                disabled={!c.inRange || !c.day || c.day.closed}
                onclick={() => (selected = c.iso)}
                aria-pressed={selected === c.iso}
                class={`cell group relative flex min-h-[84px] flex-col items-stretch p-1.5 text-left sm:min-h-[104px] sm:p-2.5
                  ${selected === c.iso ? 'cell-selected' : ''}
                  ${bookable && !soldOut ? 'bg-white hover:bg-accent-500/5' : 'bg-white'}
                  ${!c.inRange || !c.day ? 'cursor-default bg-stone-50/50 text-stone-500/50' : ''}
                  ${c.day?.closed ? 'closed cursor-default' : ''}`}
              >
                <div class="flex items-start justify-between">
                  <span class={`text-sm font-semibold tabular-nums sm:text-base ${c.inRange ? dowColor(c) : ''}`}>{Number(c.iso.slice(8))}</span>
                  {#if bookable && c.rest != null}
                    <span class={`text-sm font-bold leading-none sm:text-base ${c.rest === 0 ? 'text-stone-500' : c.rest === 1 ? 'text-amber-700' : 'text-[var(--pt-accent)]'}`}>{markOf(c.rest)}</span>
                  {/if}
                </div>
                <div class="mt-auto">
                  {#if c.day?.closed}
                    <span class="text-[11px] text-stone-500 sm:text-sm">休館日</span>
                  {:else if c.inRange && c.day && c.min != null}
                    {#if monthMin != null && c.min === monthMin && !soldOut}
                      <span class="mb-0.5 inline-block rounded bg-accent-500 px-1 text-[10px] font-bold leading-4 text-white sm:text-[11px]">最安</span>
                    {/if}
                    <div class={`text-xs font-semibold tabular-nums leading-tight sm:text-[17px] ${soldOut ? 'text-stone-500 line-through decoration-1' : 'text-brand-900'}`}>
                      <span class="hidden sm:inline">¥</span>{c.min.toLocaleString('ja-JP')}<span class="hidden text-xs font-normal text-stone-500 sm:inline">〜</span>
                    </div>
                    {#if soldOut}
                      <span class="text-[11px] text-stone-500 sm:text-xs">満室</span>
                    {:else if c.rest != null && c.rest <= 2}
                      <span class="text-[11px] font-medium text-amber-700 sm:text-xs">残り{c.rest}室</span>
                    {/if}
                  {:else if c.inRange && c.day}
                    <span class="text-[11px] text-stone-500 sm:text-sm">{soldOut ? '満室' : '—'}</span>
                  {/if}
                </div>
              </button>
            {/if}
          {/each}
        </div>
      </div>
      {#if loading}
        <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div class="flex items-center gap-2 rounded-full bg-white px-4 py-2 text-base text-stone-500 shadow-md">
            <span class="spinner"></span>料金を読み込んでいます
          </div>
        </div>
      {/if}
      {#if loadError}
        <p class="mt-3 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-base text-rose-700">{loadError}</p>
      {/if}
      {#if current.fetchedAt}
        <p class="mt-2 px-1 text-right text-xs text-stone-500">
          料金の更新: {new Date(current.fetchedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' })}
          {#if data.showInventory}・残室は目安です（ご予約時点で変わることがあります）{/if}
        </p>
      {/if}
    </section>

    <!-- 料金の詳細（PC は右に固定、スマホは下から出す） -->
    <aside class={`detail ${selectedDay ? 'detail-open' : ''}`} aria-live="polite">
      {#if selectedDay}
        <div class="flex items-start justify-between gap-3 border-b border-stone-200 px-5 pb-3 pt-5">
          <div>
            <p class="text-xs font-medium tracking-wider text-accent-600">ご宿泊日</p>
            <h3 class="text-xl font-bold">{fmtDate(selectedDay.date)}</h3>
            <p class="mt-0.5 text-sm text-stone-500">{current.guests}名1室・{nights}泊・お一人様あたり{nights > 1 ? '1泊平均' : ''}（税込・入湯税別）</p>
          </div>
          <button type="button" aria-label="閉じる" onclick={() => (selected = null)} class="nav-btn h-8 w-8 shrink-0">
            <svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
          </button>
        </div>
        <div class="max-h-[60vh] overflow-y-auto px-5 py-4 lg:max-h-[calc(100vh-10rem)]">
          {#if selectedDay.closed}
            <p class="text-base text-stone-500">休館日です。</p>
          {:else if panelRooms === null}
            <p class="text-base text-stone-500">料金を読み込んでいます…</p>
          {:else if panelRooms.length === 0}
            <p class="text-base text-stone-500">{nights > 1 ? `この日から${nights}泊でご案内できるお部屋はありません。` : 'この条件でご案内できる料金はありません。'}</p>
          {:else}
            <div class="grid gap-4">
              {#each panelRooms as room (room.roomCode)}
                {@const rp = roomParts(room.roomName)}
                {@const full = room.remainingRooms === 0}
                <article class={`rounded-xl border border-stone-200 ${full ? 'opacity-60' : ''}`}>
                  <header class="flex items-start justify-between gap-2 rounded-t-xl bg-[var(--pt-accent-soft)]/60 px-3.5 py-2.5">
                    <div class="min-w-0">
                      {#if rp.building}<p class="text-xs tracking-wide text-[var(--pt-accent)]">{rp.building}</p>{/if}
                      <h4 class="text-[17px] font-bold leading-snug">{rp.room}</h4>
                      {#if roomContent(room.roomCode)}<button type="button" onclick={() => (infoRoom = roomContent(room.roomCode))} class="text-xs text-[var(--pt-accent)] underline">お部屋の紹介</button>{/if}
                    </div>
                    {#if room.remainingRooms != null}
                      <span class={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${full ? 'bg-stone-200 text-stone-500' : room.remainingRooms <= 2 ? 'bg-amber-700/10 text-amber-700' : 'bg-white text-[var(--pt-accent)]'}`}>
                        {full ? '満室' : `残り${room.remainingRooms}室`}
                      </span>
                    {/if}
                  </header>
                  <ul class="divide-y divide-stone-200">
                    {#each room.plans as plan (plan.planCode + plan.planName)}
                      {@const price = plan.price}
                      {#if price != null}
                        {@const anchor = planAnchor(plan.planCode, plan.planName)}
                        <li class="flex items-end justify-between gap-3 px-3.5 py-3">
                          <div class="min-w-0">
                            <p class="text-base font-medium leading-snug">{planLabel(plan.planCode, plan.planName)}</p>
                            {#if data.introPlans?.includes(anchor)}<a href={`/p/${token}/plans#${anchor}`} class="text-xs text-[var(--pt-accent)] underline">プランの紹介</a>{/if}
                            <p class="mt-1 flex flex-wrap gap-1">
                              {#if plan.mealType}<span class="rounded bg-stone-50 px-1.5 text-[11px] leading-5 text-stone-500">{plan.mealType === '2食' ? '夕朝食付き' : plan.mealType === '朝食' ? '朝食付き' : plan.mealType === '素泊' ? '素泊まり' : plan.mealType}</span>{/if}
                              {#if plan.advance}<span class="rounded bg-accent-500/10 px-1.5 text-[11px] font-medium leading-5 text-accent-600">先行案内</span>{/if}
                            </p>
                          </div>
                          <div class="shrink-0 text-right tabular-nums">
                            <p class="text-xl font-bold leading-none text-accent-600">{yen(price)}<span class="ml-0.5 text-xs font-normal text-stone-500">/名</span></p>
                            <p class="mt-1 text-xs text-stone-500">{nights > 1 ? `1室 ${nights}泊 ${yen(plan.total * current.guests)}` : `1室 ${yen(price * current.guests)}`}</p>
                            {#if bookable(selectedDay.date) && !full}
                              <a
                                href={bookHref(room.roomCode, plan, selectedDay.date)}
                                class="mt-2 inline-block rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-accent-500"
                              >予約する</a>
                            {/if}
                          </div>
                        </li>
                      {/if}
                    {/each}
                  </ul>
                </article>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <div class="hidden px-6 py-10 text-center lg:block">
          <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-500/10 text-accent-600">
            <svg viewBox="0 0 24 24" class="h-6 w-6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M3.5 9.5h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
          </div>
          <p class="text-lg font-bold">ご宿泊日をお選びください</p>
          <p class="mt-2 text-sm leading-5 text-stone-500">カレンダーの日付を押すと、<br />お部屋・プランごとの料金をご覧いただけます。</p>
        </div>
      {/if}
    </aside>
  </div>
  {#if selectedDay}
    <button type="button" aria-label="閉じる" class="fixed inset-0 z-30 bg-black/30 lg:hidden" onclick={() => (selected = null)}></button>
  {/if}
</main>
<PartnerRoomModal bind:room={infoRoom} token={token ?? ''} />

<style>
  .nav-btn {
    display: inline-flex;
    height: 2.25rem;
    width: 2.25rem;
    align-items: center;
    justify-content: center;
    border-radius: 9999px;
    border: 1px solid var(--color-stone-300, #d6d3d1);
    color: var(--color-brand-900, #1f1d15);
    transition: background-color 0.15s, border-color 0.15s;
  }
  .nav-btn:hover:not(:disabled) {
    border-color: var(--color-brand-900, #1f1d15);
    background: var(--color-stone-50, #fafaf9);
  }
  .nav-btn:disabled {
    opacity: 0.3;
  }
  .chip {
    flex-shrink: 0;
    border-radius: 9999px;
    border: 1px solid var(--color-stone-200, #e7e5e4);
    padding: 0.3rem 0.8rem;
    font-size: 0.75rem;
    color: var(--color-stone-500, #78716c);
    white-space: nowrap;
    transition: all 0.15s;
  }
  .chip:hover {
    border-color: var(--color-stone-300, #d6d3d1);
    color: var(--color-brand-900, #1f1d15);
  }
  .chip-on {
    border-color: var(--pt-accent);
    background: var(--pt-accent);
    color: #fff;
  }
  .chip-on:hover {
    color: #fff;
  }
  .cell {
    transition: background-color 0.15s, box-shadow 0.15s;
  }
  .cell-selected {
    box-shadow: inset 0 0 0 2px var(--color-accent-500, #b08d3e);
    background: color-mix(in srgb, var(--color-accent-500, #b08d3e) 10%, white) !important;
  }
  .closed {
    background-image: repeating-linear-gradient(135deg, transparent 0 6px, rgba(31, 29, 21, 0.035) 6px 12px);
  }
  .spinner {
    height: 0.9rem;
    width: 0.9rem;
    border-radius: 9999px;
    border: 2px solid var(--color-stone-300, #d6d3d1);
    border-top-color: var(--color-accent-500, #b08d3e);
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  /* 詳細: PC は右カラムに固定表示、スマホは下からのシート。 */
  .detail {
    border-radius: 0.75rem;
    border: 1px solid var(--color-stone-200, #e7e5e4);
    background: var(--color-white, #fff);
  }
  @media (min-width: 1024px) {
    .detail {
      position: sticky;
      top: 1rem;
    }
  }
  @media (max-width: 1023.98px) {
    .detail {
      position: fixed;
      inset: auto 0 0 0;
      z-index: 40;
      border-radius: 1.25rem 1.25rem 0 0;
      box-shadow: 0 -8px 30px rgba(31, 29, 21, 0.18);
      transform: translateY(105%);
      transition: transform 0.25s ease;
    }
    .detail-open {
      transform: translateY(0);
    }
  }
</style>
