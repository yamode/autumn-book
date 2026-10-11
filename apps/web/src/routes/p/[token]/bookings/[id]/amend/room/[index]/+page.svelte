<script lang="ts">
  // 特別会員の専用ページ: ご予約の「このお部屋を変更」（部屋タイプ・プラン・人数・公式の複数室 M3・docs/official-multi-room.md §17.3.2・§18.5）。
  // 室数を問わず（1 室の予約も）。日程は変えない（日程は amend/）。料金は専用料金（料金カレンダーと同じ）で計算し直す。
  // ① 人数（GET ?adults=）→ ② 候補（押すと ?room=&plan=&name= で見積）→ ③ 見積 → 確定（POST ?/confirm → 予約詳細へ 303）。
  // 候補・見積の部品（AmendRoomPicker / AmendRoomReview）は公式マイページと共用（文言は paraglide。/p は日本語で出る）。
  import { enhance } from '$app/forms';
  import { partnerTitle } from '$lib/partner-title';
  import AmendRoomPicker, { type AmendRoomPickerItem } from '$lib/components/booking/AmendRoomPicker.svelte';
  import AmendRoomReview from '$lib/components/booking/AmendRoomReview.svelte';

  let { data, form } = $props();

  const num = (n: number) => n.toLocaleString('ja-JP');
  const ADULTS = [1, 2, 3, 4, 5, 6];

  const q = $derived(data.quote);
  const sel = $derived(data.selected);
  const keyOf = (c: { roomCode: string; planCode: string; planName: string }) => `${c.roomCode}|${c.planCode}|${c.planName}`;
  const selectedKey = $derived(sel ? keyOf(sel) : null);
  const hrefOf = (c: { roomCode: string; planCode: string; planName: string }, adults: number) =>
    `${data.hrefs.self}?${new URLSearchParams({ adults: String(adults), room: c.roomCode, plan: c.planCode, name: c.planName })}`;
  const items = $derived<AmendRoomPickerItem[]>(
    data.candidates.map((c) => ({
      key: keyOf(c),
      roomName: c.roomName,
      planName: c.planName,
      total: c.total,
      // 今の部屋タイプは自分の部屋を使い回すので残室を出さない
      remaining: c.roomCode === data.room.roomCode ? null : c.remaining,
      current: c.current,
      selectable: c.selectable,
      blocked: c.blocked,
      href: hrefOf(c, data.adults),
      perks: c.perks
    }))
  );
  const canConfirm = $derived(!!q && !!sel && q.amendable && !q.isNoop && !q.inPenalty && q.available && !data.quoteError && !data.unavailable);
  let busy = $state(false);
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, `お部屋の変更（${data.room.index}室目）`)}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-3xl px-4 pb-10 pt-6 sm:px-6">
  <nav class="mb-4 text-sm text-stone-500"><a href={data.hrefs.back} class="text-sky-700 hover:underline">{data.code}</a> / お部屋の変更</nav>
  <h2 class="text-2xl font-bold">お部屋の変更（{data.room.index}室目）</h2>
  <p class="mt-1 text-sm leading-6 text-stone-500">
    お部屋タイプ・プラン・人数を変更できます（ご宿泊日はそのままです）。変更後の料金は、このページの専用料金で計算し直します。差額はご到着時に現地で精算します。
  </p>
  <p class="mt-1 text-xs text-stone-400">あと {data.amendRemaining} 回変更できます（日程の変更と合わせて）・ご宿泊日の当日 9:00 まで</p>

  {#if form?.message}
    <p class="mt-4 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-base text-rose-700" role="alert">{form.message}</p>
  {/if}

  <!-- 今のお部屋 -->
  <section class="mt-5 rounded-xl border border-stone-200 bg-white p-5">
    <h3 class="font-bold">今のお部屋</h3>
    <div class="mt-3 rounded-lg border border-stone-200 px-3 py-2 text-sm">
      <p class="text-xs text-stone-500">{data.room.index}室目</p>
      <p class="font-medium text-brand-900">{data.room.roomName || data.room.roomCode}</p>
      <p class="text-xs text-stone-500">{data.room.planName}・大人{data.room.adults}名</p>
      <p class="mt-1 text-right text-xs tabular-nums text-stone-600">{num(data.room.total)}円</p>
    </div>
  </section>

  {#if data.unavailable}
    <p class="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{data.unavailable}</p>
  {:else}
    <!-- ① 人数（GET で候補と見積を出し直す。選んでいる候補は引き継ぐ） -->
    <form method="GET" class="mt-5 rounded-xl border border-stone-200 bg-white p-5" data-sveltekit-noscroll>
      <h3 class="font-bold">人数</h3>
      <div class="mt-3 flex flex-wrap items-end gap-4">
        <label class="text-sm text-stone-600">
          大人
          <select name="adults" class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5 text-base">
            {#each ADULTS as a (a)}<option value={a} selected={a === data.adults}>{a}名</option>{/each}
          </select>
        </label>
        {#if sel}
          <input type="hidden" name="room" value={sel.roomCode} />
          <input type="hidden" name="plan" value={sel.planCode} />
          <input type="hidden" name="name" value={sel.planName} />
        {/if}
        <button type="submit" class="rounded-md border border-stone-300 px-4 py-2 text-sm font-bold text-brand-900 hover:border-brand-900">料金を確かめる</button>
      </div>
    </form>

    <!-- ② お部屋・プラン（専用料金・プランごとの専用特典。押すと見積） -->
    <section class="mt-5 rounded-xl border border-stone-200 bg-white p-5">
      <h3 class="font-bold">お部屋・プランを選ぶ</h3>
      <p class="mt-1 text-xs text-stone-500">大人{data.adults}名・今のご宿泊日の専用料金です。専用料金が設定されていないお部屋・プランは出ません。</p>
      <AmendRoomPicker {items} {selectedKey} />
    </section>

    <!-- ③ 見積 → 確定 -->
    {#if data.quoteError}
      <p class="mt-5 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-sm text-rose-700">{data.quoteError}</p>
    {:else if q && sel}
      <AmendRoomReview quote={q} roomIndex={data.room.index}>
        <form
          method="POST"
          action="?/confirm"
          use:enhance={() => {
            busy = true;
            return async ({ update }) => {
              busy = false;
              await update({ reset: false });
            };
          }}
          class="mt-5 flex justify-end"
        >
          <input type="hidden" name="roomCode" value={sel.roomCode} />
          <input type="hidden" name="planCode" value={sel.planCode} />
          <input type="hidden" name="planName" value={sel.planName} />
          <input type="hidden" name="adults" value={data.adults} />
          <button type="submit" disabled={!canConfirm || busy} class="w-full rounded-md bg-green-600 px-6 py-3 text-base font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto">
            {busy ? '変更しています…' : 'この内容に変更する'}
          </button>
        </form>
      </AmendRoomReview>
    {/if}
  {/if}
</main>
