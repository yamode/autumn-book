<script lang="ts">
  // 取引先専用ページ・料金カレンダー: 部屋カードの「空室カレンダー」から開く、その部屋だけの月カレンダー。
  // マスはその部屋で泊数ぶん泊まれるプランの最安（1名1泊）。日を押すと、その日程で一覧を検索し直す。
  import { isHoliday } from '$lib/holidays';
  import { roomParts } from '$lib/partner-contents';
  import { partnerStayOffers, type PartnerStayOffer } from '$lib/partner-stay';
  import { fetchPortalMonth, type PortalMonthJson } from '$lib/partner-month-client';

  let {
    room = $bindable(null),
    token,
    guests,
    nights,
    rooms,
    showInventory,
    today,
    selected,
    plan = null,
    onPick
  }: {
    /** 開いている部屋（null で閉じる） */
    room: { code: string; name: string } | null;
    token: string;
    guests: number;
    nights: number;
    rooms: number;
    showInventory: boolean;
    today: string;
    selected: string;
    /** プランを絞る（プランのカードの「詳細・予約」から開いたとき）。null なら部屋の全プランの最安 */
    plan?: { code: string; name: string; label: string } | null;
    /** offer: その日のいちばん安いプラン（そのまま詳細を開けるように渡す） */
    onPick: (date: string, offer: PartnerStayOffer | null) => void;
  } = $props();

  const pad = (n: number) => String(n).padStart(2, '0');
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const shiftYm = (ym: string, d: number) => {
    const [y, m] = ym.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
  };
  let ym = $state('');
  let months = $state<PortalMonthJson[]>([]);
  let loading = $state(false);
  let dialog = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!room) return;
    ym = (selected || today).slice(0, 7);
    dialog?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });
  // 表示月＋連泊の判定用に翌月
  $effect(() => {
    if (!room || !ym) return;
    const g = guests;
    let cancelled = false;
    loading = true;
    Promise.all([fetchPortalMonth(token, ym, g), fetchPortalMonth(token, shiftYm(ym, 1), g).catch(() => null)])
      .then((ms) => {
        if (!cancelled) months = ms.filter((m): m is PortalMonthJson => !!m);
      })
      .catch(() => {
        if (!cancelled) months = [];
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
  const cells = $derived.by(() => {
    if (!ym || !room) return [];
    const [year, month] = ym.split('-').map(Number);
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const out: ({ iso: string; dow: number; min: number | null; rest: number | null; closed: boolean; full: boolean; inRange: boolean; offer: PartnerStayOffer | null } | null)[] = Array(first).fill(null);
    for (let d = 1; d <= last; d += 1) {
      const iso = `${ym}-${pad(d)}`;
      const inRange = !!bounds && iso >= bounds.earliest && iso <= bounds.latest;
      const offers = inRange ? partnerStayOffers((x) => index.get(x), iso, nights, guests, { showInventory, roomCode: room.code, rooms, planCode: plan?.code, planName: plan?.name }) : null;
      out.push({
        iso,
        dow: (first + d - 1) % 7,
        min: offers?.length ? offers[0].perPerson : null,
        rest: offers?.length ? (offers[0].remaining ?? null) : null,
        closed: index.get(iso)?.closed === true,
        full: index.get(iso)?.rooms.find((r) => r.roomCode === room!.code)?.remainingRooms === 0,
        inRange,
        offer: offers?.[0] ?? null
      });
    }
    while (out.length % 7) out.push(null);
    return out;
  });
  const monthMin = $derived(Math.min(...cells.map((c) => c?.min ?? Infinity)));
  const parts = $derived(room ? roomParts(room.name) : { building: '', room: '' });
  const [y, m] = $derived(ym ? ym.split('-').map(Number) : [0, 0]);
</script>

<svelte:window onkeydown={(e) => { if (room && e.key === 'Escape') room = null; }} />

{#if room}
  <div class="fixed inset-0 z-[90] flex items-end justify-center sm:items-center" role="presentation">
    <button type="button" class="absolute inset-0 bg-stone-950/55" aria-label="閉じる" onclick={() => (room = null)}></button>
    <div bind:this={dialog} tabindex="-1" role="dialog" aria-modal="true" aria-label={`${parts.room} 空室カレンダー`} class="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:w-[min(94vw,760px)] sm:rounded-2xl">
      <div class="flex shrink-0 items-start justify-between gap-3 border-b border-stone-200 px-4 py-3 sm:px-6">
        <div class="min-w-0">
          <p class="text-xs text-stone-500">空室カレンダー{parts.building ? `・${parts.building}` : ''}</p>
          <h2 class="truncate text-lg font-bold">{parts.room}</h2>
          {#if plan}<p class="truncate text-sm font-medium text-brand-900">{plan.label}</p>{/if}
          <p class="text-sm text-stone-500">大人{guests}名{rooms > 1 ? ` × ${rooms}室` : '・1室'}・{nights}泊の、お一人様1泊あたりの最安（税込・入湯税別）</p>
        </div>
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xl text-stone-600 hover:bg-stone-100" aria-label="閉じる" onclick={() => (room = null)}>×</button>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-5 pt-3 sm:px-6">
        <div class="mb-3 flex items-center justify-center gap-4">
          <button type="button" disabled={ym <= today.slice(0, 7)} onclick={() => (ym = shiftYm(ym, -1))} class="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 disabled:opacity-30" aria-label="前の月">‹</button>
          <span class="min-w-32 text-center text-xl font-bold">{y}年{m}月</span>
          <button type="button" disabled={!!bounds && shiftYm(ym, 1) > bounds.latest.slice(0, 7)} onclick={() => (ym = shiftYm(ym, 1))} class="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 disabled:opacity-30" aria-label="次の月">›</button>
        </div>
        <div class="overflow-hidden rounded-xl border border-stone-200">
          <div class="grid grid-cols-7 border-b border-stone-200 bg-stone-50 text-center text-sm">
            {#each WEEK as w, i}<div class={`py-2 font-medium ${i === 0 ? 'text-rose-700' : i === 6 ? 'text-sky-700' : 'text-stone-500'}`}>{w}</div>{/each}
          </div>
          <div class="grid grid-cols-7 gap-px bg-stone-200">
            {#each cells as c, i (c?.iso ?? `b-${i}`)}
              {#if !c}
                <div class="min-h-[4.5rem] bg-stone-50"></div>
              {:else}
                <!-- 取得中は今日以降の料金欄をシマーにする（日付パネルと同じ。前の月・人数の料金を押させない） -->
                {@const pending = loading && c.iso >= today}
                <button
                  type="button"
                  disabled={pending || c.min == null}
                  onclick={() => onPick(c.iso, c.offer)}
                  aria-pressed={c.iso === selected}
                  class={`flex min-h-[4.5rem] flex-col items-start bg-white p-1.5 text-left transition sm:min-h-20 sm:p-2 ${c.iso === selected ? 'ring-2 ring-inset ring-[var(--pt-accent)]' : ''} ${pending ? '' : c.min != null ? 'hover:bg-[var(--pt-accent-soft)]' : 'bg-stone-50/70 text-stone-400'}`}
                >
                  <span class={`text-sm font-semibold sm:text-base ${!pending && c.min == null ? '' : c.dow === 0 || isHoliday(c.iso) ? 'text-rose-700' : c.dow === 6 ? 'text-sky-700' : 'text-brand-900'}`}>{Number(c.iso.slice(8))}</span>
                  {#if pending}
                    <span class="shimmer mt-auto block h-3.5 w-4/5 max-w-16" aria-hidden="true"></span>
                  {:else if c.min != null}
                    {#if c.min === monthMin}<span class="rounded bg-accent-500 px-1 text-[10px] font-bold leading-4 text-white">最安</span>{/if}
                    <span class="mt-auto text-xs font-semibold tabular-nums text-brand-900 sm:text-sm">{c.min.toLocaleString('ja-JP')}<span class="text-[10px] font-normal">円〜</span></span>
                    {#if showInventory && c.rest != null && c.rest <= 2}<span class="text-[10px] font-medium text-amber-700 sm:text-xs">残り{c.rest}室</span>{/if}
                  {:else if c.inRange && c.closed}
                    <span class="mt-auto text-xs">休館日</span>
                  {:else if c.inRange && c.iso >= today}
                    <span class="mt-auto text-xs">{c.full ? '満室' : '—'}</span>
                  {/if}
                </button>
              {/if}
            {/each}
          </div>
        </div>
        <p class="mt-2 text-xs text-stone-500">{#if loading}<span role="status">料金を確認中…</span>{:else if plan}日付を押すと、その日程のプラン詳細を開きます。{:else}日付を押すと、その日程で一覧を表示します。{/if}</p>
      </div>
    </div>
  </div>
{/if}
