<script lang="ts">
  // 取引先専用ページ「お部屋とプラン」の検索バーから開く日付パネル（2か月横並び・スマホは1か月）。
  // 泊数を変えると、どこかの部屋・プランで全泊空いている日だけに料金（1名1泊の最安）を出す。
  // 日付を押しても閉じず、「この日程で検索」で確定する。
  // プラン詳細（日付未定）から開くときは filter で部屋・プランを絞り、日付を押したらその日の料金（offer）を onPick で返す
  // （プラン詳細をその日の料金で表示し直す）。
  // 見出しの「日付指定なし」で日付を外せる（検索バーでは日付なしで検索、プラン詳細では onUndated で日付未定に戻す）。
  import { isHoliday } from '$lib/holidays';
  import { partnerStayOffers, type PartnerStayOffer } from '$lib/partner-stay';
  import { fetchPortalMonth, type PortalMonthJson } from '$lib/partner-month-client';

  let {
    token,
    date = $bindable(''),
    nights = $bindable(1),
    guests,
    rooms = 1,
    maxNights,
    showInventory,
    today,
    filter = null,
    pickApplies = false,
    isBookable,
    onApply,
    onPick,
    onUndated,
    onClose
  }: {
    token: string;
    date: string;
    nights: number;
    guests: number;
    /** 室数（残室を見せる取引先は、残室が足りない日を除く） */
    rooms?: number;
    maxNights: number;
    showInventory: boolean;
    today: string;
    /** 部屋・プランを絞る（プラン詳細から開いたとき）。null ならすべての部屋・プランの最安 */
    filter?: { roomCode: string; planCode: string; planName: string } | null;
    /** 日付を押したらすぐ onPick する（「この日程で検索」ボタンを出さない） */
    pickApplies?: boolean;
    /** pickApplies のとき: 押した日・泊数・その日のいちばん安い料金 */
    onPick?: (date: string, nights: number, offer: PartnerStayOffer) => void;
    /** pickApplies のとき:「日付指定なし」に戻した */
    onUndated?: () => void;
    /** 予約を受け付ける日か（受付締切を過ぎた日は押せなくする）。省略時はすべて */
    isBookable?: (iso: string) => boolean;
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
    const out: ({ iso: string; dow: number; min: number | null; offer: PartnerStayOffer | null; closed: boolean; inRange: boolean } | null)[] = Array(first).fill(null);
    for (let d = 1; d <= last; d += 1) {
      const iso = `${ym}-${pad(d)}`;
      const inRange = !!bounds && iso >= bounds.earliest && iso <= bounds.latest;
      const offers =
        inRange && (!isBookable || isBookable(iso))
          ? partnerStayOffers((x) => index.get(x), iso, nights, guests, { showInventory, rooms, roomCode: filter?.roomCode, planCode: filter?.planCode, planName: filter?.planName })
          : null;
      out.push({ iso, dow: (first + d - 1) % 7, min: offers?.length ? offers[0].perPerson : null, offer: offers?.[0] ?? null, closed: index.get(iso)?.closed === true, inRange });
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

<div role="dialog" aria-label="ご宿泊日" class="rounded-3xl border border-stone-200 bg-white px-4 pb-4 pt-3 shadow-[0_8px_28px_rgba(0,0,0,0.14)] sm:px-6 sm:pt-4">
  <div class="flex flex-wrap items-center gap-3 border-b border-stone-100 pb-3">
    <span class="text-base text-stone-600">泊数</span>
    <button type="button" disabled={nights <= 1} onclick={() => (nights -= 1)} class="flex h-9 w-9 items-center justify-center rounded bg-[var(--pt-accent)] text-xl text-white disabled:opacity-30" aria-label="泊数を減らす"><svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg></button>
    <span class="min-w-10 text-center text-base font-medium tabular-nums">{nights}泊</span>
    <button type="button" disabled={nights >= maxNights} onclick={() => (nights += 1)} class="flex h-9 w-9 items-center justify-center rounded bg-[var(--pt-accent)] text-xl text-white disabled:opacity-30" aria-label="泊数を増やす"><svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button>
    <!-- 日付指定なし（泊数の右）: 日付を選んでいるときだけ押せる（押すと日付を外す）。日付が無いときはチェック済みで押せない -->
    <label class={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-base ${date ? 'cursor-pointer border-stone-300 hover:border-brand-900' : 'border-stone-200 text-stone-500'}`}>
      <input
        type="checkbox"
        class="h-4 w-4"
        checked={!date}
        disabled={!date}
        onchange={() => {
          date = '';
          if (pickApplies) onUndated?.();
        }}
      />
      日付指定なし
    </label>
    {#if loading}<span class="text-sm text-stone-500" role="status">空き状況を確認中…</span>{:else if failed}<span class="text-sm text-rose-700" role="status">料金を読み込めませんでした</span>{:else}<span class="text-sm text-stone-400">泊数を変えると空き日がすぐ変わります</span>{/if}
    <span class="ml-auto text-sm text-stone-500">大人{guests}名{rooms > 1 ? `×${rooms}室` : '・1室'}・1名あたりの最安</span>
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
              <!-- 取得中は今日以降の料金欄をシマーにする（前の月・人数の料金を押させない） -->
              {@const pending = loading && c.iso >= today}
              <button
                type="button"
                disabled={pending || c.min == null}
                aria-pressed={selected}
                onclick={() => {
                  date = c.iso;
                  if (pickApplies && c.offer) onPick?.(c.iso, nights, c.offer);
                }}
                class={`min-h-16 border-b border-stone-100 px-0.5 py-1.5 transition ${selected ? 'rounded bg-[var(--pt-accent)] text-white' : inStay ? 'bg-[var(--pt-accent-soft)]' : pending ? '' : c.min != null ? 'hover:bg-[var(--pt-accent-soft)]' : 'text-stone-300'}`}
              >
                <span class={`block text-base ${selected ? '' : !pending && c.min == null ? '' : c.dow === 0 || isHoliday(c.iso) ? 'text-rose-600' : c.dow === 6 ? 'text-sky-600' : 'text-stone-800'}`}>{Number(c.iso.slice(8))}</span>
                {#if pending}
                  <span class="shimmer mx-auto mt-1 block h-3.5 w-4/5 max-w-14" aria-hidden="true"></span>
                {:else if c.min != null}
                  <!-- 金額と「円」を1行に（2026-10-10 指示: 円だけ改行されていた）。狭いマスでも収まるよう少し小さく・字間を詰める -->
                  <span class={`block whitespace-nowrap text-[11px] font-semibold tabular-nums tracking-tighter sm:text-[13px] ${selected ? 'text-white' : 'text-[var(--pt-accent)]'}`}>{c.min.toLocaleString('ja-JP')}<span class="text-[9px] sm:text-[10px]">円</span></span>
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
      {#if pickApplies}チェックイン日を選ぶと、その日の料金でプランの詳細を表示します{:else if date}{md(date)} 〜 {md(checkout)}・{nights}泊{:else}日付指定なし・{nights}泊（今後3か月の最安で表示）{/if}
      <span class="ml-2 text-sm text-stone-400">— は満室・料金なし</span>
    </p>
    {#if !pickApplies}
      <button type="button" onclick={onApply} class="rounded-full bg-brand-900 px-6 py-2.5 text-base font-semibold text-white hover:bg-brand-800 disabled:opacity-40">{date ? 'この日程で検索' : '日付指定なしで検索'}</button>
    {/if}
  </div>
</div>
