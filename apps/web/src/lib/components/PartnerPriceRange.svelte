<script lang="ts">
  // 取引先ページ: 公開期間の料金の幅（1名1泊の最低〜最高）のカード＋「料金表をダウンロード」。
  // v0.77.0 で料金カレンダーを一休型に作り替えたときに消えたものを、部品に切り出して復活（2026-10-09・docs/partner-rank-rates.md §5.2）。
  // 公開範囲全体を読むので重く、表示後に /calendar/range を別に取りに行く。取得中はスケルトン、取れなかった・料金が無いときはカードごと出さない
  // （ダウンロードのボタンだけは残す）。min / max は根拠つき（どの日・部屋・プラン・人数の料金か）。
  // 金額にマウスを乗せる・タップするとツールチップで出す。プラン名は取引先向けの名前（booking_settings.planNames）に引き直す。
  import { onMount } from 'svelte';
  import { partnerPlanName } from '$lib/partner-booking';

  let { token, planNames }: { token: string; planNames?: Record<string, string> } = $props();

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
  onMount(() => {
    void loadPriceRange();
  });

  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const md = (iso: string) => {
    const [, m, d] = iso.split('-').map(Number);
    return `${m}月${d}日`;
  };
  // 公開期間は年をまたぐので年まで出す（例: 2026年10月1日）
  const ymdLabel = (iso: string) => `${Number(iso.slice(0, 4))}年${md(iso)}`;
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const mdw = (iso: string) => `${md(iso)}（${WD[new Date(`${iso}T00:00:00Z`).getUTCDay()]}）`;
  const planLabel = (code: string | undefined, name: string) => partnerPlanName(planNames, code, name);

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

  function onKey(e: KeyboardEvent) {
    // お部屋・プランのモーダルが開いているときは、そちらに任せる
    if (e.key !== 'Escape' || !tipOpen || document.querySelector('[data-room-info]')) return;
    closeTip();
    (document.activeElement as HTMLElement | null)?.blur?.();
  }
</script>

<svelte:window onkeydown={onKey} onclick={() => (tipPinned = null)} />

<!-- z-40: 直後の検索バー（z-30）より上に置き、根拠のツールチップが検索バーの下に潜らないようにする -->
<section class="relative z-40 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-stone-200 bg-white px-4 py-3 sm:px-5">
  {#if priceRangeState !== 'hidden'}
    <div class="min-w-0 flex-1">
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
                <li class="break-words leading-5">
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
    </div>
  {:else}
    <p class="min-w-0 flex-1 text-sm text-stone-500">料金表（CSV / PDF）をダウンロードできます。</p>
  {/if}
  <a
    href={`/p/${token}/rate-sheet`}
    class="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 transition hover:bg-stone-50"
  >
    <svg viewBox="0 0 20 20" fill="currentColor" class="h-4 w-4" aria-hidden="true"><path d="M10 2a1 1 0 0 1 1 1v8.59l2.3-2.3a1 1 0 1 1 1.4 1.42l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.42L9 11.6V3a1 1 0 0 1 1-1Zm-6 13a1 1 0 0 1 1 1v1h10v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z" /></svg>
    料金表をダウンロード
  </a>
</section>
