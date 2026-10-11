<script lang="ts">
  // 特別会員の専用ページ: ご予約一覧（docs/vip-member-page.md §13.4.3b）。
  // このページから本人が予約した分だけ（公式サイトから予約した分・別の専用ページの分・ご家族が予約した分は出さない・Q10）。
  // 取消・日程変更・アレンジの追加は各予約の詳細から。施設タブでは絞らない（施設名を出す）。
  import { page } from '$app/stores';
  import { partnerTitle } from '$lib/partner-title';
  import type { MemberBookingsData } from './+page.server';

  let { data }: { data: MemberBookingsData } = $props();

  const num = (n: number) => n.toLocaleString('ja-JP');
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
  };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const STATUS: Record<string, { label: string; cls: string }> = {
    reserved: { label: 'ご予約中', cls: 'bg-emerald-50 text-emerald-700' },
    cancelled: { label: '取消済み', cls: 'bg-stone-100 text-stone-500' },
    stayed: { label: 'ご宿泊済み', cls: 'bg-blue-50 text-blue-600' }
  };
  const statusOf = (s: string) => STATUS[s] ?? { label: s, cls: 'bg-stone-100 text-stone-500' };
  const upcoming = $derived(data.reservations.filter((r) => r.status === 'reserved' && r.checkout >= today));
  const past = $derived(data.reservations.filter((r) => !(r.status === 'reserved' && r.checkout >= today)));
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, 'ご予約一覧')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#snippet card(r: (typeof data.reservations)[number])}
  {@const st = statusOf(r.status)}
  <a href={r.href} class="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 transition hover:shadow-md sm:p-5">
    <div class="min-w-0 flex-1">
      <p class="flex flex-wrap items-center gap-2 text-xs">
        <span class={`rounded-full px-2 py-0.5 ${st.cls}`}>{st.label}</span>
        <span class="text-stone-400">{r.code}</span>
        {#if r.roomCount > 1}<span class="rounded bg-brand-100 px-1.5 text-brand-700">{r.roomCount}室{r.status !== 'cancelled' && r.liveRooms < r.roomCount ? `（取消 ${r.roomCount - r.liveRooms}室）` : ''}</span>{/if}
      </p>
      {#if r.facilityName}<p class="mt-1 text-sm text-stone-500">{r.facilityName}</p>{/if}
      <p class="mt-0.5 text-base font-bold text-brand-900">{fmt(r.checkin)} から {r.nights}泊</p>
      <p class="mt-0.5 text-sm text-stone-600">大人{r.adults}名</p>
      <p class="mt-1 text-sm">
        <span class="font-medium tabular-nums">{num(r.total - r.pointsUsed)}円</span>
        <span class="ml-1 text-xs text-stone-400">{r.payment !== 'onsite' ? '事前決済' : '現地払い'}{r.pointsUsed > 0 ? `・ポイント利用 ${num(r.pointsUsed)}pt` : ''}</span>
      </p>
    </div>
    <span class="shrink-0 text-stone-300" aria-hidden="true">→</span>
  </a>
{/snippet}

<main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
  <h2 class="text-2xl font-bold">ご予約一覧</h2>
  <p class="mt-1 text-sm leading-6 text-stone-500">このページからご予約いただいた分です。取消・日程の変更・滞在アレンジの追加は、各ご予約の詳細から行えます。</p>

  {#if data.message}
    <p class="mt-5 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">{data.message}</p>
  {:else}
    <section class="mt-6">
      <h3 class="mb-3 text-lg font-bold">これからのご予約</h3>
      <div class="space-y-3">
        {#each upcoming as r (r.code)}
          {@render card(r)}
        {:else}
          <p class="rounded-xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">
            これからのご予約はありません。<a href={`/p/${$page.params.token}/calendar`} class="text-sky-700 underline">料金カレンダー</a>からご予約いただけます。
          </p>
        {/each}
      </div>
    </section>
    {#if past.length}
      <section class="mt-8">
        <h3 class="mb-3 text-lg font-bold">過去・取消のご予約</h3>
        <div class="space-y-3">
          {#each past as r (r.code)}{@render card(r)}{/each}
        </div>
      </section>
    {/if}
    <p class="mt-8 text-xs leading-5 text-stone-500">公式サイトから予約した分は、公式サイトのマイページでご確認ください。ご家族が予約した分は、ご家族の会員アカウントでご確認いただけます。</p>
  {/if}
</main>
