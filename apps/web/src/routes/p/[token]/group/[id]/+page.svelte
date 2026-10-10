<script lang="ts">
  // 取引先ページ: 団体予約の照会の詳細（条件・料金・宿の回答・やりとり）と、承諾・辞退・取り下げ（docs/partner-group-booking.md §6・§8.1・§14.3）。
  // 承諾で既存の予約（PB-…）ができ、以後は予約一覧で扱う。確認モードではボタンを出さない（サーバも 403）。
  import { partnerTitle } from '$lib/partner-title';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import PartnerPriceTable from '$lib/components/PartnerPriceTable.svelte';
  import { describeGroupBooker, describeGroupStay, describeRoomAdults } from '$lib/partner-group';
  import { inquiryToDraftItem, stashGroupCopy } from '$lib/partner-group-draft';
  import type { PageData } from './$types';

  type FormResult =
    | { accepted: true; bookingCode: string; bookingId: string }
    | { rejected: true }
    | { withdrawn: true }
    | { message?: string; code?: string }
    | null
    | undefined;
  let { data, form }: { data: PageData; form?: FormResult } = $props();

  const token = $derived($page.params.token ?? '');
  const r = $derived(data.inquiry);
  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }) : '');
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
  };
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));

  // 料金: 回答額があればそれ、無ければ自動計算額
  const answered = $derived(r.answer_total != null);
  const lodging = $derived(r.answer_total ?? r.quote_total);
  const bathTax = $derived((answered ? r.answer_bath_tax : r.quote_bath_tax) ?? 0);
  const result = $derived(form && 'message' in form ? form : null);
  const accepted = $derived(form && 'accepted' in form ? form : null);
  const done = $derived(form && ('rejected' in form || 'withdrawn' in form) ? form : null);

  let confirming = $state<'accept' | 'reject' | 'withdraw' | null>(null);
  let busy = $state(false);
  const submitting = () => {
    busy = true;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      busy = false;
      confirming = null;
      await update({ reset: false });
    };
  };

  async function copyToNew() {
    stashGroupCopy(token, inquiryToDraftItem(r));
    await goto(`/p/${token}/group/new`);
  }
  const closed = $derived(['declined', 'rejected', 'withdrawn', 'expired'].includes(r.status));
  // やりとりに出す一言: 宿の回答の一言と、御社が書いた辞退・取り下げの理由だけ（承諾の失敗の内部の理由は出さない）
  const actorOf = (k: string) => (k === 'partner' ? '御社' : k === 'staff' ? '宿' : '自動');
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, `団体予約 ${r.inquiry_code}`)}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
  <a href={`/p/${token}/group`} class="text-sm text-stone-500 hover:text-brand-900">← 団体予約の一覧</a>
  <div class="mt-2 flex flex-wrap items-center gap-2">
    <h2 class="text-2xl font-bold">{r.group_name}</h2>
    <span class={`rounded px-2 py-0.5 text-sm font-medium ${r.status === 'offered' ? 'bg-[var(--pt-accent)] text-white' : r.status === 'accepted' ? 'bg-[var(--pt-accent-soft)] text-[var(--pt-accent)]' : r.status === 'submitted' ? 'bg-amber-100 text-amber-800' : 'bg-stone-200 text-stone-600'}`}>{data.labels.status[r.status]}</span>
  </div>
  <p class="mt-1 text-sm text-stone-500">照会番号 {r.inquiry_code} ・ {dt(r.created_at)} に送信{r.submitted_by ? `（${r.submitted_by}）` : ''}</p>

  {#if accepted}
    <div class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3">
      <p class="font-bold text-[var(--pt-accent)]">✓ 承諾し、ご予約が確定しました（予約番号 {accepted.bookingCode}）</p>
      <p class="mt-1 text-sm text-stone-600">確認メールをお送りしました。{#if data.attachmentsEnabled}名簿・行程表は予約一覧の「添付ファイル」からお送りください。{/if}</p>
      <a href={`/p/${token}/bookings?done=${encodeURIComponent(accepted.bookingCode)}`} class="mt-1 inline-block text-sm underline">予約一覧で見る</a>
    </div>
  {:else if done}
    <p class="mt-4 rounded-xl border border-stone-300 bg-white px-4 py-3">{'rejected' in done ? '宿の回答を辞退しました。' : '照会を取り下げました。'}</p>
  {/if}
  {#if result?.message}
    <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700" role="alert">{result.message}</p>
  {/if}

  <!-- 宿の回答 -->
  {#if r.answer}
    <section class={`mt-5 rounded-xl border p-4 sm:p-5 ${r.answer === 'declined' ? 'border-stone-300 bg-white' : 'border-[var(--pt-accent)]/40 bg-white'}`}>
      <h3 class="font-bold">宿からの回答: <span class={r.answer === 'declined' ? 'text-stone-600' : 'text-[var(--pt-accent)]'}>{data.labels.answer[r.answer]}</span></h3>
      {#if r.answer_message}<p class="mt-2 whitespace-pre-wrap text-sm">{r.answer_message}</p>{/if}
      {#if r.status === 'offered' && r.answer_expires_at}<p class="mt-2 text-sm font-medium text-amber-800">承諾の期限: {dt(r.answer_expires_at)} まで</p>{/if}
    </section>
  {:else if r.status === 'submitted'}
    <p class="mt-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">宿の回答をお待ちください。回答はメールと、この画面でお知らせします。</p>
  {/if}

  <!-- 操作 -->
  {#if data.actions.accept || data.actions.reject || data.actions.withdraw}
    <div class="mt-4 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
      {#if confirming === 'accept'}
        <form method="POST" action="?/accept" use:enhance={submitting} class="grid gap-2">
          <!-- 見ていた回答のまま確定する（宿が回答を直していたらサーバが止める） -->
          <input type="hidden" name="updatedAt" value={r.updated_at} />
          <p class="text-sm font-medium">この内容で予約を確定します{lodging != null ? `（${yen(lodging + bathTax)}・${r.payment_label}）` : ''}。確定後の取消は予約一覧から（キャンセル規定に従います）。</p>
          <div class="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} class="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500 disabled:opacity-50">{busy ? '確定しています…' : '承諾して予約を確定する'}</button>
            <button type="button" disabled={busy} onclick={() => (confirming = null)} class="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50">やめる</button>
          </div>
        </form>
      {:else if confirming === 'reject' || confirming === 'withdraw'}
        <form method="POST" action={confirming === 'reject' ? '?/reject' : '?/withdraw'} use:enhance={submitting} class="grid gap-2 rounded-xl bg-rose-700/5 p-3">
          <p class="text-sm font-medium text-rose-700">{confirming === 'reject' ? '宿の回答を辞退します。' : 'この照会を取り下げます。'}元に戻せません。</p>
          <input name="reason" maxlength="500" placeholder="理由（任意）" aria-label="理由" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
          <div class="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} class="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? '処理しています…' : confirming === 'reject' ? '辞退する' : '取り下げる'}</button>
            <button type="button" disabled={busy} onclick={() => (confirming = null)} class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50">やめる</button>
          </div>
        </form>
      {:else}
        <div class="flex flex-wrap gap-2">
          {#if data.actions.accept}<button type="button" onclick={() => (confirming = 'accept')} class="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500">承諾する</button>{/if}
          {#if data.actions.reject}<button type="button" onclick={() => (confirming = 'reject')} class="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-rose-50 hover:text-rose-700">辞退する</button>{/if}
          {#if data.actions.withdraw}<button type="button" onclick={() => (confirming = 'withdraw')} class="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-rose-50 hover:text-rose-700">照会を取り下げる</button>{/if}
        </div>
        {#if r.status === 'offered' && !data.actions.accept}<p class="mt-2 text-xs text-stone-500">承諾の期限を過ぎているため、承諾できません。宿へお問い合わせいただくか、同じ条件でもう一度照会してください。</p>{/if}
      {/if}
    </div>
  {/if}
  {#if r.status === 'accepted' && r.bookingCode && !accepted}
    <p class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 text-sm">
      ご予約が確定しています（予約番号 {r.bookingCode}{r.bookingStatus === 'cancelled' ? '・取消済み' : ''}）。<a href={`/p/${token}/bookings`} class="underline">予約一覧で見る</a>
      {#if data.attachmentsEnabled && r.bookingStatus !== 'cancelled'}<span class="block text-stone-600">名簿・行程表は予約一覧の「添付ファイル」からお送りください。</span>{/if}
    </p>
  {/if}
  {#if closed && !data.portal.preview}
    <div class="mt-4"><button type="button" onclick={copyToNew} class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:border-[var(--pt-accent)]">同じ条件でもう一度照会</button></div>
  {/if}

  <div class="mt-5 grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
    <!-- 条件 -->
    <section class="min-w-0 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
      <h3 class="mb-3 font-bold">照会の内容</h3>
      <dl class="detail">
        <dt>施設</dt><dd>{r.facilityName}</dd>
        <dt>日程</dt><dd>{fmt(r.check_in_date)} 〜 {fmt(r.check_out_date)}（{r.nights}泊）<span class="block text-sm text-stone-500">{describeGroupStay(r.check_in_date, r.nights)}</span></dd>
        <dt>お部屋</dt><dd>{r.room_name} × {r.room_count}室</dd>
        <dt>人数</dt><dd>大人{r.adult_total}名（{describeRoomAdults(r.rooms)}）</dd>
        <dt>プラン</dt><dd>{r.plan_display_name ?? r.plan_name}{r.meal_type ? `（${mealLabel(r.meal_type)}）` : ''}</dd>
        {#if r.extras?.dinnerTime?.value}<dt>夕食開始</dt><dd>{r.extras.dinnerTime.value}</dd>{/if}
        <dt>お支払</dt><dd>{r.payment_label}</dd>
        {#if r.extras?.transport?.value}<dt>交通機関</dt><dd>{r.extras.transport.value}</dd>{/if}
        {#if r.extras?.note}<dt>備考</dt><dd class="whitespace-pre-wrap">{r.extras.note}</dd>{/if}
        {#if r.booker}<dt>ご予約者</dt><dd>{describeGroupBooker(r.booker)}</dd>{/if}
      </dl>
    </section>

    <!-- 料金 -->
    <section class="min-w-0 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
      <h3 class="font-bold">{answered ? '宿の回答額' : '自動計算額'}</h3>
      {#if lodging != null}
        <p class="mt-1 text-2xl font-bold tabular-nums text-accent-600">{yen(lodging + bathTax)}</p>
        <div class="mt-3">
          <PartnerPriceTable {lodging} guests={r.adult_total} nights={r.nights} {bathTax} total={lodging + bathTax} nightLines={data.nightLines} />
        </div>
        {#if answered && r.quote_total != null && r.quote_total !== r.answer_total}
          <p class="mt-2 text-xs text-stone-500">照会の時点の自動計算額 {yen(r.quote_total + (r.quote_bath_tax ?? 0))} から、宿が料金をご案内しました。</p>
        {/if}
      {:else}
        <p class="mt-2 text-sm text-stone-600">{data.labels.quote[r.quote_status] || '料金は宿からの回答でご案内します'}</p>
      {/if}
    </section>
  </div>

  <!-- やりとり -->
  <section class="mt-5 rounded-xl border border-stone-200 bg-white p-4 sm:p-5">
    <h3 class="mb-3 font-bold">やりとり</h3>
    {#if data.events.length === 0}
      <p class="text-sm text-stone-500">まだありません。</p>
    {:else}
      <ol class="relative ml-2 border-l border-stone-200">
        {#each data.events as ev (ev.id)}
          {@const msg = typeof ev.detail?.message === 'string' ? ev.detail.message : (ev.kind === 'rejected' || ev.kind === 'withdrawn') && typeof ev.detail?.reason === 'string' ? ev.detail.reason : ''}
          <li class="mb-4 ml-4 last:mb-0">
            <span class={`absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border-2 border-white ${ev.actor_kind === 'staff' ? 'bg-[var(--pt-accent)]' : ev.actor_kind === 'partner' ? 'bg-brand-800' : 'bg-stone-400'}`}></span>
            <p class="text-sm"><span class="font-medium">{data.labels.event[ev.kind] ?? ev.kind}</span><span class="ml-2 text-xs text-stone-500">{dt(ev.created_at)} ・ {actorOf(ev.actor_kind)}{ev.actor_kind === 'partner' && ev.actor_label ? `（${ev.actor_label}）` : ''}</span></p>
            {#if msg}<p class="mt-0.5 whitespace-pre-wrap text-sm text-stone-600">{msg}</p>{/if}
          </li>
        {/each}
      </ol>
    {/if}
  </section>
</main>

<style>
  .detail {
    display: grid;
    grid-template-columns: 6.5rem minmax(0, 1fr);
    gap: 0.45rem 1rem;
    font-size: 0.95rem;
  }
  .detail dt {
    color: var(--color-stone-500, #78716c);
  }
</style>
