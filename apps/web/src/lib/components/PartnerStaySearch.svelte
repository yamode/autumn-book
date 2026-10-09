<script lang="ts">
  // 取引先専用ページ: 料金カレンダー（view="room"・部屋タイプごとのカード）と
  // プランのご紹介（view="plan"・プランごとのカード）で共通の、検索バー＋一休型の一覧。
  // 日付を選ぶ前から全カードを出し、料金は今後3か月の最安〜。日程を選ぶと、その日程・人数・室数で
  // 予約できるプランと料金に切り替える。料金・空室は月の JSON（fetchPortalMonth）から画面側で組み立て、
  // 予約の金額・在庫は予約入力・確定時にサーバで改めて確かめる。
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { navigating } from '$app/state';
  import { page } from '$app/stores';
  import PartnerRoomCalendarModal from '$lib/components/PartnerRoomCalendarModal.svelte';
  import PartnerRoomModal from '$lib/components/PartnerRoomModal.svelte';
  import PartnerPlanDetailModal, { type PlanDetail } from '$lib/components/PartnerPlanDetailModal.svelte';
  import PartnerSearchBar from '$lib/components/PartnerSearchBar.svelte';
  import { canBookFor, partnerPlanName } from '$lib/partner-booking';
  import { roomParts, type PartnerPlanContent, type PartnerRoomContent } from '$lib/partner-contents';
  import { fetchPortalMonth } from '$lib/partner-month-client';
  import type { PartnerRateDay } from '$lib/partner-pricing';
  import { addDaysIsoClient, partnerReferencePlans, partnerStayOffers, type PartnerStayOffer } from '$lib/partner-stay';
  import type { StayPageData, StayPageExtras } from '$lib/server/partners/stay-page';
  import { planSummary } from '$lib/plan-summary';
  import { streamed } from '$lib/streamed.svelte';
  import { CREDIT_UNIT_NOTE, creditMonthShort } from '$lib/partner-credit';

  // below: 検索バーの下・一覧の上に差し込む中身（プランのご紹介の「専用特典」）
  let { data, view, below }: { data: StayPageData; view: 'room' | 'plan'; below?: Snippet } = $props();
  const token = $derived($page.params.token ?? '');
  // 後から届く一覧の中身（写真・紹介・キャンセル規定・受付枠・IN/OUT。stay-page.ts の stay・2026-10-10）。
  // 届くまではカードの枠（読み込み中の形）を出す。検索し直し（同じページの読み直し）の間は前の中身を残し、届いたら入れ替える
  const stay = streamed(() => data.stay);
  const extras = $derived(stay.current);
  const NO_EXTRAS: StayPageExtras = { times: null, credit: null, rooms: [], planAnchors: [], planContents: [], planTerms: {}, planPerks: {} };
  const ex = $derived(extras ?? NO_EXTRAS);
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
    void goto(`${$page.url.pathname}?${q}`, { noScroll: true, keepFocus: true });
  }

  // ---- 料金の読み込み（日程あり: チェックインから泊数ぶん／日程なし: 今後3か月） ----
  const dated = $derived(!!data.params.date);
  // 表示中の一覧のもと（読み込みが終わった条件と日別データ）。読み込み中は前の一覧を薄くして残し、
  // 揃ってから一度に入れ替える（読み込み中の枠に置き換えるとページが縮み、スクロール位置が飛ぶため）
  type Shown = { params: { date: string; nights: number; guests: number; rooms: number }; index: Map<string, PartnerRateDay> };
  let shown = $state<Shown | null>(null);
  let loading = $state(true);
  let loadError = $state('');
  $effect(() => {
    const { date: d, nights: n, guests: g, rooms: rc } = data.params;
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
        shown = { params: { date: d, nights: n, guests: g, rooms: rc }, index: new Map(ms.flatMap((m) => (m ? m.days.map((day) => [day.date, day] as const) : []))) };
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
  const closedDay = $derived(!!shown?.params.date && shown.index.get(shown.params.date)?.closed === true);

  // ---- プランの行（日程の有無で中身が変わる） ----
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
    if (!shown) return [];
    const { params: p, index } = shown;
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
  const byPrice = (a: number | null, b: number | null) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : sort === 'asc' ? a - b : b - a);
  const roomOf = (code: string) => ex.rooms.find((r) => r.code === code) ?? null;

  // 部屋タイプごとのカード（料金カレンダー）
  type Card = { code: string; name: string; content: PartnerRoomContent | null; rows: Row[] };
  const cards = $derived.by((): Card[] => {
    const byRoom = new Map<string, Row[]>();
    for (const r of rows) byRoom.set(r.roomCode, [...(byRoom.get(r.roomCode) ?? []), r]);
    const list: Card[] = [];
    for (const r of ex.rooms) {
      if (r.capacityMax && r.capacityMax < data.params.guests) continue;
      list.push({ code: r.code, name: r.name, content: r, rows: byRoom.get(r.code) ?? [] });
      byRoom.delete(r.code);
    }
    // 紹介が無い部屋も、料金があれば出す
    for (const [code, rs] of byRoom) list.push({ code, name: rs[0].roomName, content: null, rows: rs });
    for (const c of list) c.rows.sort((a, b) => byPrice(a.perPerson, b.perPerson));
    return list.sort((a, b) => Number(b.rows.length > 0) - Number(a.rows.length > 0) || byPrice(a.rows[0]?.perPerson ?? null, b.rows[0]?.perPerson ?? null));
  });

  // プランごとのカード（プランのご紹介）。キーは planCode■planName（料金の planName ＝紹介の planLabel）
  type PlanCard = { key: string; anchor: string; planCode: string; planName: string; mealType: string | null; content: PartnerPlanContent | null; rows: Row[] };
  const planKey = (code: string, name: string) => `${code}■${name}`;
  const planCards = $derived.by((): PlanCard[] => {
    const byPlan = new Map<string, Row[]>();
    for (const r of rows) byPlan.set(planKey(r.planCode, r.planName), [...(byPlan.get(planKey(r.planCode, r.planName)) ?? []), r]);
    const list: PlanCard[] = [];
    for (const p of ex.planContents) {
      const key = planKey(p.planCode, p.planLabel);
      const rs = byPlan.get(key) ?? [];
      list.push({ key, anchor: p.anchor, planCode: p.planCode, planName: p.planLabel, mealType: rs[0]?.mealType ?? p.mealPlan ?? null, content: p, rows: rs });
      byPlan.delete(key);
    }
    // 紹介が無いプランも、料金があれば出す
    for (const [key, rs] of byPlan) list.push({ key, anchor: `plan-${rs[0].planCode}`, planCode: rs[0].planCode, planName: rs[0].planName, mealType: rs[0].mealType, content: null, rows: rs });
    for (const c of list) c.rows.sort((a, b) => byPrice(a.perPerson, b.perPerson));
    return list.sort((a, b) => Number(b.rows.length > 0) - Number(a.rows.length > 0) || byPrice(a.rows[0]?.perPerson ?? null, b.rows[0]?.perPerson ?? null));
  });
  const bookableCount = $derived(view === 'room' ? cards.filter((c) => c.rows.length).length : planCards.filter((c) => c.rows.length).length);

  let infoRoom = $state<PartnerRoomContent | null>(null);
  let calendarRoom = $state<{ code: string; name: string } | null>(null);
  // 空室カレンダーを開いたカード（日付を選んだあと、そのカードへスクロールする）
  let calendarFrom = '';
  function openCalendar(code: string, name: string, cardId: string) {
    calendarFrom = cardId;
    calendarRoom = { code, name };
  }
  const planAnchorOf = (r: Row) => ex.planAnchors.find((p) => p.planCode === r.planCode && p.planLabel === r.planName)?.anchor ?? null;
  const hasPerk = (code: string) => data.commonPerk || data.perkPlanCodes.includes(code);
  type Params = StayPageData['params'];
  const canBookOn = (iso: string) => !!iso && data.booking.enabled && canBookFor(iso, data.booking);
  const canBook = $derived(canBookOn(data.params.date));
  const listHref = (p: Params) => {
    const q = new URLSearchParams({ nights: String(p.nights), guests: String(p.guests), rooms: String(p.rooms) });
    if (p.date) q.set('date', p.date);
    return `${$page.url.pathname}?${q}`;
  };
  const bookHref = (r: Row, p: Params) => {
    const q = new URLSearchParams({
      room: r.roomCode,
      plan: r.planCode,
      name: r.planName,
      date: p.date,
      guests: String(p.guests),
      nights: String(p.nights),
      rooms: String(p.rooms),
      from: listHref(p)
    });
    // 2施設以上の取引先は、見ている施設を ?f= で予約入力へ渡す（別のタブで施設を切り替えても、この料金の施設で予約入力を開く・2026-10-09）
    if (data.portal.facilityChoices.length >= 2 && data.portal.facilitySlug) q.set('f', data.portal.facilitySlug);
    return `/p/${token}/book?${q}`;
  };
  // 「詳細・予約」: プラン詳細のモーダル（一休型）。予約へは中の「予約へ進む」から。
  // 日程を選ぶ前は日付未定のまま開き、中の「日付を選択して予約」で日付を選んだら、その日の料金で詳細を表示し直す
  // （pickDateForDetail。料金と内容を確かめてから「予約へ進む」）
  let detail = $state<PlanDetail | null>(null);
  // svelte-ignore state_referenced_locally
  let detailParams = $state<Params>(data.params);
  let detailRow: Row | null = null;
  // 日付未定に戻したとき、一覧（今後3か月の最安）を読み直したら、その行で詳細を表示し直す
  let undatedTarget = $state<{ roomCode: string; planCode: string; planName: string } | null>(null);
  function openDetail(r: Row, content: PartnerRoomContent | null, p: Params = data.params) {
    detailParams = p;
    detailRow = r;
    detail = {
      roomCode: r.roomCode,
      planCode: r.planCode,
      planLabel: r.planName,
      planName: partnerPlanName(data.planNames, r.planCode, r.planName),
      mealType: r.mealType,
      roomName: r.roomName,
      room: content,
      plan: ex.planContents.find((c) => c.planCode === r.planCode && c.planLabel === r.planName) ?? null,
      terms: ex.planTerms[`${r.planCode}■${r.planName}`] ?? null,
      perks: ex.planPerks[r.planCode] ?? data.commonPerks,
      officialPerks: ex.planContents.find((c) => c.planCode === r.planCode && c.planLabel === r.planName)?.officialPerks ?? [],
      total: r.total ?? r.perPerson * p.guests * p.nights * p.rooms,
      perRoomNight: r.perPerson * p.guests,
      remaining: r.remaining,
      bookHref: bookHref(r, p)
    };
  }
  function pickDateForDetail(iso: string, n: number, offer: PartnerStayOffer) {
    const p = { ...detailParams, date: iso, nights: n };
    openDetail({ ...offer, total: offer.totalPerPerson * p.guests * p.rooms }, roomOf(offer.roomCode), p);
    // 後ろの一覧・検索バーもその日程にそろえる（詳細を閉じたとき、その日の一覧になっているように）
    date = iso;
    nights = n;
    search();
  }

  function undateDetail(n: number) {
    if (!detailRow) return;
    const r = detailRow;
    // 先に日付未定の形で開き直し（料金は読み直すまで今の行の値で「〜」）、一覧を日付なしで検索し直す
    openDetail({ ...r, total: null }, roomOf(r.roomCode), { ...detailParams, date: '', nights: n });
    undatedTarget = { roomCode: r.roomCode, planCode: r.planCode, planName: r.planName };
    date = '';
    nights = n;
    search();
  }
  $effect(() => {
    const t = undatedTarget;
    if (!t || searching || loading || !shown || shown.params.date !== '') return;
    undatedTarget = null;
    const r = rows.find((x) => x.roomCode === t.roomCode && x.planCode === t.planCode && x.planName === t.planName);
    // 詳細が開いたままなら、今後3か月の最安で表示し直す（スクロール位置も先頭に戻る）
    if (r && detail) openDetail(r, roomOf(r.roomCode), detailParams);
  });
  // モーダルの人数を押したら、閉じて検索バーのパネルを開く
  function reopenSearch(panel: 'date' | 'guests') {
    detail = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    openPanel = panel;
  }

  // 検索中（ページのデータを取り直している間）は一覧を薄くする。本番では1〜2秒かかり、古い一覧のままに見えるため
  const searching = $derived(!!navigating.to && navigating.to.url.pathname === $page.url.pathname);
  // 料金を読み込み中（初回・検索し直し）。カードはすぐ出し、プランの行だけ読み込み中の形にする
  const pending = $derived(loading || searching);
  // 空室カレンダーで日付を選んだら、その日程で検索し直し、読み込みが終わってからそのカードへ。
  // 「お部屋」ページの部屋カレンダーから来たとき（?room=）も、読み込み後にその部屋のカードへ
  // svelte-ignore state_referenced_locally
  const fromRoom = $page.url.searchParams.get('room');
  // svelte-ignore state_referenced_locally
  let scrollTo = $state<{ id: string; date: string } | null>(fromRoom && data.params.date ? { id: `room-${fromRoom}`, date: data.params.date } : null);
  function pickFromCalendar(iso: string) {
    const id = calendarFrom;
    calendarRoom = null;
    date = iso;
    if (id) scrollTo = { id, date: iso };
    search();
  }
  $effect(() => {
    if (!scrollTo || searching || loading || !extras || shown?.params.date !== scrollTo.date) return;
    const id = scrollTo.id;
    scrollTo = null;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  });
  // ページ内の位置（/plans#plan-… など）: カードは中身が届いてから出るので、最初に届いたときにその位置へ移る
  let hashScrolled = false;
  $effect(() => {
    if (!extras || hashScrolled) return;
    hashScrolled = true;
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }));
  });
  const checkout = $derived(dated ? addDaysIsoClient(data.params.date, data.params.nights) : '');
  const guestText = $derived(`大人${data.params.guests}名${data.params.rooms > 1 ? ` × ${data.params.rooms}室` : ''}`);
  const capacityText = (r: PartnerRoomContent) => (r.capacityMin === r.capacityMax ? `${r.capacityMax}名` : `${r.capacityMin}名〜${r.capacityMax}名`);
</script>

<!-- 読み込み中のプレースホルダー（プランの行の形・光が流れるシマー） -->
{#snippet rowShimmer(count: number, thumb: boolean)}
  <div class="divide-y divide-stone-200" aria-hidden="true">
    {#each Array.from({ length: count }, (_, i) => i) as i (i)}
      <div class={`grid gap-4 px-5 py-6 sm:gap-8 ${thumb ? 'sm:grid-cols-[6rem_minmax(0,1fr)_11rem]' : 'sm:grid-cols-[minmax(0,1fr)_11rem]'}`}>
        {#if thumb}<div class="shimmer hidden h-[4.5rem] w-24 sm:block"></div>{/if}
        <div class="space-y-3">
          <div class="shimmer h-4 w-11/12"></div>
          <div class="shimmer h-4 w-2/3"></div>
          <div class="shimmer mt-4 h-3.5 w-40 opacity-70"></div>
        </div>
        <div class="flex flex-col items-end gap-2.5">
          <div class="shimmer h-3 w-20 opacity-70"></div>
          <div class="shimmer h-7 w-36"></div>
          <div class="shimmer h-10 w-28"></div>
        </div>
      </div>
    {/each}
  </div>
{/snippet}

<!-- 行の右側（料金と「詳細・予約」／「空室を見る」）。部屋カード・プランカードで共通 -->
{#snippet priceCell(r: Row, content: PartnerRoomContent | null, cardId: string)}
  <div class="flex flex-col items-end justify-between gap-2 text-right">
    {#if hasPerk(r.planCode)}<p class="text-xs font-bold text-amber-700">専用特典つき</p>{/if}
    <p class="flex flex-wrap items-baseline justify-end gap-x-1.5 text-sm text-brand-900">
      {#if r.mealType}<span class="rounded-sm border border-amber-600 px-1 text-[11px] leading-4 text-amber-700">{mealLabel(r.mealType)}</span>{/if}
      <span>{data.params.guests}名 税込</span>
      <span class="text-2xl font-bold tabular-nums">{num(r.perPerson * data.params.guests)}</span><span class="font-bold">円〜</span>
    </p>
    <!-- 1名料金を併記する（2026-10-09 指示。日付ピッカーは1名1泊で出しているため）。1名のときは1室料金と同じなので出さない -->
    {#if data.params.guests > 1}
      <p class="text-sm font-semibold text-brand-900">1名1泊{dated && data.params.nights > 1 ? '（平均）' : ''} <span class="tabular-nums">{num(r.perPerson)}</span>円〜</p>
    {/if}
    <p class="text-xs text-stone-500">
      {#if dated}
        1室1泊{data.params.nights > 1 ? '（平均）' : ''}{#if r.total != null && (data.params.nights > 1 || data.params.rooms > 1)}・{data.params.rooms > 1 ? `${data.params.rooms}室` : ''}{data.params.nights}泊 合計 {num(r.total)}円{/if}
      {:else}
        1室1泊・今後3か月の最安
      {/if}
    </p>
    {#if dated && canBook}
      <button type="button" onclick={() => openDetail(r, content)} class="mt-1 rounded-md bg-green-600 px-5 py-2.5 text-base font-bold text-white hover:bg-green-700">詳細・予約</button>
    {:else if !dated}
      <button type="button" onclick={() => openDetail(r, content)} class="mt-1 rounded-md bg-green-600 px-5 py-2.5 text-base font-bold text-white hover:bg-green-700">詳細・予約</button>
    {/if}
  </div>
{/snippet}

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
  {#if below}{@render below()}{/if}

  <div class="mt-6 flex flex-wrap items-end justify-between gap-3">
    <div>
      {#if dated}
        <p class="text-lg font-bold">{fmt(data.params.date)} 〜 {fmt(checkout)}・{data.params.nights}泊・{guestText}</p>
        {#if !pending && !loadError && !closedDay}<p class="text-sm text-stone-500">予約できる{view === 'room' ? 'お部屋' : 'プラン'} {bookableCount}件</p>{/if}
      {:else}
        <p class="text-lg font-bold">{view === 'room' ? 'すべてのお部屋とプラン' : 'すべてのプラン'}</p>
        <p class="text-sm text-stone-500">料金は{guestText}でご利用時の、今後3か月の最安です。ご宿泊日を選ぶと、その日の料金と空室に切り替わります。</p>
      {/if}
      {#if ex.credit?.months.length}
        <!-- 御社の受付枠（与信 ON の旅行会社だけ・月別の延べ室数）。表示中の日程の月（日程なしは今月） -->
        <p class="mt-1 text-sm text-stone-600">
          {#each ex.credit.months as m, i (m.month)}{#if i > 0}<span class="text-stone-400">／</span>{/if}<span class={m.limit - m.booked <= 0 ? 'font-medium text-amber-800' : ''}>{creditMonthShort(m)}</span>{/each}
          <span class="block text-xs text-stone-500">{CREDIT_UNIT_NOTE}</span>
        </p>
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

  {#if pending}
    <p class="mt-4 text-base text-stone-600" role="status">料金と空室を読み込んでいます…</p>
  {/if}
  {#if loadError && !pending}
    <p class="mt-5 rounded-xl border border-rose-700/30 bg-rose-700/5 p-4 text-rose-700">{loadError}</p>
  {:else if closedDay && !pending}
    <p class="mt-5 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">この日は休館日です。別の日程をお選びください。</p>
  {:else if !extras}
    <!-- 写真・紹介がまだ届いていない間は、カードの枠だけ出す（メニューから移ってきた直後） -->
    <div class="mt-4 space-y-6" aria-busy="true">
      {#each [0, 1, 2] as i (i)}
        <div class={`overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] ${view === 'room' ? 'md:grid md:grid-cols-[280px_minmax(0,1fr)]' : ''}`}>
          {#if view === 'room'}
            <div class="border-b border-stone-200 md:border-b-0 md:border-r">
              <div class="shimmer aspect-[16/10] w-full rounded-none"></div>
              <div class="space-y-3 px-5 py-4"><div class="shimmer h-4 w-2/3"></div><div class="shimmer h-3.5 w-1/2 opacity-70"></div></div>
            </div>
            <div class="min-w-0">{@render rowShimmer(2, false)}</div>
          {:else}
            <div class="gap-6 px-5 py-5 sm:px-6 md:grid md:grid-cols-[280px_minmax(0,1fr)]">
              <div class="shimmer mb-4 aspect-[16/10] w-full md:mb-0"></div>
              <div class="space-y-3"><div class="shimmer h-5 w-3/4"></div><div class="shimmer h-4 w-full opacity-70"></div><div class="shimmer h-4 w-5/6 opacity-70"></div></div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {:else if view === 'room'}
    <div class="mt-4 space-y-6" aria-busy={pending}>
      {#each cards as card (card.code)}
        {@const parts = roomParts(card.name)}
        {@const photo = card.content?.photos[0]?.url}
        <!-- 一休のカード: 左に写真と部屋、右にプラン行 -->
        <article id={`room-${card.code}`} class="overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)] md:grid md:grid-cols-[280px_minmax(0,1fr)]">
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
                  <span class="font-bold">定員</span> {capacityText(card.content)}
                  {#if card.content.amenities.length}<span class="text-stone-400">｜</span>{card.content.amenities.slice(0, 3).join('・')}{/if}
                </p>
              {/if}
              <button type="button" onclick={() => openCalendar(card.code, card.name, `room-${card.code}`)} class="mt-4 rounded-md border border-stone-300 px-4 py-2 text-sm font-bold text-brand-900 hover:border-brand-900">空室カレンダー</button>
            </div>
          </div>
          <div class="min-w-0">
            {#if pending}
              {@render rowShimmer(2, false)}
            {:else if card.rows.length}
              <div class="divide-y divide-stone-200">
                {#each card.rows.slice(0, expanded[card.code] ? card.rows.length : 2) as r (r.planCode + r.planName)}
                  {@const anchor = planAnchorOf(r)}
                  <div class="grid gap-3 px-5 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-8">
                    <div class="min-w-0">
                      <p class="text-[15px] leading-7 text-brand-900">{partnerPlanName(data.planNames, r.planCode, r.planName)}</p>
                      <p class="mt-3 text-sm text-brand-900">
                        {#if ex.times}<span class="font-bold">IN</span> {ex.times.checkin}<span class="ml-3 font-bold">OUT</span> {ex.times.checkout}{/if}
                        {#if dated && data.showInventory && r.remaining != null && r.remaining <= 2}<span class="ml-3 font-bold text-rose-600">残りあと{r.remaining}室</span>{/if}
                      </p>
                      <p class="mt-1.5 flex flex-wrap gap-x-3 text-sm">
                        {#if anchor}<a href={`/p/${token}/plans#${anchor}`} class="text-sky-700 hover:underline">プランの紹介</a>{/if}
                        {#if r.advance}<span class="font-medium text-accent-600">先行案内</span>{/if}
                      </p>
                    </div>
                    {@render priceCell(r, card.content, `room-${card.code}`)}
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
  {:else}
    <div class="mt-4 space-y-6" aria-busy={pending}>
      {#each planCards as card (card.key)}
        {@const photo = card.content?.photos[0]?.url}
        {@const name = partnerPlanName(data.planNames, card.planCode, card.planName)}
        {@const intro = planSummary(card.content?.description ?? '')}
        <!-- 一休のプランカード: 上にプラン（写真・名前・短い紹介・IN/OUT）、下に選べるお部屋の行 -->
        <article id={card.anchor} class="scroll-mt-24 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.08)]">
          <header class={`gap-6 px-5 pb-5 pt-5 sm:px-6 ${photo ? 'md:grid md:grid-cols-[280px_minmax(0,1fr)]' : ''}`}>
            {#if photo}
              <img src={photo} alt={name} class="mb-4 aspect-[16/10] w-full rounded-md object-cover md:mb-0" loading="lazy" />
            {/if}
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-1.5">
                {#if card.mealType}<span class="rounded-sm border border-amber-600 px-1.5 text-xs leading-5 text-amber-700">{mealLabel(card.mealType)}</span>{/if}
                {#if hasPerk(card.planCode)}<span class="rounded-full bg-[var(--pt-accent)] px-2.5 py-0.5 text-xs font-bold text-white">専用特典</span>{/if}
              </div>
              <h3 class="mt-2 text-lg font-bold leading-snug text-brand-900 sm:text-xl">{name}</h3>
              {#if card.content?.headline && card.content.headline !== name}<p class="mt-1 text-sm font-medium text-stone-600">{card.content.headline}</p>{/if}
              {#if intro}
                <!-- 一覧用の要約（紹介文の more 区切りまで／無ければ最初の3行）。全文は「詳細・予約」のプラン詳細で -->
                <p class="mt-2 line-clamp-4 whitespace-pre-line text-sm leading-7 text-stone-700">{intro}</p>
              {/if}
              {#if ex.times}<p class="mt-3 text-sm text-brand-900"><span class="font-bold">IN</span> {ex.times.checkin}<span class="ml-3 font-bold">OUT</span> {ex.times.checkout}</p>{/if}
            </div>
          </header>
          <div class="mx-5 mb-5 overflow-hidden rounded-md border border-stone-200 sm:mx-6">
            {#if pending}
              {@render rowShimmer(2, true)}
            {:else if card.rows.length}
              <div class="divide-y divide-stone-200">
                {#each card.rows.slice(0, expanded[card.key] ? card.rows.length : 3) as r (r.roomCode)}
                  {@const room = roomOf(r.roomCode)}
                  {@const parts = roomParts(r.roomName)}
                  {@const thumb = room?.photos[0]?.url}
                  <div class="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4 gap-y-3 px-4 py-4 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:gap-x-6">
                    {#if thumb}
                      <button type="button" onclick={() => (infoRoom = room)} class="block self-start" aria-label={`${parts.room} お部屋の紹介`}>
                        <img src={thumb} alt={parts.room} class="aspect-[4/3] w-full rounded object-cover" loading="lazy" />
                      </button>
                    {:else}
                      <div class="aspect-[4/3] w-full rounded bg-stone-100"></div>
                    {/if}
                    <div class="min-w-0">
                      {#if room}
                        <button type="button" onclick={() => (infoRoom = room)} class="text-left text-[15px] font-medium leading-snug text-sky-700 hover:underline">{#if parts.building}{parts.building}｜{/if}{parts.room}</button>
                      {:else}
                        <p class="text-[15px] font-medium leading-snug text-sky-700">{#if parts.building}{parts.building}｜{/if}{parts.room}</p>
                      {/if}
                      {#if room}
                        <p class="mt-1.5 text-sm text-stone-600">
                          <span class="font-bold">定員</span> {capacityText(room)}
                          {#if room.amenities.length}<span class="text-stone-400">｜</span>{room.amenities.slice(0, 3).join('・')}{/if}
                        </p>
                      {/if}
                      {#if dated && data.showInventory && r.remaining != null && r.remaining <= 2}<p class="mt-1 text-sm font-bold text-rose-600">残りあと{r.remaining}室</p>{/if}
                      {#if r.advance}<p class="mt-1 text-sm font-medium text-accent-600">先行案内</p>{/if}
                    </div>
                    <div class="col-span-2 sm:col-span-1">{@render priceCell(r, room, card.anchor)}</div>
                  </div>
                {/each}
              </div>
              {#if card.rows.length > 3}
                <div class="border-t border-stone-200 px-4 py-3 text-right">
                  <button type="button" aria-expanded={!!expanded[card.key]} onclick={() => (expanded[card.key] = !expanded[card.key])} class="w-full rounded-md border border-stone-300 px-6 py-2.5 text-sm font-bold text-sky-700 hover:border-sky-700 sm:w-auto sm:min-w-72">
                    {expanded[card.key] ? '閉じる' : `部屋をすべてみる（${card.rows.length}件）`} <span aria-hidden="true" class={`ml-1 inline-block transition ${expanded[card.key] ? 'rotate-180' : ''}`}>⌄</span>
                  </button>
                </div>
              {/if}
            {:else}
              <p class="px-4 py-5 text-base text-stone-500">{dated ? 'この日程・人数・室数でご案内できるお部屋はありません。' : 'ご案内できるお部屋はありません。'}</p>
            {/if}
          </div>
        </article>
      {:else}
        <p class="rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">ご案内できるプランはありません。</p>
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
<PartnerPlanDetailModal
  bind:detail
  params={detailParams}
  times={ex.times}
  deadlineText={data.deadlineText}
  cancelText={data.cancelText}
  paymentLabels={data.paymentLabels}
  showInventory={data.showInventory}
  canBook={canBookOn(detailParams.date)}
  {token}
  today={data.today}
  maxNights={data.booking.maxNights}
  isBookable={canBookOn}
  onPickDate={pickDateForDetail}
  onUndated={undateDetail}
  onChangeGuests={() => reopenSearch('guests')}
/>
<PartnerRoomModal bind:room={infoRoom} {token} />
