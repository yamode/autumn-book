<script lang="ts">
  // 特別会員の専用ページのかごバー（docs/vip-member-page.md §13.4.3）。見た目は公式の BookingCart.svelte を写す。
  //   画面下に固定。「N室・大人M名・合計 ○円」「内訳」「予約へ進む」。内訳は下から出るシート（部屋を外す・かごを空にする）。
  //   「予約へ進む」は POST /p/<token>/book（default action）に rooms JSON を送り、全室を一括で仮押さえする（成功は公式の予約確認へ）。
  //   失敗（満室・回数制限・支払方法）は理由をバーの上に出し、かごはそのまま残す。Turnstile は付けない（Q4）。
  //   上限（min(4, 最大室数)）に達したら、バーの上に「1 回のご予約は 4 室まで…」を出す。
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { cartGroups, cartSummary } from '$lib/multi-room';
  import { memberCart, memberCartFullNotice } from '$lib/member-cart.svelte';

  let {
    token,
    limit,
    currentFacilityId,
    preview = false
  }: {
    token: string;
    /** 1 回の予約の室数の上限（min(4, 最大室数)） */
    limit: number;
    /** いま見ている施設（かごが別の施設なら一言添える） */
    currentFacilityId: string;
    /** 管理画面の確認モード（送信を止める） */
    preview?: boolean;
  } = $props();

  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const num = (n: number) => n.toLocaleString('ja-JP');
  const fmt = (iso: string) => {
    const t = new Date(`${iso}T00:00:00Z`);
    return `${t.getUTCMonth() + 1}月${t.getUTCDate()}日（${WEEK[t.getUTCDay()]}）`;
  };

  let open = $state(false);
  let busy = $state(false);
  const items = $derived(memberCart.items);
  const summary = $derived(cartSummary(items));
  const groups = $derived(cartGroups(items, (c) => `${c.planCode}■${c.planName}`));
  const full = $derived(items.length >= limit);
  const first = $derived(items[0]);
  const fullNotice = $derived(memberCartFullNotice(limit));

  function remove(key: string) {
    memberCart.remove(key);
    if (memberCart.items.length === 0) open = false;
  }
  function clear() {
    memberCart.clear();
    open = false;
  }

  const submit: SubmitFunction = ({ cancel }) => {
    if (preview) {
      cancel();
      memberCart.message = '確認モードではご予約に進めません。';
      return;
    }
    busy = true;
    memberCart.message = '';
    return async ({ result }) => {
      busy = false;
      if (result.type === 'redirect') {
        await goto(result.location);
        return;
      }
      if (result.type === 'failure') {
        const d = (result.data ?? {}) as { message?: string; soldOut?: { roomName: string }[] };
        const names = (d.soldOut ?? []).map((s) => s.roomName).filter(Boolean);
        memberCart.message = names.length
          ? `${[...new Set(names)].join('・')} はただいま満室です。かごから外すか、別の日程をお選びください。`
          : (d.message ?? 'ご予約に進めませんでした。時間をおいてお試しください。');
        return;
      }
      memberCart.message = 'ご予約に進めませんでした。時間をおいてお試しください。';
    };
  };
</script>

{#if items.length > 0 && first}
  <div class="fixed inset-x-0 bottom-0 z-50 border-t border-stone-200 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.10)] backdrop-blur">
    <div class="mx-auto max-w-6xl px-4 py-2.5 sm:px-6">
      {#if full}
        <p class="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900" role="status">{fullNotice}</p>
      {/if}
      {#if memberCart.message && !(full && memberCart.message === fullNotice)}
        <p class="mb-2 rounded-lg bg-stone-100 px-3 py-2 text-xs leading-5 text-stone-700" role="status">{memberCart.message}</p>
      {/if}
      {#if first.facilityId !== currentFacilityId}
        <p class="mb-1 text-xs text-stone-500">かごのお部屋は別の施設のものです。「予約へ進む」はかごの施設で予約します。</p>
      {/if}

      {#if open}
        <!-- 内訳（下から出るシート）: 部屋を外す・かごを空にする -->
        <div class="mb-2 max-h-[50vh] overflow-y-auto rounded-xl border border-stone-200 bg-white p-3 text-sm">
          <div class="flex items-center justify-between">
            <p class="font-medium text-brand-900">予約かご</p>
            <button type="button" onclick={() => (open = false)} class="text-xs text-stone-500 hover:underline">閉じる</button>
          </div>
          <p class="mt-0.5 text-xs text-stone-500">{fmt(first.checkin)}から{first.nights}泊</p>
          <ul class="mt-2 divide-y divide-stone-100">
            {#each groups as g (g.keys[0])}
              <li class="flex items-start justify-between gap-2 py-2">
                <div class="min-w-0">
                  <p class="break-words text-stone-800">
                    {g.item.roomName} ／ {g.item.displayName || g.item.planName} ／ 大人{g.item.adults}名
                    {#if g.count > 1}<span class="ml-1 font-medium">×{g.count}</span>{/if}
                  </p>
                  <p class="text-xs tabular-nums text-stone-500">{num(g.item.total * g.count)}円</p>
                </div>
                <!-- 同じ部屋を複数入れていれば 1 室ずつ外す -->
                <button type="button" onclick={() => remove(g.keys[g.keys.length - 1])} class="shrink-0 rounded-md border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">外す</button>
              </li>
            {/each}
          </ul>
          <p class="mt-1 text-xs text-stone-500">金額は目安です。予約へ進むときに専用料金で計算し直します。</p>
          <button type="button" onclick={clear} class="mt-1 text-xs text-red-600 hover:underline">かごを空にする</button>
        </div>
      {/if}

      <div class="flex items-center gap-2">
        <button type="button" onclick={() => (open = !open)} class="min-w-0 flex-1 text-left leading-tight" aria-expanded={open}>
          <p class="truncate text-sm font-bold text-brand-900">{summary.rooms}室・大人{summary.adults}名・合計 {num(summary.total)}円</p>
          <p class="text-[11px] text-accent-600 underline underline-offset-2">内訳</p>
        </button>
        <form method="POST" action={`/p/${token}/book`} use:enhance={submit} class="shrink-0">
          <input type="hidden" name="rooms" value={JSON.stringify(memberCart.payload())} />
          <input type="hidden" name="checkin" value={first.checkin} />
          <input type="hidden" name="nights" value={first.nights} />
          <input type="hidden" name="facility_id" value={first.facilityId} />
          <button type="submit" disabled={busy || preview} class="rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-50">
            {busy ? '確認中…' : '予約へ進む'}
          </button>
        </form>
      </div>
    </div>
  </div>
{/if}
