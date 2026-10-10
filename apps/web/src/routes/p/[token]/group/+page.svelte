<script lang="ts">
  // 取引先ページ: 団体予約の一覧（docs/partner-group-booking.md §8.1・§14.3）。
  // 取引先の全施設の照会（新しい順）を状態タブで分け、同じ束（一括送信）は1枚のカードにまとめて左の帯の色で追えるようにする。
  // 回答ありの行は行内で「承諾」「辞退」（確認つき）。送り先は詳細（./[id]）の form action。詳細でやりとり・取り下げ。
  import { partnerTitle } from '$lib/partner-title';
  import { deserialize } from '$app/forms';
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/stores';
  import { describeGroupStay, describeRoomAdults, GROUP_QUOTE_STATUS_TEXT, type GroupStatusTab } from '$lib/partner-group';
  import { inquiryToDraftItem, stashGroupCopy } from '$lib/partner-group-draft';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Row = PageData['inquiries'][number];
  const token = $derived($page.params.token ?? '');
  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }) : '');
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));

  // 状態タブ（回答待ち／回答あり／予約確定／終了）。既定は回答ありがあればそこ、無ければ件数のある最初のタブ
  const tabOf = (r: Row): GroupStatusTab => data.statusTabs.find((t) => t.statuses.includes(r.status))?.id ?? 'closed';
  const counts = $derived(Object.fromEntries(data.statusTabs.map((t) => [t.id, data.inquiries.filter((r) => tabOf(r) === t.id).length])) as Record<GroupStatusTab, number>);
  let tab = $state<GroupStatusTab | null>(null);
  const currentTab = $derived<GroupStatusTab>(
    tab ?? (counts.answered ? 'answered' : (data.statusTabs.find((t) => counts[t.id] > 0)?.id ?? 'waiting'))
  );
  const multiFacility = $derived(new Set(data.inquiries.map((r) => r.facility_id)).size >= 2);

  // 束ごとにまとめる（並びは読み込んだ順＝新しい順。束の中は batch_seq）
  const BANDS = ['#0f766e', '#b45309', '#4338ca', '#be185d', '#15803d', '#0369a1', '#7c2d12', '#6d28d9'];
  const bandOf = $derived.by(() => {
    const ids = [...new Set(data.inquiries.map((r) => r.batch_id))];
    return (batchId: string) => BANDS[ids.indexOf(batchId) % BANDS.length];
  });
  const groups = $derived.by(() => {
    const out: { batchId: string; createdAt: string; items: Row[] }[] = [];
    const by = new Map<string, (typeof out)[number]>();
    for (const r of data.inquiries) {
      if (tabOf(r) !== currentTab) continue;
      let g = by.get(r.batch_id);
      if (!g) {
        g = { batchId: r.batch_id, createdAt: r.created_at, items: [] };
        by.set(r.batch_id, g);
        out.push(g);
      }
      g.items.push(r);
    }
    for (const g of out) g.items.sort((a, b) => a.batch_seq - b.batch_seq);
    return out;
  });

  const amountOf = (r: Row) => {
    const lodging = r.answer_total ?? r.quote_total;
    const bath = r.answer_total != null ? (r.answer_bath_tax ?? 0) : (r.quote_bath_tax ?? 0);
    return lodging == null ? null : { total: lodging + bath, lodging, bath, answered: r.answer_total != null };
  };
  const statusClass = (s: Row['status']) =>
    s === 'offered'
      ? 'bg-[var(--pt-accent)] text-white'
      : s === 'accepted'
        ? 'bg-[var(--pt-accent-soft)] text-[var(--pt-accent)]'
        : s === 'submitted'
          ? 'bg-amber-100 text-amber-800'
          : 'bg-stone-200 text-stone-600';

  // ---- 行内の承諾・辞退（確認つき） ----
  let confirming = $state<{ id: string; kind: 'accept' | 'reject' } | null>(null);
  let reason = $state('');
  let busy = $state<string | null>(null);
  let result = $state<{ kind: 'ok' | 'error'; text: string; bookingCode?: string } | null>(null);

  async function act(r: Row, kind: 'accept' | 'reject') {
    busy = r.id;
    result = null;
    try {
      const fd = new FormData();
      if (kind === 'reject') fd.set('reason', reason);
      const res = await fetch(`/p/${token}/group/${r.id}?/${kind}`, { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
      const out = deserialize(await res.text());
      if (out.type === 'success') {
        const d = out.data as { bookingCode?: string } | undefined;
        result =
          kind === 'accept'
            ? { kind: 'ok', text: `「${r.group_name}」${describeGroupStay(r.check_in_date, r.nights)}を承諾し、ご予約が確定しました${d?.bookingCode ? `（予約番号 ${d.bookingCode}）` : ''}。`, bookingCode: d?.bookingCode }
            : { kind: 'ok', text: `「${r.group_name}」${describeGroupStay(r.check_in_date, r.nights)}を辞退しました。` };
        confirming = null;
        reason = '';
        await invalidateAll();
      } else if (out.type === 'failure') {
        result = { kind: 'error', text: String((out.data as { message?: string } | undefined)?.message ?? '処理できませんでした。') };
        await invalidateAll();
      } else if (out.type === 'redirect') {
        await goto(out.location);
      } else {
        result = { kind: 'error', text: '処理できませんでした。時間をおいてお試しください。' };
      }
    } catch {
      result = { kind: 'error', text: '通信できませんでした。通信状況をご確認ください。' };
    } finally {
      busy = null;
    }
  }

  // 「同じ条件でもう一度」: 入力画面へ内容を渡して開く
  async function copyToNew(r: Row) {
    stashGroupCopy(token, inquiryToDraftItem(r));
    await goto(`/p/${token}/group/new`);
  }
</script>

<svelte:head>
  <title>{partnerTitle(data.portal, '団体予約')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="text-2xl font-bold">団体予約</h2>
      <p class="mt-1 text-sm text-stone-500">団体の条件を照会し、宿の回答を承諾するとご予約になります（承諾したご予約は予約一覧に出ます）。</p>
    </div>
    {#if !data.blockReason && !data.portal.preview}
      <a href={`/p/${token}/group/new`} class="rounded-lg bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700">＋ 新しい団体予約の照会</a>
    {/if}
  </div>
  {#if data.blockReason}
    <p class="mt-4 rounded-xl border border-amber-700/30 bg-amber-700/5 px-4 py-3 text-sm text-amber-800">{data.blockReason}</p>
  {/if}

  {#if data.done === 'batch'}
    <div class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3">
      <p class="font-bold text-[var(--pt-accent)]">✓ 照会を送信しました</p>
      <p class="mt-1 text-sm text-stone-600">宿が受けられるかを確認してご回答します。回答はメールと、この一覧の「回答あり」でお知らせします。</p>
    </div>
  {/if}
  {#if result}
    <div class={`mt-4 rounded-xl border px-4 py-3 ${result.kind === 'ok' ? 'border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)]' : 'border-rose-700/30 bg-rose-700/5 text-rose-700'}`} role="status">
      <p class={result.kind === 'ok' ? 'font-bold text-[var(--pt-accent)]' : ''}>{result.kind === 'ok' ? '✓ ' : ''}{result.text}</p>
      {#if result.bookingCode}<a href={`/p/${token}/bookings?done=${encodeURIComponent(result.bookingCode)}`} class="mt-1 inline-block text-sm underline">予約一覧で見る</a>{/if}
    </div>
  {/if}
  {#if data.loadError}
    <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">{data.loadError}</p>
  {/if}

  <div class="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 text-sm sm:inline-flex sm:rounded-full" role="tablist" aria-label="照会の状態">
    {#each data.statusTabs as t (t.id)}
      <button
        type="button"
        role="tab"
        aria-selected={currentTab === t.id}
        onclick={() => (tab = t.id)}
        class={`rounded-full px-4 py-1.5 transition ${currentTab === t.id ? 'bg-brand-900 font-medium text-white' : 'text-stone-500 hover:text-brand-900'}`}
      >{t.label}<span class="ml-1 tabular-nums opacity-70">{counts[t.id]}</span></button>
    {/each}
  </div>

  {#if groups.length === 0}
    <p class="mt-6 rounded-xl border border-dashed border-stone-300 px-6 py-10 text-center text-stone-500">
      {data.inquiries.length === 0 ? 'まだ団体予約の照会はありません。' : '該当する照会はありません。'}
    </p>
  {:else}
    <div class="mt-4 grid gap-3">
      {#each groups as g (g.batchId)}
        <section class="overflow-hidden rounded-xl border border-l-[6px] border-stone-200 bg-white" style={`border-left-color:${bandOf(g.batchId)}`} aria-label={`${dt(g.createdAt)} に送信した照会`}>
          <p class="border-b border-stone-100 px-4 py-1.5 text-xs text-stone-500 sm:px-5">{dt(g.createdAt)} に送信{#if g.items.length > 1}・この束 {g.items.length}件{/if}{#if g.items[0]?.submitted_by}・{g.items[0].submitted_by}{/if}</p>
          <ul class="divide-y divide-stone-100">
            {#each g.items as r (r.id)}
              {@const a = amountOf(r)}
              <li class="px-4 py-3 sm:px-5">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <a href={`/p/${token}/group/${r.id}`} class="group min-w-0 flex-1">
                    <p class="text-sm text-stone-500">
                      {r.inquiry_code}
                      <span class={`ml-1.5 rounded px-1.5 py-0.5 text-xs font-medium ${statusClass(r.status)}`}>{data.statusLabels[r.status]}</span>
                      {#if r.status === 'offered' && r.answer === 'conditional'}<span class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">条件付き</span>{/if}
                      {#if multiFacility}<span class="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700">{r.facilityName}</span>{/if}
                    </p>
                    <p class="mt-0.5 font-bold group-hover:underline">{r.group_name} ・ {describeGroupStay(r.check_in_date, r.nights)}</p>
                    <p class="mt-0.5 text-sm text-stone-600">{r.room_name} × {r.room_count}室 ・ 大人{r.adult_total}名（{describeRoomAdults(r.rooms)}）</p>
                    <p class="text-sm text-stone-500">{r.plan_display_name ?? r.plan_name}{r.meal_type ? `（${mealLabel(r.meal_type)}）` : ''} ・ {r.payment_label}</p>
                    {#if r.status === 'offered' && r.answer_expires_at}<p class="mt-0.5 text-sm font-medium text-amber-800">回答の期限: {dt(r.answer_expires_at)} まで</p>{/if}
                    {#if r.status === 'accepted' && r.bookingCode}<p class="mt-0.5 text-sm">予約番号 {r.bookingCode}{r.bookingStatus === 'cancelled' ? '（取消済み）' : ''}</p>{/if}
                  </a>
                  <div class="text-right">
                    {#if a}
                      <p class="text-lg font-bold tabular-nums text-accent-600">{yen(a.total)}</p>
                      <p class="text-xs text-stone-500">{a.answered ? '宿の回答額' : '自動計算額'}{a.bath > 0 ? '（入湯税込み）' : ''}</p>
                    {:else}
                      <p class="text-sm text-stone-500">{GROUP_QUOTE_STATUS_TEXT[r.quote_status] || '宿が回答'}</p>
                    {/if}
                  </div>
                </div>
                {#if r.answer_message && r.status === 'offered'}
                  <p class="mt-2 whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm">宿から: {r.answer_message}</p>
                {/if}
                {#if r.actions.accept || r.actions.reject}
                  {#if confirming?.id === r.id}
                    <div class={`mt-3 grid gap-2 rounded-xl p-3 ${confirming.kind === 'accept' ? 'bg-[var(--pt-accent-soft)]' : 'bg-rose-700/5'}`}>
                      {#if confirming.kind === 'accept'}
                        <p class="text-sm font-medium">この内容で予約を確定します{a ? `（${yen(a.total)}・${r.payment_label}）` : ''}。確定後の取消は予約一覧から（キャンセル規定に従います）。</p>
                      {:else}
                        <p class="text-sm font-medium text-rose-700">宿の回答を辞退します。元に戻せません。</p>
                        <input bind:value={reason} maxlength="500" placeholder="辞退の理由（任意）" aria-label="辞退の理由" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
                      {/if}
                      <div class="flex flex-wrap gap-2">
                        <button type="button" disabled={busy === r.id} onclick={() => act(r, confirming!.kind)} class={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${confirming.kind === 'accept' ? 'bg-accent-600 hover:bg-accent-500' : 'bg-red-700'}`}>
                          {busy === r.id ? '処理しています…' : confirming.kind === 'accept' ? '承諾して予約を確定する' : '辞退する'}
                        </button>
                        <button type="button" disabled={busy === r.id} onclick={() => (confirming = null)} class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:bg-stone-50">やめる</button>
                      </div>
                    </div>
                  {:else}
                    <div class="mt-3 flex flex-wrap gap-2">
                      {#if r.actions.accept}<button type="button" onclick={() => ((confirming = { id: r.id, kind: 'accept' }), (reason = ''))} class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500">承諾する</button>{/if}
                      {#if r.actions.reject}<button type="button" onclick={() => ((confirming = { id: r.id, kind: 'reject' }), (reason = ''))} class="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-rose-50 hover:text-rose-700">辞退する</button>{/if}
                      <a href={`/p/${token}/group/${r.id}`} class="rounded-lg px-3 py-2 text-sm text-stone-500 hover:text-brand-900">詳細・やりとり</a>
                    </div>
                  {/if}
                {:else if (r.status === 'expired' || r.status === 'declined' || r.status === 'rejected' || r.status === 'withdrawn') && !data.blockReason && !data.portal.preview}
                  <div class="mt-2">
                    <button type="button" onclick={() => copyToNew(r)} class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm hover:border-[var(--pt-accent)]">同じ条件でもう一度照会</button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</main>
