<script lang="ts">
  // 取引先専用ページ・料金カレンダー: 「詳細・予約」で開くプラン詳細のモーダル（一休のプラン詳細を再現）。
  // 上部: 写真・プラン名・食事・IN/OUT・予約受付・お部屋 → 日程・人数・料金 → 「予約へ進む」。
  // 本文: プランの紹介・専用特典・お料理・お部屋・キャンセルポリシー・お子様。
  // 上部の「予約へ進む」が見えなくなったら、日程・人数・料金・「予約へ進む」の固定フッターを出す。
  // 日付未定（日程を選ぶ前の一覧から開いたとき）は料金を「〜」で出し、「日付を選択して予約」で、この部屋・プランに絞った
  // 日付パネルをモーダルの中に開く。日付を押したら、その日の料金でこの詳細を表示し直す（onPickDate）。
  // 料金とプランの内容を確かめてから「予約へ進む」。日程の欄を押しても同じパネルを開く。
  import { page } from '$app/stores';
  import { fade, fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import PartnerContentBody from './PartnerContentBody.svelte';
  import PerkBanners, { type PerkBanner } from './PerkBanners.svelte';
  import PerkModal, { type PerkModalContent } from './PerkModal.svelte';
  import PartnerContentSections from './PartnerContentSections.svelte';
  import PartnerTermsTable from './PartnerTermsTable.svelte';
  import MarkdownView from './MarkdownView.svelte';
  import PartnerStayPanel from './PartnerStayPanel.svelte';
  import type { PartnerStayOffer } from '$lib/partner-stay';
  import { roomParts, type ContentPhoto, type PartnerPlanContent, type PartnerRoomContent } from '$lib/partner-contents';
  import { freeCancelText, type PlanTerms } from '$lib/partner-plan-terms';

  type Perk = { id: string; title: string; description: string; imageUrl: string };
  export type PlanDetail = {
    /** 料金・予約の対象（日付パネルの絞り込み用） */
    roomCode: string;
    planCode: string;
    /** 料金の planName（基本■2食■…）。表示名は planName */
    planLabel: string;
    planName: string;
    mealType: string | null;
    roomName: string;
    room: PartnerRoomContent | null;
    plan: PartnerPlanContent | null;
    terms: PlanTerms | null;
    perks: Perk[];
    /** 公式HP限定特典（取引先の設定で出すときだけ） */
    officialPerks: { key: string; label: string; title: string; body: string }[];
    /** 全室・全泊の合計（日付未定のときは今後3か月の最安で数えた参考） */
    total: number;
    /** 1室1泊（連泊は平均） */
    perRoomNight: number;
    remaining: number | null;
    bookHref: string;
  };

  let {
    detail = $bindable(null),
    params,
    times,
    deadlineText,
    cancelText,
    paymentLabels,
    showInventory,
    canBook,
    token,
    today,
    maxNights,
    isBookable,
    onPickDate,
    onUndated,
    onChangeGuests
  }: {
    detail: PlanDetail | null;
    params: { date: string; nights: number; guests: number; rooms: number };
    times: { checkin: string; checkout: string } | null;
    deadlineText: string;
    cancelText: string | null;
    paymentLabels: string[];
    showInventory: boolean;
    canBook: boolean;
    token: string;
    today: string;
    maxNights: number;
    /** 予約を受け付ける日か（日付パネルで締切後の日を押せなくする） */
    isBookable: (iso: string) => boolean;
    /** 日付パネルで日付を選んだら（その日の料金で詳細を表示し直す） */
    onPickDate: (date: string, nights: number, offer: PartnerStayOffer) => void;
    /** 日付パネルの「日付指定なし」で日付未定に戻した（泊数はそのまま） */
    onUndated: (nights: number) => void;
    onChangeGuests: () => void;
  } = $props();

  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const num = (n: number) => n.toLocaleString('ja-JP');
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付' : m === '朝食' ? '朝食付' : m === '素泊' ? '食事なし' : (m ?? ''));
  const dated = $derived(!!params.date);
  const dateText = $derived.by(() => {
    if (!params.date) return `日付指定なし ${params.nights}泊`;
    const t = new Date(`${params.date}T00:00:00Z`);
    return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日(${WEEK[t.getUTCDay()]}) ${params.nights}泊`;
  });
  const guestText = $derived(`大人${params.guests}名 ${params.rooms}室`);

  let dialog = $state<HTMLDivElement | null>(null);
  let scroller = $state<HTMLDivElement | null>(null);
  let topCta = $state<HTMLElement | null>(null);
  let footerVisible = $state(false);
  let photoIndex = $state(0);
  // 日付パネル（モーダルの中）
  let pickerOpen = $state(false);
  let pickerEl = $state<HTMLElement | null>(null);
  let pickDate = $state('');
  let pickNights = $state(1);
  function openPicker() {
    pickDate = params.date;
    pickNights = params.nights;
    pickerOpen = true;
    requestAnimationFrame(() => pickerEl?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
  const freeText = $derived(freeCancelText(detail?.terms?.freeUntilDays));
  const photos = $derived<ContentPhoto[]>(detail ? [...(detail.plan?.photos ?? []), ...(detail.room?.photos ?? [])] : []);

  $effect(() => {
    if (!detail) return;
    photoIndex = 0;
    footerVisible = false;
    pickerOpen = false;
    dialog?.focus();
    if (scroller) scroller.scrollTop = 0;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });
  // 上部の「予約へ進む」がスクロールで見えなくなったら固定フッターを出す
  $effect(() => {
    if (!detail || !topCta || !scroller || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => (footerVisible = !e.isIntersecting), { root: scroller });
    io.observe(topCta);
    return () => io.disconnect();
  });
  // 「予約へ進む」の左に並べる特典のバナー（公式HP限定特典・取引先専用特典）。押すとモーダルで中身
  // 取引先専用特典は「（取引先名）様専用特典」と出す（2026-10-09 指示）
  const partnerPerkLabel = $derived($page.data.portal?.partnerName ? `${$page.data.portal.partnerName}様専用特典` : '取引先専用特典');
  const banners = $derived<PerkBanner[]>(
    detail
      ? [
          ...detail.officialPerks.map((p) => ({ key: `official:${p.key}`, label: p.label, kind: 'official' as const })),
          ...(detail.perks.length ? [{ key: 'partner', label: partnerPerkLabel, kind: 'partner' as const }] : [])
        ]
      : []
  );
  let perkContent = $state<PerkModalContent | null>(null);
  function openPerk(key: string) {
    if (!detail) return;
    if (key === 'partner') {
      perkContent = { label: partnerPerkLabel, perks: detail.perks, note: 'このページからご予約いただいた場合に付きます。' };
      return;
    }
    const p = detail.officialPerks.find((x) => `official:${x.key}` === key);
    if (p) perkContent = { label: p.label, body: p.body };
  }
  const parts = $derived(detail ? roomParts(detail.roomName) : { building: '', room: '' });
  const capacity = $derived(
    detail?.room ? (detail.room.capacityMin === detail.room.capacityMax ? `${detail.room.capacityMax}名` : `${detail.room.capacityMin}名〜${detail.room.capacityMax}名`) : ''
  );
</script>

<svelte:window onkeydown={(e) => { if (detail && e.key === 'Escape' && !document.querySelector('[data-room-info]')) detail = null; }} />

{#snippet chips(size: 'lg' | 'sm')}
  <div class={`flex flex-wrap gap-3 ${size === 'sm' ? 'gap-2' : ''}`}>
    <button type="button" onclick={openPicker} aria-expanded={pickerOpen} class={`flex items-center gap-2 rounded-lg border bg-white text-left hover:border-brand-900 ${pickerOpen ? 'border-sky-600' : 'border-stone-200'} ${size === 'lg' ? 'px-5 py-4 text-lg' : 'px-4 py-3 text-base'}`}>
      <svg viewBox="0 0 24 24" class="h-5 w-5 text-sky-700" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></svg>
      {dateText}
    </button>
    <button type="button" onclick={onChangeGuests} class={`rounded-lg border border-stone-200 bg-white text-left hover:border-brand-900 ${size === 'lg' ? 'px-5 py-4 text-lg' : 'px-4 py-3 text-base'}`}>{guestText}</button>
  </div>
{/snippet}

{#snippet price(size: 'lg' | 'sm')}
  {#if detail}
    <div class="text-right">
      {#if detail.perks.length}<p class="text-sm font-bold text-amber-700">専用特典つき</p>{/if}
      <p class={`text-brand-900 ${size === 'lg' ? 'text-base' : 'text-sm'}`}>
        {mealLabel(detail.mealType)}大人{params.guests}名{params.rooms > 1 ? `×${params.rooms}室` : ''}{params.nights > 1 ? `・${params.nights}泊` : ''} 税込
        <span class={`font-bold tabular-nums ${size === 'lg' ? 'text-3xl' : 'text-2xl'}`}>{num(detail.total)}</span><span class="font-bold">円{dated ? '' : '〜'}</span>
      </p>
      <!-- 1名料金を併記する（2026-10-09 指示）。1室1泊 ÷ 人数（連泊は平均）。1名のときは出さない -->
      {#if params.guests > 1}<p class="text-sm font-semibold text-brand-900">1名あたり{params.nights > 1 ? '（1泊平均）' : ''} <span class="tabular-nums">{num(Math.round(detail.perRoomNight / Math.max(params.guests, 1)))}</span>円{dated ? '' : '〜'}</p>{/if}
      {#if !dated}<p class="text-xs text-stone-500">今後3か月の最安・日付を選ぶと確定します</p>
      {:else if params.nights > 1 || params.rooms > 1}<p class="text-xs text-stone-500">1室1泊{params.nights > 1 ? '（平均）' : ''} {num(detail.perRoomNight)}円</p>{/if}
    </div>
  {/if}
{/snippet}

{#if detail}
  <div class="fixed inset-0 z-[95] flex items-end justify-center sm:items-center" role="presentation">
    <button type="button" class="absolute inset-0 bg-stone-950/55" aria-label="閉じる" onclick={() => (detail = null)} transition:fade={{ duration: 200 }}></button>
    <div bind:this={dialog} transition:fly={{ y: 28, duration: 320, easing: cubicOut }} tabindex="-1" role="dialog" aria-modal="true" aria-label={detail.plan?.name || detail.planName} class="relative flex h-[94dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl outline-none sm:h-[92dvh] sm:w-[min(96vw,1000px)] sm:rounded-2xl">
      <button type="button" class="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-2xl text-stone-600 shadow hover:bg-white" aria-label="閉じる" onclick={() => (detail = null)}>×</button>
      <div bind:this={scroller} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <!-- 上部: 概要 -->
        <section class="px-5 pb-6 pt-6 sm:px-10 sm:pt-10">
          <div class="grid gap-6 md:grid-cols-[300px_minmax(0,1fr)]">
            <!-- self-start: 右欄の方が高いと枠が伸び、ドットが写真の下の余白に落ちるため -->
            <div class="relative self-start overflow-hidden rounded-lg bg-stone-100">
              {#if photos.length}
                <img src={photos[photoIndex]?.url} alt={photos[photoIndex]?.caption || detail.planName} class="aspect-[4/3] w-full object-cover" />
                {#if photos.length > 1}
                  <button type="button" aria-label="前の写真" onclick={() => (photoIndex = (photoIndex - 1 + photos.length) % photos.length)} class="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow">‹</button>
                  <button type="button" aria-label="次の写真" onclick={() => (photoIndex = (photoIndex + 1) % photos.length)} class="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-stone-700 shadow">›</button>
                  <div class="absolute inset-x-0 bottom-2 flex justify-center gap-1.5">
                    {#each photos.slice(0, 8) as _, i}<span class={`h-1.5 w-1.5 rounded-full ${i === photoIndex ? 'bg-white' : 'bg-white/50'}`}></span>{/each}
                  </div>
                {/if}
              {:else}
                <div class="aspect-[4/3] w-full"></div>
              {/if}
            </div>
            <div class="min-w-0 pr-8 md:pr-10">
              <h2 class="text-xl font-bold leading-relaxed text-brand-900 sm:text-2xl">{detail.plan?.name || detail.planName}</h2>
              <p class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-brand-900">
                {#if detail.mealType}<span class="rounded-sm border border-amber-600 px-1.5 text-xs text-amber-700">{mealLabel(detail.mealType)}</span>{/if}
                {#if times}<span><b>IN</b> {times.checkin}</span><span><b>OUT</b> {times.checkout}</span>{/if}
                <span><b>予約受付</b> 宿泊日の{deadlineText}</span>
              </p>
              <div class="mt-4 rounded-lg border border-stone-200 px-4 py-3 text-sm text-brand-900">
                <p class="font-bold">{#if parts.building}{parts.building}｜{/if}{parts.room}</p>
                <p class="mt-1">
                  {#if capacity}<b>定員</b> {capacity}{/if}
                  {#if detail.room?.amenities.length}<span class="ml-3 text-stone-600">{detail.room.amenities.slice(0, 4).join('・')}</span>{/if}
                  {#if showInventory && detail.remaining != null && detail.remaining <= 2}<span class="ml-3 font-bold text-rose-600">残りあと{detail.remaining}室</span>{/if}
                </p>
              </div>
            </div>
          </div>
          <div class="mt-6 flex flex-wrap items-center justify-between gap-4 border-y border-stone-200 py-5">
            {@render chips('lg')}
            {@render price('lg')}
          </div>
          {#if pickerOpen}
            <!-- この部屋・プランだけの空室と料金。日付を押したら予約の入力へ -->
            <div bind:this={pickerEl} class="mt-4 scroll-mt-4">
              <PartnerStayPanel
                {token}
                bind:date={pickDate}
                bind:nights={pickNights}
                guests={params.guests}
                rooms={params.rooms}
                {maxNights}
                {showInventory}
                {today}
                filter={{ roomCode: detail.roomCode, planCode: detail.planCode, planName: detail.planLabel }}
                pickApplies
                {isBookable}
                onApply={() => {}}
                onPick={onPickDate}
                onUndated={() => onUndated(pickNights)}
                onClose={() => (pickerOpen = false)}
              />
            </div>
          {/if}
          <div class="mt-5 flex flex-wrap items-start justify-between gap-4">
            <div class="pt-1"><PerkBanners items={banners} onopen={openPerk} /></div>
            <div class="flex w-full flex-col items-end sm:w-96">
            <div bind:this={topCta} class="w-full">
              {#if !dated}
                <button type="button" onclick={openPicker} class="block w-full rounded-md bg-green-600 py-3 text-center text-white hover:bg-green-700">
                  <span class="block text-lg font-bold">日付を選択して予約</span>
                  {#if freeText}<span class="block text-xs font-medium">{freeText}</span>{/if}
                </button>
              {:else if canBook}
                <a href={detail.bookHref} class="block rounded-md bg-green-600 py-3 text-center text-white hover:bg-green-700">
                  <span class="block text-lg font-bold">予約へ進む</span>
                  {#if freeText}<span class="block text-xs font-medium">{freeText}</span>{/if}
                </a>
              {:else}
                <p class="rounded-md bg-stone-100 py-4 text-center text-base text-stone-500">この宿泊日のご予約は受付を締め切りました</p>
              {/if}
            </div>
            <!-- キャンセル料の段が無いプランだけ、従来の取消期限を出す（いつから料金がかかるかの方が大事なので、段があれば上のボタンの中に） -->
            {#if !freeText && cancelText}<p class="mt-2 text-sm text-rose-600">取消は宿泊日の{cancelText}（予約一覧から）</p>{/if}
            </div>
          </div>
        </section>
        {#if paymentLabels.length}
          <div class="flex flex-wrap gap-2 bg-stone-100 px-5 py-4 sm:px-10">
            {#each paymentLabels as label}<span class="rounded bg-white px-3 py-1.5 text-sm text-brand-900">✓ {label}</span>{/each}
          </div>
        {/if}

        <!-- 本文 -->
        <div class="space-y-10 px-5 pb-32 pt-8 sm:px-10">
          {#if detail.plan && (detail.plan.description || detail.plan.specs.length)}
            <section>
              <h3 class="mb-3 text-xl font-bold">プランの紹介</h3>
              {#if detail.plan.headline && detail.plan.headline !== detail.plan.name}<p class="mb-3 font-medium">{detail.plan.headline}</p>{/if}
              {#if detail.plan.description}<MarkdownView source={detail.plan.description} />{/if}
              {#if detail.plan.specs.length}<div class="mt-4"><PartnerTermsTable title="" rows={detail.plan.specs.map((x) => ({ label: x.label, value: x.value }))} /></div>{/if}
            </section>
          {/if}
          {#if detail.plan?.sections.length}<PartnerContentSections sections={detail.plan.sections} heading="お料理・プランの内容" />{/if}
          {#if detail.room}
            <section>
              <h3 class="mb-3 text-xl font-bold">お部屋</h3>
              <PartnerContentBody photos={detail.room.photos} description={detail.room.description} specs={detail.room.specs} sections={detail.room.sections} amenities={detail.room.amenities} detailLabel="浴室・アメニティ・設備" />
            </section>
          {/if}
          {#if detail.terms}
            <PartnerTermsTable title="キャンセルポリシー" rows={detail.terms.cancellation} note={detail.terms.cancellationNote} />
            <PartnerTermsTable title="お子様について" rows={detail.terms.children} note={detail.terms.childrenNote} />
          {/if}
        </div>
      </div>

      <!-- 固定フッター（上部の「予約へ進む」が見えないとき）。本文の上に重ねて下から滑り出す
           （出し入れで本文の高さを変えるとガタつくため、常に置いて位置と透明度だけを動かす） -->
      <div
        inert={!footerVisible}
        aria-hidden={!footerVisible}
        class={`absolute inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.10)] backdrop-blur transition-[translate,opacity] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:px-8 ${footerVisible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-full opacity-0'}`}
      >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="hidden md:block">{@render chips('sm')}</div>
            <div class="flex flex-1 items-center justify-end gap-4">
              {@render price('sm')}
              {#if !dated}
                <button type="button" onclick={openPicker} class="shrink-0 rounded-md bg-green-600 px-6 py-3 text-base font-bold text-white hover:bg-green-700">日付を選択して予約</button>
              {:else if canBook}
                <a href={detail.bookHref} class="shrink-0 rounded-md bg-green-600 px-6 py-3 text-base font-bold text-white hover:bg-green-700">予約へ進む</a>
              {/if}
            </div>
          </div>
      </div>
    </div>
  </div>
{/if}
<PerkModal bind:content={perkContent} />
