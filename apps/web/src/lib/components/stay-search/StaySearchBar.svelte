<script lang="ts">
  // 検索バー（共通部品・見た目と操作だけ）。Airbnb 風: 白い角丸の1本に「チェックイン／泊数／ご利用人数・室数」の区画。
  // 区画を押すとその下に浮いたパネルが開く。日付は datePanel（呼び出し側が StaySearchPanel を描く）、人数・室数は ± のパネル。
  // 下書きを変えただけでは検索しない（「検索」「この条件で検索」で確定）。
  // 取引先ページ（PartnerSearchBar）と HP 配布の <yamado-search-bar>（embed・Shadow DOM の中）で同じものを使う。
  // 色は CSS 変数 --pt-accent / --pt-accent-soft。$app/*・paraglide に依存しない。
  import type { Snippet } from 'svelte';
  import { STAY_SEARCH_LABELS, type StaySearchLabels } from '$lib/stay-search/labels';
  import { formatDate, type StaySearchLang } from '$lib/stay-search/params';

  let {
    date = $bindable(''),
    nights = $bindable(1),
    guests = $bindable(2),
    rooms = $bindable(1),
    open = $bindable<'' | 'date' | 'guests'>(''),
    maxGuests = 6,
    maxRooms,
    crossType = true,
    lang = 'ja',
    labels = STAY_SEARCH_LABELS.ja,
    keepOpen,
    datePanel,
    onSearch
  }: {
    date: string;
    nights: number;
    guests: number;
    rooms: number;
    open?: '' | 'date' | 'guests';
    maxGuests?: number;
    maxRooms: number;
    /** 室数を部屋タイプ横断で数える（足りなければ組み合わせを出す） */
    crossType?: boolean;
    lang?: StaySearchLang;
    labels?: StaySearchLabels;
    /** パネルの外を押しても閉じないとき true（取引先ページ: お部屋の紹介のモーダルを開いているとき） */
    keepOpen?: () => boolean;
    /** 日付パネルの中身（close で閉じる） */
    datePanel: Snippet<[{ close: () => void }]>;
    onSearch: () => void;
  } = $props();

  let root = $state<HTMLDivElement | null>(null);
  // パネルの外を押したら閉じる。Shadow DOM の中でも判定できるよう composedPath で見る（target はホスト要素に差し替わるため）
  $effect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root && !e.composedPath().includes(root) && !keepOpen?.()) open = '';
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  });
  // 押した区画だけを白く浮かせる（チェックインと泊数は同じ日付パネルを開く）
  let seg = $state<'checkin' | 'nights' | 'guests'>('checkin');
  const toggle = (k: 'date' | 'guests', s: 'checkin' | 'nights' | 'guests' = k === 'guests' ? 'guests' : 'checkin') => {
    open = open === k && seg === s ? '' : k;
    seg = s;
  };
  const segment = (s: 'checkin' | 'nights' | 'guests') =>
    `flex min-w-0 flex-col justify-center rounded-full px-6 py-2.5 text-left transition ${open && seg === s ? 'bg-white shadow-[0_6px_20px_rgba(0,0,0,0.12)]' : 'hover:bg-stone-100'}`;
  const dateLabel = $derived(date ? formatDate(date, lang) : '');
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && open === 'guests') open = ''; }} />

<div bind:this={root} class="relative">
  <!-- PC: 1本の角丸バー -->
  <div class={`hidden items-center rounded-full border border-stone-200 p-1.5 shadow-[0_3px_12px_rgba(0,0,0,0.08)] md:flex ${open ? 'bg-stone-100' : 'bg-white'}`}>
    <button type="button" class={`${segment('checkin')} flex-[1.3]`} onclick={() => toggle('date', 'checkin')} aria-expanded={open === 'date'}>
      <span class="text-xs font-bold tracking-wide text-brand-900">{labels.checkin}</span>
      <span class={`truncate text-base ${date ? 'text-brand-900' : 'text-stone-400'}`}>{date ? dateLabel : labels.addDate}</span>
    </button>
    <span class={`h-8 w-px bg-stone-200 ${open ? 'opacity-0' : ''}`} aria-hidden="true"></span>
    <button type="button" class={`${segment('nights')} flex-[0.7]`} onclick={() => toggle('date', 'nights')} aria-label={labels.changeNights}>
      <span class="text-xs font-bold tracking-wide text-brand-900">{labels.nights}</span>
      <span class="truncate text-base text-brand-900">{labels.nightsN(nights)}</span>
    </button>
    <span class={`h-8 w-px bg-stone-200 ${open ? 'opacity-0' : ''}`} aria-hidden="true"></span>
    <div class={`${segment('guests')} flex-1 flex-row items-center justify-between gap-3 py-1.5 pr-1.5`}>
      <button type="button" class="flex min-w-0 flex-1 flex-col text-left" onclick={() => toggle('guests')} aria-expanded={open === 'guests'}>
        <span class="text-xs font-bold tracking-wide text-brand-900">{labels.guests}</span>
        <span class="truncate text-base text-brand-900">{labels.guestsVal(guests, rooms)}</span>
      </button>
      <button type="button" onclick={onSearch} class="shrink-0 rounded-full bg-[var(--pt-accent)] px-6 py-3 text-base font-bold text-white transition hover:brightness-110">{labels.search}</button>
    </div>
  </div>

  <!-- スマホ: 縦に積んだカード -->
  <div class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_3px_12px_rgba(0,0,0,0.08)] md:hidden">
    <button type="button" class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onclick={() => toggle('date')} aria-expanded={open === 'date'}>
      <span class="flex flex-col">
        <span class="text-xs font-bold text-brand-900">{labels.checkinNights}</span>
        <span class={`text-base ${date ? 'text-brand-900' : 'text-stone-400'}`}>{date ? labels.dateNights(dateLabel, nights) : labels.addDate}</span>
      </span>
    </button>
    <button type="button" class="flex w-full items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-left" onclick={() => toggle('guests')} aria-expanded={open === 'guests'}>
      <span class="flex flex-col">
        <span class="text-xs font-bold text-brand-900">{labels.guests}</span>
        <span class="text-base text-brand-900">{labels.guestsVal(guests, rooms)}</span>
      </span>
    </button>
    <div class="border-t border-stone-200 p-2">
      <button type="button" onclick={onSearch} class="w-full rounded-xl bg-[var(--pt-accent)] py-3 text-base font-bold text-white">{labels.search}</button>
    </div>
  </div>

  {#if open === 'date'}
    <div class="absolute inset-x-0 top-full z-40 mt-3">
      {@render datePanel({ close: () => (open = '') })}
    </div>
  {:else if open === 'guests'}
    <div class="absolute right-0 top-full z-40 mt-3 w-full rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.14)] md:w-96" role="dialog" aria-label={labels.guests}>
      {#each [{ key: 'guests', title: labels.perRoom, sub: labels.adult, value: guests, min: 1, max: maxGuests, unit: labels.personUnit }, { key: 'rooms', title: labels.roomsTitle(crossType), sub: labels.roomsSub(crossType), value: rooms, min: 1, max: maxRooms, unit: labels.roomUnit }] as row, i (row.key)}
        <div class={`flex items-center justify-between gap-4 py-3 ${i ? 'border-t border-stone-200' : ''}`}>
          <div>
            <p class="text-base font-semibold text-brand-900">{row.title}</p>
            <p class="text-sm text-stone-500">{row.sub}</p>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <button type="button" aria-label={labels.dec(row.title)} disabled={row.value <= row.min} onclick={() => (row.key === 'guests' ? (guests -= 1) : (rooms -= 1))} class="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 text-lg text-stone-600 hover:border-brand-900 disabled:opacity-30">−</button>
            <span class="min-w-8 text-center text-base tabular-nums">{row.unit(row.value)}</span>
            <button type="button" aria-label={labels.inc(row.title)} disabled={row.value >= row.max} onclick={() => (row.key === 'guests' ? (guests += 1) : (rooms += 1))} class="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 text-lg text-stone-600 hover:border-brand-900 disabled:opacity-30">＋</button>
          </div>
        </div>
      {/each}
      <p class="mt-1 text-xs leading-5 text-stone-500">{labels.comboNote(crossType)}</p>
      <div class="mt-3 flex justify-end">
        <button type="button" onclick={() => { open = ''; onSearch(); }} class="rounded-full bg-brand-900 px-6 py-2.5 text-base font-semibold text-white hover:bg-brand-800">{labels.applyCond}</button>
      </div>
    </div>
  {/if}
</div>
