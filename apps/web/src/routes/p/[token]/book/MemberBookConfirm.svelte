<script lang="ts">
  // 特別会員の専用ページ: ご予約内容の確認（docs/vip-member-page.md §13.4.3-1・§14.4）。
  // 料金カレンダーの「予約する」（同じ部屋タイプ × N 室・同じ人数）から来る。ここで出すのは
  //   部屋ごとの専用料金（泊ごとの見出し → 部屋ごとの行）・このプランの専用特典（1 段目）・会員特典（2 段目）・
  //   獲得予定ポイントの目安・キャンセル方式 と「予約へ進む」だけ。
  // 宿泊者・支払方法・ポイント利用の入力は公式の予約確認（/booking/hold）で行う（「予約へ進む」で全室を仮押さえして移る）。
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import { partnerTitle } from '$lib/partner-title';
  import { groupNightLines, partnerNightLines, partnerNightLineText } from '$lib/partner-booking';
  import PartnerPerkList from '$lib/components/PartnerPerkList.svelte';
  import MemberBenefitList from '$lib/components/MemberBenefitList.svelte';
  import type { MemberBookData } from './+page.server';

  let {
    data,
    form
  }: {
    data: MemberBookData;
    form?: { message?: string; code?: string; soldOut?: { roomTypeId: string; roomName: string }[] } | null;
  } = $props();

  const token = $derived($page.params.token ?? '');
  const num = (n: number) => n.toLocaleString('ja-JP');
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
  };
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付' : m === '朝食' ? '朝食付' : m === '素泊' ? '食事なし' : (m ?? ''));

  const quote = $derived(data.quote);
  const t = $derived(data.target);
  const memberName = $derived(data.portal.member?.name ?? '会員');
  const perkItems = $derived(data.perks.map((p, i) => ({ id: p.id ?? `perk-${i}`, title: p.title, description: p.description, imageUrl: '' })));
  const payText = $derived.by(() => {
    if (!data.pay) return '';
    const list = [data.pay.onsite ? '現地払い' : '', data.pay.prepay ? '事前決済（クレジットカード）' : ''].filter(Boolean);
    return list.join('・');
  });
  let busy = $state(false);
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, 'ご予約内容の確認')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
  <a href={data.back.href} class="text-sm text-sky-700 hover:underline">← {data.back.label}</a>
  <h2 class="mt-2 text-2xl font-bold">ご予約内容の確認</h2>
  <p class="mt-1 text-sm leading-6 text-stone-500">{memberName} 様の専用料金です。「予約へ進む」でお部屋を確保し、次の画面でご宿泊者・お支払方法・ポイントのご利用を入力します。</p>

  {#if form?.message}
    <p class="mt-4 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-base text-rose-700" role="alert">
      {form.message}
      {#if form.soldOut?.length}<span class="block text-sm">（{[...new Set(form.soldOut.map((s) => s.roomName).filter(Boolean))].join('・')}）</span>{/if}
    </p>
  {/if}

  <div class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
    <div class="space-y-5">
      <!-- お部屋・プラン・日程 -->
      <section class="card">
        <div class="flex items-start gap-3">
          {#if data.photo}<img src={data.photo} alt="" class="h-[72px] w-[72px] shrink-0 rounded-lg object-cover" />{/if}
          <div class="min-w-0">
            <p class="text-lg font-bold leading-snug">{quote.ok ? quote.roomName : t.roomCode}</p>
            <p class="mt-1 break-words text-[15px] text-stone-700">{t.displayName}</p>
          </div>
        </div>
        <dl class="mt-4 grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[15px]">
          <dt class="text-stone-500">宿泊日</dt>
          <dd>{fmt(t.checkIn)} から {t.nights}泊{#if quote.ok && quote.mealType}<span class="ml-1.5 text-sm text-stone-500">{mealLabel(quote.mealType)}</span>{/if}</dd>
          <dt class="text-stone-500">人数</dt>
          <dd>大人{t.guests}名{t.roomCount > 1 ? ` × ${t.roomCount}室` : ''}</dd>
          {#if payText}<dt class="text-stone-500">お支払い</dt><dd>{payText}<span class="block text-xs text-stone-500">次の画面で選びます</span></dd>{/if}
          <dt class="text-stone-500">キャンセル</dt>
          <dd>{data.cancelMode.label}</dd>
        </dl>
      </section>

      <!-- 特典の 1 段目: このページの専用特典（このプランに付くもの） -->
      {#if perkItems.length}
        <section>
          <p class="text-lg font-bold">{memberName}様専用特典</p>
          <p class="text-sm text-stone-500">このページからご予約いただいた場合に付きます。宿が当日ご用意します。</p>
          <div class="mt-3"><PartnerPerkList perks={perkItems} variant="compact" showImages={false} /></div>
        </section>
      {/if}
      <!-- 特典の 2 段目: 会員制度の特典 -->
      {#if data.memberBenefits}
        <MemberBenefitList rankLabel={data.portal.member?.rankLabel ?? ''} lines={data.memberBenefits} cancelRules={data.cancelMode.rules} />
      {/if}
    </div>

    <!-- 右欄: 料金の明細と「予約へ進む」 -->
    <aside class="card self-start lg:sticky lg:top-[calc(var(--portal-header-h,6rem)+1rem)]">
      {#if !quote.ok}
        <p class="rounded-lg bg-rose-700/5 px-3 py-2 text-sm text-rose-700">{quote.message}</p>
      {:else}
        <div class="flex items-start justify-between gap-3">
          <span class="font-bold">宿泊料金合計</span>
          <p class="text-lg font-bold tabular-nums">{num(quote.total)}<span class="text-sm">円</span></p>
        </div>
        <!-- 泊ごとに「N泊目: M月D日（曜）」の見出し → 部屋ごとの行「（N室目）1名様 ○円 × ○名様　○円」。1室1泊だけのときは右の金額を出さない -->
        {@const groups = groupNightLines(partnerNightLines(quote.rooms))}
        {@const single = groups.length === 1 && groups[0].lines.length === 1}
        <div class="mt-2 space-y-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
          {#each groups as g (g.date)}
            <div>
              <p class="font-medium text-stone-700">{g.label}</p>
              <ul class="mt-0.5 space-y-0.5">
                {#each g.lines as l (`${l.room}-${l.date}`)}
                  <li class="flex justify-between gap-2 pl-3">
                    <span class="min-w-0">{#if quote.rooms.length > 1}<span class="mr-2">{l.room + 1}室目</span>{/if}<span class="tabular-nums">{partnerNightLineText(l)}</span></span>
                    {#if !single}<span class="whitespace-nowrap tabular-nums">{num(l.amount)}円</span>{/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
        {#if quote.bathTax > 0}
          <div class="mt-2.5 flex justify-between gap-2">
            <span class="font-bold">入湯税</span>
            <span class="tabular-nums">{num(quote.bathTax)}円</span>
          </div>
        {/if}
        <div class="mt-4 flex items-end justify-between gap-3 border-t border-stone-200 pt-4">
          <span class="whitespace-nowrap font-bold">お支払い金額（目安）</span>
          <span class="whitespace-nowrap"><span class="mr-1 text-sm">税込</span><span class="text-2xl font-bold tabular-nums leading-none">{num(quote.total + quote.bathTax)}</span><span class="font-bold">円</span></span>
        </div>
        <p class="mt-2 text-xs leading-5 text-stone-500">ポイント・クーポンのご利用、事前決済の割引は次の画面で反映します。</p>
        {#if data.earnEstimate > 0}
          <p class="mt-2 text-right text-sm text-[var(--pt-accent)]">獲得予定ポイント（目安） <span class="font-bold tabular-nums">{num(data.earnEstimate)}pt</span></p>
        {/if}
      {/if}

      <div class="mt-5">
        {#if data.portal.preview}
          <p class="rounded-md bg-stone-100 py-3 text-center text-sm text-stone-500">確認モードではご予約に進めません</p>
        {:else if data.canBook}
          <form
            method="POST"
            use:enhance={() => {
              busy = true;
              return async ({ update }) => {
                busy = false;
                await update({ reset: false });
              };
            }}
          >
            <input type="hidden" name="rooms" value={JSON.stringify(data.holdRooms)} />
            <input type="hidden" name="checkin" value={t.checkIn} />
            <input type="hidden" name="nights" value={t.nights} />
            <input type="hidden" name="facility_id" value={data.facilityId} />
            <button type="submit" disabled={busy} class="w-full rounded-md bg-green-600 py-3 text-lg font-bold text-white hover:bg-green-700 disabled:opacity-60">
              {busy ? 'お部屋を確保しています…' : '予約へ進む'}
            </button>
          </form>
          <p class="mt-2 text-xs leading-5 text-stone-500">お部屋は次の画面で一定時間確保されます。ご予約の確定は次の画面の「予約を確定する」で行います。</p>
        {:else if !quote.ok}
          <p class="rounded-md bg-stone-100 py-3 text-center text-sm text-stone-500">この日程・人数ではご予約いただけません</p>
        {:else if !data.pay}
          <p class="rounded-md bg-stone-100 px-3 py-3 text-center text-sm text-stone-500">このプランは専用ページからご予約いただけません。別のプランをお選びください。</p>
        {:else}
          <p class="rounded-md bg-stone-100 px-3 py-3 text-center text-sm text-stone-500">この宿泊日のご予約は締め切りました（宿泊日の{data.deadlineText}）</p>
        {/if}
      </div>
    </aside>
  </div>
</main>

<style>
  /* 取引先の予約入力（PartnerBookInput）と同じカード */
  .card {
    border-radius: 0.75rem;
    border: 1px solid var(--color-stone-200, #e7e5e4);
    background: var(--color-white, #fff);
    padding: 1.25rem;
  }
  @media (min-width: 640px) {
    .card {
      padding: 1.5rem;
    }
  }
</style>
