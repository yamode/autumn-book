<script lang="ts" module>
  /** 1 日分の表示（データの取り方は呼び出し側が決める） */
  export type StayDayView = {
    /** 1名1泊の最安（無ければ null） */
    price: number | null;
    /** 押せない日（満室・料金なし・範囲外・過去） */
    disabled: boolean;
    /** 料金の代わりに出す印: closed=休館日、dash=満室・料金なし（—） */
    mark: '' | 'closed' | 'dash';
  };
</script>

<script lang="ts">
  // 検索バーの日付パネル（共通部品・見た目と操作だけ）。2か月横並び・スマホは1か月。
  // 取引先ページ（PartnerStayPanel 経由）と HP 配布の <yamado-search-bar>（embed）で同じものを使う。
  // データの取得はしない: 日ごとの表示は day(iso)、取得中・失敗は loading / failed で外から渡す。
  // 表示中の月（leftYm）は bind で外へ出す（取引先ページは月ごとに読み込むため）。
  // $app/*・paraglide に依存しない（embed は SvelteKit の外で動く）。
  import { isHoliday } from '$lib/holidays';
  import { STAY_SEARCH_LABELS, type StaySearchLabels } from '$lib/stay-search/labels';
  import { addDays, formatMonth, formatShortDate, monthGrid, shiftYm, WEEKDAYS, type StaySearchLang } from '$lib/stay-search/params';

  let {
    date = $bindable(''),
    nights = $bindable(1),
    leftYm = $bindable(''),
    guests,
    rooms = 1,
    maxNights,
    today,
    latestYm,
    loading = false,
    failed = false,
    day,
    lang = 'ja',
    labels = STAY_SEARCH_LABELS.ja,
    pickApplies = false,
    onPick,
    onUndated,
    onApply,
    onClose,
    onEscape
  }: {
    date: string;
    nights: number;
    /** 左に出す月（YYYY-MM）。空なら date か today の月から始める */
    leftYm?: string;
    guests: number;
    rooms?: number;
    maxNights: number;
    today: string;
    /** 月送りの上限（YYYY-MM） */
    latestYm: string;
    loading?: boolean;
    failed?: boolean;
    day: (iso: string) => StayDayView;
    lang?: StaySearchLang;
    labels?: StaySearchLabels;
    /** 日付を押したらすぐ onPick する（「この日程で検索」ボタンを出さない） */
    pickApplies?: boolean;
    onPick?: (iso: string) => void;
    /** pickApplies のとき:「日付指定なし」に戻した */
    onUndated?: () => void;
    onApply: () => void;
    onClose: () => void;
    /** Esc を押したとき（省略時は onClose） */
    onEscape?: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  if (!leftYm) leftYm = (date || today).slice(0, 7);

  const shown = $derived([leftYm, shiftYm(leftYm, 1)]);
  const checkout = $derived(date ? addDays(date, nights) : '');
  const week = $derived(WEEKDAYS[lang]);
  const status = $derived(loading ? 'loading' : failed ? 'failed' : 'hint');
  /** 「大人2名・1室・1名あたりの最安」→ ['大人2名・', '1室・', '1名あたりの最安']（区切りは前に付ける） */
  //  （後読みの正規表現は古い iPhone の Safari で読めないので使わない）
  const chunks = (s: string) =>
    s.split(/(・| · )/).reduce<string[]>((out, p, i) => (i % 2 ? (out[out.length - 1] += p) : p && out.push(p), out), []);
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') (onEscape ?? onClose)(); }} />

{#snippet statusText(small: boolean)}
  {#if status === 'loading'}<span class={`${small ? 'text-xs' : 'text-sm'} text-stone-500`} role="status">{labels.loading}</span>{:else if status === 'failed'}<span class={`${small ? 'text-xs' : 'text-sm'} text-rose-700`} role="status">{labels.failed}</span>{:else}<span class="text-sm text-stone-400">{labels.hint}</span>{/if}
{/snippet}

<div role="dialog" aria-label={labels.dateDialog} class="rounded-3xl border border-stone-200 bg-white px-4 pb-4 pt-3 shadow-[0_8px_28px_rgba(0,0,0,0.14)] sm:px-6 sm:pt-4">
  <!--
    上段。PC（md〜）は 1 行: 泊数 −n+ ／ 日付指定なし ／ 案内 ／ 人数と最安の注記 ／ ×。
    スマホは 2 行に詰める（2026-10-29: 折り返して縦に長くなっていた）: 1 行目 泊数 −n+ と ×、2 行目 日付指定なしと注記（取得中・失敗のときはその表示）。
  -->
  <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-stone-100 pb-3 md:gap-3">
    <span class="text-base text-stone-600">{labels.nights}</span>
    <button type="button" disabled={nights <= 1} onclick={() => (nights -= 1)} class="flex h-9 w-9 items-center justify-center rounded bg-[var(--pt-accent)] text-xl text-white disabled:opacity-30" aria-label={labels.dec(labels.nights)}><svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg></button>
    <span class="min-w-10 text-center text-base font-medium tabular-nums">{labels.nightsN(nights)}</span>
    <button type="button" disabled={nights >= maxNights} onclick={() => (nights += 1)} class="flex h-9 w-9 items-center justify-center rounded bg-[var(--pt-accent)] text-xl text-white disabled:opacity-30" aria-label={labels.inc(labels.nights)}><svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg></button>
    <!-- 日付指定なし（泊数の右）: 日付を選んでいるときだけ押せる（押すと日付を外す）。日付が無いときはチェック済みで押せない -->
    <label class={`order-3 flex items-center gap-2 rounded-lg border px-2.5 py-1 text-sm md:order-none md:px-3 md:py-1.5 md:text-base ${date ? 'cursor-pointer border-stone-300 hover:border-brand-900' : 'border-stone-200 text-stone-500'}`}>
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
      {labels.noDate}
    </label>
    <span class="hidden md:inline">{@render statusText(false)}</span>
    <span class="ml-auto hidden text-sm text-stone-500 md:inline">{labels.priceNote(guests, rooms)}</span>
    <button type="button" onclick={onClose} class="order-1 ml-auto flex h-9 w-9 items-center justify-center rounded-full text-xl text-stone-500 hover:bg-stone-100 md:order-none md:ml-0" aria-label={labels.close}>×</button>
    <!-- スマホ: ここで改行して 2 行目へ -->
    <span class="order-2 h-0 basis-full md:hidden" aria-hidden="true"></span>
    <span class="order-3 min-w-0 flex-1 text-right text-xs leading-snug text-stone-500 md:hidden">
      <!-- 「・」の切れ目でだけ折り返す（語の途中で切れないように） -->
      {#if status === 'hint'}{#each chunks(labels.priceNote(guests, rooms)) as part, i (i)}<span class="inline-block">{part}</span>{/each}{:else}{@render statusText(true)}{/if}
    </span>
  </div>
  <div class="relative mt-3 grid gap-6 md:grid-cols-2">
    <button type="button" disabled={leftYm <= today.slice(0, 7)} onclick={() => (leftYm = shiftYm(leftYm, -1))} class="absolute left-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 disabled:opacity-30" aria-label={labels.prev}>‹</button>
    <button type="button" disabled={shiftYm(leftYm, 1) >= latestYm} onclick={() => (leftYm = shiftYm(leftYm, 1))} class="absolute right-0 top-0 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-600 disabled:opacity-30" aria-label={labels.next}>›</button>
    {#each shown as ym, mi (ym)}
      {@const grid = monthGrid(ym)}
      <section class={mi === 1 ? 'hidden md:block' : ''} aria-label={formatMonth(ym, lang)}>
        <h3 class="mb-2 text-center text-lg font-bold leading-8">{formatMonth(ym, lang)}</h3>
        <div class="grid grid-cols-7 text-center text-sm" aria-hidden="true">
          {#each week as w, i}<div class={`py-1.5 font-medium ${i === 0 ? 'text-rose-600' : i === 6 ? 'text-sky-600' : 'text-stone-500'}`}>{w}</div>{/each}
        </div>
        <div class="grid grid-cols-7 border-t border-stone-200 text-center">
          {#each Array(grid.offset) as _, i (`b-${i}`)}
            <div class="min-h-16 border-b border-stone-100"></div>
          {/each}
          {#each grid.dates as iso (iso)}
            {@const c = day(iso)}
            {@const dow = (grid.offset + Number(iso.slice(8)) - 1) % 7}
            {@const selected = iso === date}
            {@const inStay = !!date && iso > date && iso < checkout}
            <!-- 取得中は今日以降の料金欄をシマーにする（前の月・人数の料金を押させない） -->
            {@const pending = loading && iso >= today}
            <button
              type="button"
              disabled={pending || c.disabled}
              aria-pressed={selected}
              onclick={() => {
                date = iso;
                if (pickApplies) onPick?.(iso);
              }}
              class={`min-h-16 border-b border-stone-100 px-0.5 py-1.5 transition ${selected ? 'rounded bg-[var(--pt-accent)] text-white' : inStay ? 'bg-[var(--pt-accent-soft)]' : pending ? '' : !c.disabled ? 'hover:bg-[var(--pt-accent-soft)]' : 'text-stone-300'}`}
            >
              <span class={`block text-base ${selected ? '' : !pending && c.disabled ? '' : dow === 0 || isHoliday(iso) ? 'text-rose-600' : dow === 6 ? 'text-sky-600' : 'text-stone-800'}`}>{Number(iso.slice(8))}</span>
              {#if pending}
                <span class="shimmer mx-auto mt-1 block h-3.5 w-4/5 max-w-14" aria-hidden="true"></span>
              {:else if c.price != null}
                <!-- 金額と「円」を1行に（2026-10-10 指示: 円だけ改行されていた）。狭いマスでも収まるよう少し小さく・字間を詰める。
                     スマホ幅（〜640px）はマスが約43pxしかなく「26,300円」が隣のマスにはみ出すので、円（en は ¥）を省く（2026-10-29） -->
                <span class={`block whitespace-nowrap text-[11px] font-semibold tabular-nums tracking-tighter sm:text-[13px] ${selected ? 'text-white' : 'text-[var(--pt-accent)]'}`}>{#if lang === 'en'}<span class="hidden text-[10px] sm:inline">¥</span>{c.price.toLocaleString('ja-JP')}{:else}{c.price.toLocaleString('ja-JP')}<span class="hidden text-[10px] sm:inline">円</span>{/if}</span>
              {:else if c.mark === 'closed'}
                <span class="block text-xs">{labels.closed}</span>
              {:else if c.mark === 'dash'}
                <span class="block text-xs">—</span>
              {/if}
            </button>
          {/each}
        </div>
      </section>
    {/each}
  </div>
  <div class="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-3">
    <p class="text-base text-stone-700">
      {#if pickApplies}{labels.pickHint}{:else if date}{labels.range(formatShortDate(date, lang), formatShortDate(checkout, lang), nights)}{:else}{labels.undated(nights)}{/if}
      <span class="ml-2 text-sm text-stone-400">{labels.unavailable}</span>
    </p>
    {#if !pickApplies}
      <button type="button" onclick={onApply} class="rounded-full bg-brand-900 px-6 py-2.5 text-base font-semibold text-white hover:bg-brand-800 disabled:opacity-40">{date ? labels.applyDates : labels.applyNoDate}</button>
    {/if}
  </div>
</div>
