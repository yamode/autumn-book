<script lang="ts">
  // 取引先専用ページ・料金カレンダーの検索バー（Airbnb 風: 白い角丸の1本に「チェックイン／泊数／ご利用人数・室数」の区画）。
  // 区画を押すとその下に浮いたパネルが開く。日付は PartnerStayPanel（2か月・泊数±・空き日）、人数・室数は ± のパネル。
  // 下書きを変えただけでは検索しない（「検索」「この日程で検索」で確定）。
  import PartnerStayPanel from './PartnerStayPanel.svelte';

  let {
    token,
    date = $bindable(''),
    nights = $bindable(1),
    guests = $bindable(2),
    rooms = $bindable(1),
    maxNights,
    maxRooms,
    showInventory,
    today,
    open = $bindable<'' | 'date' | 'guests'>(''),
    onSearch
  }: {
    token: string;
    date: string;
    nights: number;
    guests: number;
    rooms: number;
    maxNights: number;
    maxRooms: number;
    showInventory: boolean;
    today: string;
    open?: '' | 'date' | 'guests';
    onSearch: () => void;
  } = $props();

  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const label = (iso: string) => {
    const t = new Date(`${iso}T00:00:00Z`);
    return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日（${WEEK[t.getUTCDay()]}）`;
  };
  let root = $state<HTMLDivElement | null>(null);
  // パネルの外を押したら閉じる（お部屋の紹介のモーダルを開いているときは除く）
  $effect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node) && !document.querySelector('[data-room-info]')) open = '';
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  });
  const toggle = (k: 'date' | 'guests') => (open = open === k ? '' : k);
  const segment = (k: 'date' | 'guests') =>
    `flex min-w-0 flex-col justify-center rounded-full px-6 py-2.5 text-left transition ${open === k ? 'bg-white shadow-[0_6px_20px_rgba(0,0,0,0.12)]' : 'hover:bg-stone-100'}`;
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && open === 'guests') open = ''; }} />

<div bind:this={root} class="relative">
  <!-- PC: 1本の角丸バー -->
  <div class={`hidden items-center rounded-full border border-stone-200 p-1.5 shadow-[0_3px_12px_rgba(0,0,0,0.08)] md:flex ${open ? 'bg-stone-100' : 'bg-white'}`}>
    <button type="button" class={`${segment('date')} flex-[1.3]`} onclick={() => toggle('date')} aria-expanded={open === 'date'}>
      <span class="text-xs font-bold tracking-wide text-brand-900">チェックイン</span>
      <span class={`truncate text-base ${date ? 'text-brand-900' : 'text-stone-400'}`}>{date ? label(date) : '日付を追加'}</span>
    </button>
    <span class={`h-8 w-px bg-stone-200 ${open ? 'opacity-0' : ''}`} aria-hidden="true"></span>
    <button type="button" class={`${segment('date')} flex-[0.7]`} onclick={() => toggle('date')} aria-label="泊数を変える">
      <span class="text-xs font-bold tracking-wide text-brand-900">泊数</span>
      <span class="text-base text-brand-900">{nights}泊</span>
    </button>
    <span class={`h-8 w-px bg-stone-200 ${open ? 'opacity-0' : ''}`} aria-hidden="true"></span>
    <div class={`${segment('guests')} flex-1 flex-row items-center justify-between gap-3 py-1.5 pr-1.5`}>
      <button type="button" class="flex min-w-0 flex-1 flex-col text-left" onclick={() => toggle('guests')} aria-expanded={open === 'guests'}>
        <span class="text-xs font-bold tracking-wide text-brand-900">ご利用人数・室数</span>
        <span class="truncate text-base text-brand-900">大人{guests}名{rooms > 1 ? ` × ${rooms}室` : '・1室'}</span>
      </button>
      <button type="button" onclick={onSearch} class="shrink-0 rounded-full bg-[var(--pt-accent)] px-6 py-3 text-base font-bold text-white transition hover:brightness-110">検索</button>
    </div>
  </div>

  <!-- スマホ: 縦に積んだカード -->
  <div class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_3px_12px_rgba(0,0,0,0.08)] md:hidden">
    <button type="button" class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onclick={() => toggle('date')} aria-expanded={open === 'date'}>
      <span class="flex flex-col">
        <span class="text-xs font-bold text-brand-900">チェックイン・泊数</span>
        <span class={`text-base ${date ? 'text-brand-900' : 'text-stone-400'}`}>{date ? `${label(date)}〜 ${nights}泊` : '日付を追加'}</span>
      </span>
    </button>
    <button type="button" class="flex w-full items-center justify-between gap-3 border-t border-stone-200 px-4 py-3 text-left" onclick={() => toggle('guests')} aria-expanded={open === 'guests'}>
      <span class="flex flex-col">
        <span class="text-xs font-bold text-brand-900">ご利用人数・室数</span>
        <span class="text-base text-brand-900">大人{guests}名{rooms > 1 ? ` × ${rooms}室` : '・1室'}</span>
      </span>
    </button>
    <div class="border-t border-stone-200 p-2">
      <button type="button" onclick={onSearch} class="w-full rounded-xl bg-[var(--pt-accent)] py-3 text-base font-bold text-white">検索</button>
    </div>
  </div>

  {#if open === 'date'}
    <div class="absolute inset-x-0 top-full z-40 mt-3">
      <PartnerStayPanel {token} bind:date bind:nights {guests} {rooms} {maxNights} {showInventory} {today} onApply={onSearch} onClose={() => (open = '')} />
    </div>
  {:else if open === 'guests'}
    <div class="absolute right-0 top-full z-40 mt-3 w-full rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_8px_28px_rgba(0,0,0,0.14)] md:w-96" role="dialog" aria-label="ご利用人数・室数">
      {#each [{ key: 'guests', title: '1室あたりの人数', sub: '大人', value: guests, min: 1, max: 6, unit: '名' }, { key: 'rooms', title: '室数', sub: '同じお部屋タイプ・各室同じ人数', value: rooms, min: 1, max: maxRooms, unit: '室' }] as row, i (row.key)}
        <div class={`flex items-center justify-between gap-4 py-3 ${i ? 'border-t border-stone-200' : ''}`}>
          <div>
            <p class="text-base font-semibold text-brand-900">{row.title}</p>
            <p class="text-sm text-stone-500">{row.sub}</p>
          </div>
          <div class="flex items-center gap-3">
            <button type="button" aria-label={`${row.title}を減らす`} disabled={row.value <= row.min} onclick={() => (row.key === 'guests' ? (guests -= 1) : (rooms -= 1))} class="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 text-lg text-stone-600 hover:border-brand-900 disabled:opacity-30">−</button>
            <span class="min-w-8 text-center text-base tabular-nums">{row.value}{row.unit}</span>
            <button type="button" aria-label={`${row.title}を増やす`} disabled={row.value >= row.max} onclick={() => (row.key === 'guests' ? (guests += 1) : (rooms += 1))} class="flex h-9 w-9 items-center justify-center rounded-full border border-stone-300 text-lg text-stone-600 hover:border-brand-900 disabled:opacity-30">＋</button>
          </div>
        </div>
      {/each}
      <p class="mt-1 text-xs leading-5 text-stone-500">お部屋タイプの違う組み合わせ（例: 和室1室＋洋室1室）は、お部屋ごとに分けてご予約ください。</p>
      <div class="mt-3 flex justify-end">
        <button type="button" onclick={() => { open = ''; onSearch(); }} class="rounded-full bg-brand-900 px-6 py-2.5 text-base font-semibold text-white hover:bg-brand-800">この条件で検索</button>
      </div>
    </div>
  {/if}
</div>
