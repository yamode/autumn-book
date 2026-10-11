<script lang="ts">
  // 特別会員の専用ページ: ご予約の日程変更（docs/vip-member-page.md §13.4.3b・Q9）。
  // 日付・泊数だけ（全室同時。お部屋・プラン・人数はそのまま）。変更後の金額は専用ページの料金（料金カレンダーと同じ）で計算し直す。
  // ① 新しい日程を選ぶ（GET で見積）→ ② お部屋ごとの今と変更後・差額 → ③ 変更を確定（POST ?/amend）。
  import { enhance } from '$app/forms';
  import { partnerTitle } from '$lib/partner-title';

  let { data, form } = $props();

  const num = (n: number) => n.toLocaleString('ja-JP');
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
  };
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const nightsChoices = $derived(Array.from({ length: Math.max(1, data.maxNights) }, (_, i) => i + 1));

  const q = $derived(data.quote);
  const newTotalOf = (index: number) => q?.rooms.find((r) => r.index === index)?.newTotal ?? null;
  const canConfirm = $derived(!!q && !!data.candidate && q.amendable && !q.isNoop && !q.inPenalty && q.available && !data.unavailable);
  let busy = $state(false);
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, '日程の変更')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-3xl px-4 pb-10 pt-6 sm:px-6">
  <nav class="mb-4 text-sm text-stone-500"><a href={data.hrefs.back} class="text-sky-700 hover:underline">{data.code}</a> / 日程の変更</nav>
  <h2 class="text-2xl font-bold">日程の変更</h2>
  <p class="mt-1 text-sm leading-6 text-stone-500">
    ご宿泊日と泊数を変更できます（{data.current.rooms.length > 1 ? 'すべてのお部屋を同時に変更します。' : ''}お部屋・プラン・人数はそのままです）。変更後の料金は、このページの専用料金で計算し直します。
    お部屋・プラン・人数を変えたいときは、取り消してからご予約し直してください。
  </p>
  {#if q}<p class="mt-1 text-xs text-stone-400">あと {q.amendRemaining} 回変更できます・ご宿泊日の当日 9:00 まで</p>{/if}

  {#if form?.message}
    <p class="mt-4 rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-base text-rose-700" role="alert">{form.message}</p>
  {/if}

  <!-- ① 新しい日程（GET で見積を出し直す） -->
  <form method="GET" class="mt-5 rounded-xl border border-stone-200 bg-white p-5">
    <h3 class="font-bold">新しい日程</h3>
    <div class="mt-3 flex flex-wrap items-end gap-4">
      <label class="text-sm text-stone-600">
        チェックイン
        <input type="date" name="checkin" value={data.candidate?.checkin ?? data.current.checkin} min={today} class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5 text-base" />
      </label>
      <label class="text-sm text-stone-600">
        泊数
        <select name="nights" class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5 text-base">
          {#each nightsChoices as n (n)}<option value={n} selected={n === (data.candidate?.nights ?? data.current.nights)}>{n}泊</option>{/each}
        </select>
      </label>
      <button type="submit" class="rounded-md border border-stone-300 px-4 py-2 text-sm font-bold text-brand-900 hover:border-brand-900">料金を確かめる</button>
    </div>
  </form>

  <!-- ② お部屋ごとの今と変更後 -->
  <section class="mt-5 rounded-xl border border-stone-200 bg-white p-5">
    <h3 class="font-bold">お部屋{data.current.rooms.length > 1 ? `（${data.current.rooms.length}室）` : ''}</h3>
    <p class="mt-1 text-sm text-stone-500">今のご予約: {fmt(data.current.checkin)} から {data.current.nights}泊</p>
    <ul class="mt-3 space-y-2 text-sm">
      {#each data.current.rooms as r (r.index)}
        {@const after = newTotalOf(r.index)}
        <li class="rounded-lg border border-stone-200 px-3 py-2">
          {#if data.current.rooms.length > 1}<p class="text-xs text-stone-500">{r.index}室目</p>{/if}
          <p class="font-medium text-brand-900">{r.roomName || r.roomCode}</p>
          <p class="text-xs text-stone-500">{r.planName}・大人{r.adults}名</p>
          <p class="mt-1 flex justify-between gap-2 text-xs text-stone-600">
            <span class="tabular-nums">{num(r.total)}円</span>
            {#if after != null && data.candidate}<span class="tabular-nums">→ {num(after)}円</span>{/if}
          </p>
        </li>
      {/each}
    </ul>
  </section>

  {#if data.unavailable}
    <p class="mt-5 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">{data.unavailable}</p>
  {:else if q && data.candidate}
    <!-- ③ 差額と確定 -->
    <section class="mt-5 rounded-xl border border-stone-200 bg-white p-5">
      <h3 class="font-bold">変更の内容</h3>
      <div class="mt-3 grid gap-3 sm:grid-cols-3">
        <div class="rounded-lg bg-stone-50 p-4 text-sm">
          <p class="text-xs font-medium text-stone-400">今のご予約</p>
          <p class="mt-1">{fmt(data.current.checkin)}</p>
          <p class="text-xs text-stone-500">{data.current.nights}泊</p>
          <p class="mt-2 font-medium tabular-nums">{num(q.oldCharge)}円</p>
        </div>
        <div class="rounded-lg bg-[var(--pt-accent-soft)] p-4 text-sm">
          <p class="text-xs font-medium text-[var(--pt-accent)]">変更後</p>
          <p class="mt-1">{fmt(data.candidate.checkin)}</p>
          <p class="text-xs text-stone-500">{data.candidate.nights}泊</p>
          <p class="mt-2 font-medium tabular-nums">{num(q.newCharge)}円</p>
          {#if q.newDiscount > 0}<p class="text-xs text-emerald-700">クーポン {num(q.newDiscount)}円 引き</p>{/if}
        </div>
        <div class="rounded-lg border border-stone-200 p-4 text-sm">
          <p class="text-xs font-medium text-stone-400">差額</p>
          <p class={`mt-1 text-lg font-bold tabular-nums ${q.diff > 0 ? 'text-rose-600' : q.diff < 0 ? 'text-emerald-700' : 'text-stone-500'}`}>{q.diff > 0 ? '+' : ''}{num(q.diff)}円</p>
          <p class="mt-1 text-xs text-stone-500">{q.diff > 0 ? '差額は現地でお支払いください。' : q.diff < 0 ? '差額は現地で精算します。' : '料金は変わりません。'}</p>
          {#if q.pointsRefund > 0}<p class="mt-1 text-xs text-emerald-700">ポイント {num(q.pointsRefund)}pt をお戻しします</p>{/if}
        </div>
      </div>

      {#if q.isNoop}
        <p class="mt-4 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-500">今のご予約と同じ日程です。</p>
      {:else if !q.available}
        <p class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">この日程では全室のお部屋を確保できません。別の日程をお選びください。</p>
      {:else if q.inPenalty}
        <p class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">キャンセル料がかかる期間のため、日程を変更できません。お手数ですが宿へお問い合わせください。</p>
      {:else if !q.amendable}
        <p class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">このご予約は日程を変更できません（変更の回数・締切）。お手数ですが宿へお問い合わせください。</p>
      {/if}

      <form
        method="POST"
        action="?/amend"
        use:enhance={() => {
          busy = true;
          return async ({ update }) => {
            busy = false;
            await update({ reset: false });
          };
        }}
        class="mt-5 flex justify-end"
      >
        <input type="hidden" name="checkin" value={data.candidate.checkin} />
        <input type="hidden" name="nights" value={data.candidate.nights} />
        <button type="submit" disabled={!canConfirm || busy} class="w-full rounded-md bg-green-600 px-6 py-3 text-base font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-stone-300 sm:w-auto">
          {busy ? '変更しています…' : 'この日程に変更する'}
        </button>
      </form>
    </section>
  {/if}
</main>
