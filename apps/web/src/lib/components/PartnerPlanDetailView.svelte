<script lang="ts">
  // 取引先専用ページ・特別会員の専用ページ: プラン詳細（2026-11-02 指示「公式のプラン詳細の作りにそろえる」・UI 共通化の第2段階）。
  // 以前はプラン一覧の上にかぶせるモーダル（一休型）だったものを、一覧と入れ替えて 1 ページとして出す（URL に ?detail=…・戻るで一覧へ）。
  // 並びは公式のプラン詳細（/[brand]/[facility]/plans/[plan]）と同じ:
  //   左＝見出し → 写真 → 本文（プランの紹介・お料理・お部屋・会員特典・キャンセルポリシー・お子様）
  //   右＝お食事・お支払い → ご宿泊の条件（日程・人数）→ 料金 → 予約へ進む → 特典（ページの最後まで追従）
  //   スマホは 1 列で「見出し → 写真 → 料金・予約 → 本文」、画面の下に料金と予約ボタンの帯。
  // 日付未定（日程を選ぶ前の一覧から開いたとき）は料金を「〜」で出し、「日付を選択して予約」で、この部屋・プランに絞った
  // 日付パネル（PC は横に 2 か月・スマホは縦スクロール）を開く。日付を押したら、その日の料金でこの詳細を表示し直す（onPickDate）。
  import { page } from '$app/stores';
  import PartnerContentBody from './PartnerContentBody.svelte';
  import PerkBanners, { type PerkBanner } from './PerkBanners.svelte';
  import PerkModal, { type PerkModalContent } from './PerkModal.svelte';
  import PartnerContentSections from './PartnerContentSections.svelte';
  import PartnerTermsTable from './PartnerTermsTable.svelte';
  import MarkdownView from './MarkdownView.svelte';
  import PartnerStayPanel from './PartnerStayPanel.svelte';
  import MemberBenefitList from './MemberBenefitList.svelte';
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
    detail,
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
    onBack,
    onPickDate,
    onUndated,
    onChangeGuests,
    memberBenefits = null,
    memberRankLabel = '',
    onAddToCart = null
  }: {
    detail: PlanDetail;
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
    /** 一覧に戻る */
    onBack: () => void;
    /** 日付パネルで日付を選んだら（その日の料金で詳細を表示し直す） */
    onPickDate: (date: string, nights: number, offer: PartnerStayOffer) => void;
    /** 日付パネルの「日付指定なし」で日付未定に戻した（泊数はそのまま） */
    onUndated: (nights: number) => void;
    onChangeGuests: () => void;
    /** 特別会員の専用ページ: 会員特典の 2 段目（還元率・キャンセル方式・ポイント利用可）。取引先は null */
    memberBenefits?: string[] | null;
    memberRankLabel?: string;
    /** 特別会員の専用ページ: 「＋ もう 1 室追加」（かごへ）。取引先は null */
    onAddToCart?: (() => boolean) | null;
  } = $props();

  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const num = (n: number) => n.toLocaleString('ja-JP');
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付' : m === '朝食' ? '朝食付' : m === '素泊' ? '食事なし' : (m ?? ''));
  const dated = $derived(!!params.date);
  const dateText = $derived.by(() => {
    if (!params.date) return '日付を選ぶ';
    const t = new Date(`${params.date}T00:00:00Z`);
    return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日(${WEEK[t.getUTCDay()]}) · ${params.nights}泊`;
  });
  const guestText = $derived(`大人${params.guests}名・${params.rooms}室`);
  const freeText = $derived(freeCancelText(detail.terms?.freeUntilDays));
  const photos = $derived<ContentPhoto[]>([...(detail.plan?.photos ?? []), ...(detail.room?.photos ?? [])]);
  let photoIndex = $state(0);
  // 別のプラン・日付で開き直したら写真を先頭に
  $effect(() => {
    void detail.roomCode;
    void detail.planCode;
    photoIndex = 0;
  });

  // ---- 日付パネル（この部屋・プランだけの空室と料金。画面の中央に開く）----
  let pickerOpen = $state(false);
  let pickDate = $state('');
  let pickNights = $state(1);
  function openPicker() {
    pickDate = params.date;
    pickNights = params.nights;
    pickerOpen = true;
  }
  $effect(() => {
    if (!pickerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  });

  // 「予約へ進む」の下に並べる特典のバナー（公式HP限定特典・取引先専用特典）。押すとモーダルで中身
  // 取引先専用特典は「（取引先名）様専用特典」、特別会員の専用ページは「（会員名）様専用特典」
  const partnerPerkLabel = $derived(
    $page.data.portal?.kind === 'member'
      ? `${$page.data.portal?.member?.name ?? '会員'}様専用特典`
      : $page.data.portal?.partnerName
        ? `${$page.data.portal.partnerName}様専用特典`
        : '取引先専用特典'
  );
  const banners = $derived<PerkBanner[]>([
    ...detail.officialPerks.map((p) => ({ key: `official:${p.key}`, label: p.label, kind: 'official' as const })),
    ...(detail.perks.length ? [{ key: 'partner', label: partnerPerkLabel, kind: 'partner' as const }] : [])
  ]);
  let perkContent = $state<PerkModalContent | null>(null);
  function openPerk(key: string) {
    if (key === 'partner') {
      perkContent = { label: partnerPerkLabel, perks: detail.perks, note: 'このページからご予約いただいた場合に付きます。' };
      return;
    }
    const p = detail.officialPerks.find((x) => `official:${x.key}` === key);
    if (p) perkContent = { label: p.label, body: p.body };
  }
  const parts = $derived(roomParts(detail.roomName));
  const capacity = $derived(
    detail.room ? (detail.room.capacityMin === detail.room.capacityMax ? `${detail.room.capacityMax}名` : `${detail.room.capacityMin}名〜${detail.room.capacityMax}名`) : ''
  );
  const perPerson = $derived(Math.round(detail.perRoomNight / Math.max(params.guests, 1)));

  // 右欄の追従位置: サイトのヘッダー（--portal-header-h・レイアウトで測る）のすぐ下
  // 画面の下の帯（スマホ）: 右欄の「予約へ進む」が画面に入っているあいだは隠す（同じボタンを二重に出さない）
  let ctaEl = $state<HTMLElement | null>(null);
  let ctaInView = $state(true);
  $effect(() => {
    if (!ctaEl || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => (ctaInView = e.isIntersecting));
    io.observe(ctaEl);
    return () => io.disconnect();
  });
</script>

{#snippet cta(size: 'lg' | 'sm')}
  {#if !dated}
    <button type="button" onclick={openPicker} class={`block w-full rounded-lg bg-green-600 text-center text-white hover:bg-green-700 ${size === 'lg' ? 'py-3' : 'px-5 py-2.5'}`}>
      <span class={`block font-bold ${size === 'lg' ? 'text-lg' : 'text-base'}`}>日付を選択して予約</span>
      {#if freeText && size === 'lg'}<span class="block text-xs font-medium">{freeText}</span>{/if}
    </button>
  {:else if canBook}
    <a href={detail.bookHref} class={`block rounded-lg bg-green-600 text-center text-white hover:bg-green-700 ${size === 'lg' ? 'py-3' : 'px-5 py-2.5'}`}>
      <span class={`block font-bold ${size === 'lg' ? 'text-lg' : 'text-base'}`}>予約へ進む</span>
      {#if freeText && size === 'lg'}<span class="block text-xs font-medium">{freeText}</span>{/if}
    </a>
  {:else}
    <p class="rounded-lg bg-stone-100 px-3 py-3 text-center text-sm text-stone-500">この宿泊日のご予約は受付を締め切りました</p>
  {/if}
{/snippet}

<article class="mx-auto max-w-6xl px-4 pb-28 pt-4 sm:px-6 md:pb-12">
  <button type="button" onclick={onBack} class="text-sm text-stone-500 hover:text-brand-900">← プラン一覧に戻る</button>

  <!-- レイアウト（公式のプラン詳細と同じ）: 左＝見出し・写真・本文、右＝料金と予約ボタン（ページの最後まで追従）。
       スマホは 1 列で「見出し → 写真 → 料金・予約 → 本文」の順（DOM の順のまま） -->
  <div class="mt-3 grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,1fr)_340px] md:gap-x-8">
    <!-- 見出し -->
    <header class="space-y-2 md:col-start-1">
      <div class="flex flex-wrap items-center gap-2">
        {#if detail.mealType}<span class="rounded-sm border border-amber-600 px-1.5 text-xs text-amber-700">{mealLabel(detail.mealType)}</span>{/if}
        {#if detail.perks.length}<span class="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700">専用特典つき</span>{/if}
      </div>
      <h1 class="text-2xl font-bold leading-snug text-brand-900 md:text-3xl">{detail.plan?.name || detail.planName}</h1>
      {#if detail.plan?.headline && detail.plan.headline !== detail.plan.name}<p class="text-sm text-stone-600 md:text-base">{detail.plan.headline}</p>{/if}
      <p class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-brand-900">
        {#if times}<span><b>IN</b> {times.checkin}</span><span><b>OUT</b> {times.checkout}</span>{/if}
        <span><b>予約受付</b> 宿泊日の{deadlineText}</span>
      </p>
    </header>

    <!-- 写真（プランの写真 → お部屋の写真） -->
    <div class="md:col-start-1">
      <div class="relative overflow-hidden rounded-xl bg-stone-100">
        {#if photos.length}
          <img src={photos[photoIndex]?.url} alt={photos[photoIndex]?.caption || detail.planName} class="aspect-[16/10] w-full object-cover" />
          {#if photos.length > 1}
            <button type="button" aria-label="前の写真" onclick={() => (photoIndex = (photoIndex - 1 + photos.length) % photos.length)} class="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-xl text-stone-700 shadow">‹</button>
            <button type="button" aria-label="次の写真" onclick={() => (photoIndex = (photoIndex + 1) % photos.length)} class="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-xl text-stone-700 shadow">›</button>
            <span class="absolute right-3 top-3 rounded bg-black/55 px-2 py-0.5 text-xs text-white">{photoIndex + 1}/{photos.length}</span>
          {/if}
          {#if photos[photoIndex]?.caption}<span class="absolute bottom-3 left-3 rounded bg-black/55 px-2 py-0.5 text-xs text-white">{photos[photoIndex].caption}</span>{/if}
        {:else}
          <div class="aspect-[16/10] w-full"></div>
        {/if}
      </div>
      {#if photos.length > 1}
        <div class="mt-2 flex gap-2 overflow-x-auto pb-1">
          {#each photos as p, i (i)}
            <button type="button" onclick={() => (photoIndex = i)} class={`aspect-[3/2] w-24 shrink-0 overflow-hidden rounded-md border-2 transition ${i === photoIndex ? 'border-brand-900' : 'border-transparent opacity-70 hover:opacity-100'}`} aria-label={`写真 ${i + 1}`}>
              <img src={p.url} alt="" class="h-full w-full object-cover" loading="lazy" />
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <!-- 右欄: 料金と予約（スクロールしても見えるよう追従） -->
    <aside class="space-y-3 md:sticky md:col-start-2 md:row-span-3 md:row-start-1 md:self-start md:top-[calc(var(--portal-header-h,6rem)+1rem)]">
      <p class="hidden text-sm font-medium leading-snug text-brand-900 md:block">{detail.plan?.name || detail.planName}</p>
      <div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <!-- お食事・お支払い -->
        <dl class="space-y-2 text-sm">
          {#if detail.mealType}
            <div class="flex gap-3"><dt class="w-16 shrink-0 pt-0.5 text-xs text-stone-500">お食事</dt><dd class="text-stone-800">{mealLabel(detail.mealType)}</dd></div>
          {/if}
          {#if paymentLabels.length}
            <div class="flex gap-3"><dt class="w-16 shrink-0 pt-0.5 text-xs text-stone-500">お支払い</dt><dd class="text-stone-800">{paymentLabels.join(' ／ ')}</dd></div>
          {/if}
        </dl>
        <!-- ご宿泊の条件（公式のプラン詳細と同じ 2 行。日程はこのプランに絞った日付パネル、人数は検索バーのパネル） -->
        <div class="mt-3 border-t border-stone-200 pt-3">
          <p class="mb-1.5 text-xs font-medium text-stone-600">ご宿泊の条件</p>
          <div class="divide-y divide-stone-200 rounded-lg border border-stone-200 text-sm">
            <button type="button" onclick={openPicker} class="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-50">
              <span class="w-12 shrink-0 text-xs text-stone-500">日程</span>
              <span class={`min-w-0 flex-1 font-medium ${dated ? 'text-brand-900' : 'text-green-700'}`}>{dateText}</span>
              <span class="shrink-0 text-xs text-stone-400" aria-hidden="true">{dated ? '変更' : '›'}</span>
            </button>
            <button type="button" onclick={onChangeGuests} class="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-stone-50">
              <span class="w-12 shrink-0 text-xs text-stone-500">人数</span>
              <span class="min-w-0 flex-1 font-medium text-brand-900">{guestText}</span>
              <span class="shrink-0 text-xs text-stone-400" aria-hidden="true">変更</span>
            </button>
          </div>
        </div>
        <!-- 料金（全室・全泊の合計を主、1名あたりを従。日付未定は今後3か月の最安で「〜」） -->
        <div class="mt-3">
          <p class="text-xs text-stone-500">
            {dated ? '' : '今後3か月の最安 · '}大人{params.guests}名{params.rooms > 1 ? `×${params.rooms}室` : ''}{params.nights > 1 ? `・${params.nights}泊` : ''}の合計
          </p>
          <p class="text-2xl font-bold text-brand-900">
            <span class="tabular-nums">{num(detail.total)}</span>円{dated ? '' : '〜'}<span class="ml-1 text-xs font-normal text-stone-500">税込</span>
          </p>
          {#if params.guests > 1}<p class="text-xs text-stone-500">1名あたり{params.nights > 1 ? '（1泊平均）' : ''} <span class="tabular-nums">{num(perPerson)}</span>円{dated ? '' : '〜'}</p>{/if}
          {#if dated && (params.nights > 1 || params.rooms > 1)}<p class="text-xs text-stone-500">1室1泊{params.nights > 1 ? '（平均）' : ''} {num(detail.perRoomNight)}円</p>{/if}
          {#if !dated}<p class="mt-1 text-xs text-stone-500">日付を選ぶと料金が確定します。</p>{/if}
        </div>
        <div bind:this={ctaEl} class="mt-3">
          {@render cta('lg')}
          {#if dated && canBook && onAddToCart}
            <!-- 特別会員: 別のお部屋・プランと合わせて 1 回で予約する（かご・最大 4 室） -->
            <button type="button" onclick={onAddToCart} class="mt-2 block w-full rounded-lg border border-green-600 py-2.5 text-center text-base font-bold text-green-700 hover:bg-green-50">＋ もう 1 室追加</button>
          {/if}
        </div>
        <!-- キャンセル料の段が無いプランだけ、従来の取消期限を出す -->
        {#if !freeText && cancelText}<p class="mt-2 text-xs text-rose-600">取消は宿泊日の{cancelText}（予約一覧から）</p>{/if}
        {#if banners.length}<div class="mt-3"><PerkBanners items={banners} onopen={openPerk} /></div>{/if}
      </div>
      <!-- お部屋の要点（定員・設備・残り） -->
      <div class="rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-brand-900">
        <p class="font-bold">{#if parts.building}{parts.building}｜{/if}{parts.room}</p>
        <p class="mt-1">
          {#if capacity}<b>定員</b> {capacity}{/if}
          {#if detail.room?.amenities.length}<span class="ml-3 text-stone-600">{detail.room.amenities.slice(0, 4).join('・')}</span>{/if}
          {#if showInventory && detail.remaining != null && detail.remaining <= 2}<span class="ml-3 font-bold text-rose-600">残りあと{detail.remaining}室</span>{/if}
        </p>
      </div>
    </aside>

    <!-- 本文 -->
    <div class="min-w-0 space-y-10 md:col-start-1">
      {#if detail.plan && (detail.plan.description || detail.plan.specs.length)}
        <section>
          <h2 class="mb-3 text-xl font-bold">プランの紹介</h2>
          {#if detail.plan.description}<MarkdownView source={detail.plan.description} />{/if}
          {#if detail.plan.specs.length}<div class="mt-4"><PartnerTermsTable title="" rows={detail.plan.specs.map((x) => ({ label: x.label, value: x.value }))} /></div>{/if}
        </section>
      {/if}
      {#if detail.plan?.sections.length}<PartnerContentSections sections={detail.plan.sections} heading="お料理・プランの内容" />{/if}
      {#if detail.room}
        <section>
          <h2 class="mb-3 text-xl font-bold">お部屋</h2>
          <PartnerContentBody photos={detail.room.photos} description={detail.room.description} specs={detail.room.specs} sections={detail.room.sections} amenities={detail.room.amenities} detailLabel="浴室・アメニティ・設備" />
        </section>
      {/if}
      {#if memberBenefits?.length}
        <MemberBenefitList rankLabel={memberRankLabel} lines={memberBenefits} />
      {/if}
      {#if detail.terms}
        <PartnerTermsTable title="キャンセルポリシー" rows={detail.terms.cancellation} note={detail.terms.cancellationNote} />
        <PartnerTermsTable title="お子様について" rows={detail.terms.children} note={detail.terms.childrenNote} />
      {/if}
    </div>
  </div>
</article>

<!-- スマホ: 画面の下の料金と予約ボタン（右欄の「予約へ進む」が画面に入っているあいだは隠す） -->
{#if !ctaInView}
  <div class="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1 leading-tight">
        <p class="truncate text-[11px] text-stone-500">{dated ? dateText : '今後3か月の最安'}・{guestText}</p>
        <p class="text-lg font-bold text-brand-900"><span class="tabular-nums">{num(detail.total)}</span>円{dated ? '' : '〜'}<span class="ml-0.5 text-[11px] font-normal text-stone-500">税込</span></p>
      </div>
      <div class="shrink-0">{@render cta('sm')}</div>
    </div>
  </div>
{/if}

{#if pickerOpen}
  <!-- この部屋・プランだけの空室と料金（PC は横に 2 か月・スマホは縦スクロールの共通パネル）。日付を押したらその日の料金で表示し直す -->
  <div class="fixed inset-0 z-[95] flex items-end justify-center sm:items-center sm:p-6" role="presentation">
    <button type="button" class="absolute inset-0 bg-stone-950/55" aria-label="閉じる" onclick={() => (pickerOpen = false)}></button>
    <div class="relative max-h-[94dvh] w-full max-w-5xl overflow-y-auto rounded-t-3xl sm:rounded-3xl">
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
        onPick={(iso, n, offer) => {
          pickerOpen = false;
          onPickDate(iso, n, offer);
        }}
        onUndated={() => {
          pickerOpen = false;
          onUndated(pickNights);
        }}
        onClose={() => (pickerOpen = false)}
      />
    </div>
  </div>
{/if}
<PerkModal bind:content={perkContent} />
