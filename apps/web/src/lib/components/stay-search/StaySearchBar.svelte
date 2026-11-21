<script lang="ts">
  // 検索バー（共通部品・見た目と操作だけ）。白い角丸の1本に「チェックイン・泊数／ご利用人数・室数」の区画。
  // 区画を押すとその下に浮いたパネルが開く。日付は datePanel（呼び出し側が StaySearchPanel を描く）、人数・室数は ± のパネル。
  // 下書きを変えただけでは検索しない（「検索」「この条件で検索」で確定）。
  // 取引先ページ（PartnerSearchBar）と HP 配布の <yamado-search-bar>（embed・Shadow DOM の中）で同じものを使う。
  // 色は CSS 変数 --pt-accent / --pt-accent-soft。$app/*・paraglide に依存しない。
  import type { Snippet } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { STAY_SEARCH_LABELS, type StaySearchLabels } from '$lib/stay-search/labels';
  import { addDays, formatDate, type StaySearchLang } from '$lib/stay-search/params';

  let {
    date = $bindable(''),
    nights = $bindable(1),
    guests = $bindable(2),
    rooms = $bindable(1),
    open = $bindable<'' | 'date' | 'guests' | 'facility'>(''),
    maxGuests = 6,
    maxRooms,
    crossType = true,
    rangeMode = false,
    lang = 'ja',
    labels = STAY_SEARCH_LABELS.ja,
    keepOpen,
    mobileDateDialog = false,
    datePanel,
    facilityPanel,
    facilityValue = '',
    onSearch
  }: {
    date: string;
    nights: number;
    guests: number;
    rooms: number;
    open?: '' | 'date' | 'guests' | 'facility';
    maxGuests?: number;
    maxRooms: number;
    /** 室数を部屋タイプ横断で数える（足りなければ組み合わせを出す） */
    crossType?: boolean;
    rangeMode?: boolean;
    lang?: StaySearchLang;
    labels?: StaySearchLabels;
    /** パネルの外を押しても閉じないとき true（取引先ページ: お部屋の紹介のモーダルを開いているとき） */
    keepOpen?: () => boolean;
    /** 日付パネルの中身（close で閉じる） */
    mobileDateDialog?: boolean;
    datePanel: Snippet<[{ close: () => void; modal?: boolean }]>;
    /** 施設の区画のパネル。渡したときだけ先頭に「施設」の区画を出す（公開サイトで施設が決まっていないとき） */
    facilityPanel?: Snippet<[{ close: () => void }]>;
    /** 選んだ施設の表示名（空なら「施設を選ぶ」） */
    facilityValue?: string;
    onSearch: () => void;
  } = $props();

  let root = $state<HTMLDivElement | null>(null);
  let dialog = $state<HTMLDialogElement>();
  const desktop = new MediaQuery('(min-width: 768px)', true);
  const modal = $derived(mobileDateDialog && !desktop.current);
  function closeDate() {
    dialog?.close();
    open = '';
  }
  $effect(() => {
    if (!dialog) return;
    const activeDialog = dialog;
    activeDialog.showModal();
    return () => activeDialog.close();
  });
  // パネルの外を押したら閉じる。Shadow DOM の中でも判定できるよう composedPath で見る（target はホスト要素に差し替わるため）
  $effect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root && !e.composedPath().includes(root) && !keepOpen?.()) open = '';
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  });
  const toggle = (panel: 'date' | 'guests' | 'facility') => {
    open = open === panel ? '' : panel;
  };
  const segment = (panel: 'date' | 'guests' | 'facility') =>
    `flex min-w-0 flex-col justify-center rounded-full px-6 py-2.5 text-left transition ${open === panel ? 'bg-white shadow-[0_6px_20px_rgba(0,0,0,0.12)]' : 'hover:bg-stone-100'}`;
  const dateSummary = $derived.by(() => {
    if (!date) return labels.addDate;
    const checkin = formatDate(date, lang);
    return rangeMode ? labels.range(checkin, formatDate(addDays(date, nights), lang), nights) : labels.dateNights(checkin, nights);
  });
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && (open === 'guests' || open === 'facility')) open = ''; }} />

{#snippet facilityText()}
  <span class="text-xs font-bold tracking-wide text-brand-900">{labels.facility}</span>
  <span class={`truncate text-base ${facilityValue ? 'text-brand-900' : 'text-stone-400'}`}>{facilityValue || labels.chooseFacility}</span>
{/snippet}

{#snippet dateText()}
  <span class="text-xs font-bold tracking-wide text-brand-900">{rangeMode ? labels.checkinCheckout : labels.checkinNights}</span>
  <span class={`truncate text-base ${date ? 'text-brand-900' : 'text-stone-400'}`}>{dateSummary}</span>
{/snippet}

<div bind:this={root} class="@container relative">
  <!-- PC: 1本の角丸バー -->
  <div class={`hidden items-center rounded-full border border-stone-200 p-1.5 shadow-[0_3px_12px_rgba(0,0,0,0.08)] @min-[900px]:flex ${open ? 'bg-stone-100' : 'bg-white'}`}>
    {#if facilityPanel}
      <button type="button" class={`${segment('facility')} flex-[1.2]`} onclick={() => toggle('facility')} aria-expanded={open === 'facility'}>
        {@render facilityText()}
      </button>
      <span class={`h-8 w-px bg-stone-200 ${open ? 'opacity-0' : ''}`} aria-hidden="true"></span>
    {/if}
    <button type="button" class={`${segment('date')} ${facilityPanel ? 'flex-[1.5]' : 'flex-[2]'}`} onclick={() => toggle('date')} aria-expanded={open === 'date'}>
      {@render dateText()}
    </button>
    <span class={`h-8 w-px bg-stone-200 ${open ? 'opacity-0' : ''}`} aria-hidden="true"></span>
    <div class={`${segment('guests')} ${facilityPanel ? 'flex-[1.5]' : 'flex-1'} flex-row items-center justify-between gap-3 py-1.5 pr-1.5`}>
      <button type="button" class="flex min-w-0 flex-1 flex-col text-left" onclick={() => toggle('guests')} aria-expanded={open === 'guests'}>
        <span class="text-xs font-bold tracking-wide text-brand-900">{labels.guests}</span>
        <span class="truncate text-base text-brand-900">{labels.guestsVal(guests, rooms)}</span>
      </button>
      <button type="button" onclick={onSearch} class="shrink-0 rounded-full bg-[var(--pt-accent)] px-6 py-3 text-base font-bold text-white transition hover:brightness-110">{labels.search}</button>
    </div>
  </div>

  <!-- スマホ: 縦に積んだカード -->
  <div class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_3px_12px_rgba(0,0,0,0.08)] @min-[900px]:hidden">
    {#if facilityPanel}
      <button type="button" class="flex w-full items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 text-left" onclick={() => toggle('facility')} aria-expanded={open === 'facility'}>
        <span class="flex min-w-0 flex-col">
          {@render facilityText()}
        </span>
      </button>
    {/if}
    <button type="button" class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onclick={() => toggle('date')} aria-expanded={open === 'date'}>
      <span class="flex min-w-0 flex-col">
        {@render dateText()}
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
    {#if modal}
      <dialog bind:this={dialog} aria-label={labels.dateDialog} class="m-auto max-h-[calc(100dvh-1.5rem)] w-[calc(100%-1.5rem)] max-w-lg overflow-auto overscroll-contain rounded-3xl bg-white backdrop:bg-stone-900/40" oncancel={closeDate}>
        {@render datePanel({ close: closeDate, modal: true })}
      </dialog>
    {:else}
      <div class="absolute inset-x-0 top-full z-40 mt-3">
        {@render datePanel({ close: closeDate })}
      </div>
    {/if}
  {:else if open === 'facility' && facilityPanel}
    <div class="absolute left-0 top-full z-40 mt-3 w-full rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.14)] @min-[520px]:w-[26rem]" role="dialog" aria-label={labels.facility}>
      {@render facilityPanel({ close: () => (open = '') })}
    </div>
  {:else if open === 'guests'}
    <div class="absolute right-0 top-full z-40 mt-3 w-full rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.14)] @min-[520px]:w-96" role="dialog" aria-label={labels.guests}>
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
