<script lang="ts">
  // 取引先ページ: 団体予約の照会の入力（束に積んで一括送信・docs/partner-group-booking.md §8.1・§14.3）。
  // 左にフォーム、右に「送る照会の束」。手早く入れる工夫:
  //   - 「束に追加」（Enter / Ctrl+Enter）: 条件をそのまま残し、チェックイン日の欄へフォーカス（日付だけ変えて次）
  //   - 「日付を変えて複製」（束の行の ⧉ / Ctrl+D）: その行をフォームに戻し、チェックイン日を +1 日
  //   - 「前回の内容を使う」: 直近の送信の条件（団体名以外）
  //   - 束とフォームはブラウザに自動保存（localStorage・閉じても残る。送信・クリアで消す）
  // 自動計算額は既存の POST /p/[token]/book/quote（400ms のデバウンス）。締切は団体の設定（canInquireFor）で見る
  // （見積の canBook は個人予約の締切なので使わない）。送信は POST ./submit（JSON）→ 一覧へ ?done=batch。
  import { partnerTitle } from '$lib/partner-title';
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import PartnerGroupQuoteCard, { type GroupQuoteView } from '$lib/components/PartnerGroupQuoteCard.svelte';
  import PartnerGroupDraftList from '$lib/components/PartnerGroupDraftList.svelte';
  import {
    canInquireFor,
    describeGroupStay,
    describeRoomAdults,
    GROUP_QUOTE_STATUS_TEXT,
    groupQuoteStatusOf,
    normalizeGroupDraftItem,
    splitAdultsEvenly,
    suggestRoomCount,
    validateGroupDraft,
    type GroupChoiceInput,
    type GroupDraftItem
  } from '$lib/partner-group';
  import { normalizeBooker, type PartnerBooker } from '$lib/partner-booking';
  import { clearGroupDraft, loadGroupDraft, newDraftKey, saveGroupDraft, takeGroupCopy, withDraftBooker, type GroupDraftEntry } from '$lib/partner-group-draft';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const token = $derived($page.params.token ?? '');
  const settings = $derived(data.settings);
  const catalog = $derived(data.catalog);
  const paymentIds = $derived(data.paymentChoices.map((p) => p.id));
  const OTHER = $derived(data.choiceOther);

  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const addDays = (iso: string, days: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));
  const planKeyOf = (code: string, name: string) => `${code}\u0001${name}`;

  // 締切の内側で最初に選べる日（公開範囲の最初から数える）
  function firstOpenDate(): string {
    let d = data.bounds.earliest;
    for (let i = 0; i < 400 && d <= data.bounds.latest; i += 1) {
      if (canInquireFor(d, data.settings)) return d;
      d = addDays(d, 1);
    }
    return data.bounds.earliest;
  }

  // ---- フォーム ----
  type FormState = {
    groupName: string;
    roomCode: string;
    planKey: string;
    checkIn: string;
    nights: number;
    adults: number;
    roomCount: number;
    roomAdults: number[];
    payment: string;
    transport: GroupChoiceInput;
    dinner: GroupChoiceInput;
    note: string;
    booker: PartnerBooker;
  };
  function initialForm(): FormState {
    const room = data.catalog[0];
    const plan = room?.plans[0];
    const adults = 2;
    const roomCount = suggestRoomCount(adults, room?.capacityMax ?? 2);
    return {
      groupName: '',
      roomCode: room?.code ?? '',
      planKey: plan ? planKeyOf(plan.planCode, plan.planName) : '',
      checkIn: firstOpenDate(),
      nights: 1,
      adults,
      roomCount,
      roomAdults: splitAdultsEvenly(adults, roomCount),
      payment: data.paymentChoices.length === 1 ? data.paymentChoices[0].id : '',
      transport: { choice: '', other: '' },
      dinner: { choice: '', other: '' },
      note: '',
      booker: normalizeBooker(data.booker)
    };
  }
  let f = $state<FormState>(initialForm());

  const room = $derived(catalog.find((r) => r.code === f.roomCode) ?? null);
  const plan = $derived(room?.plans.find((p) => planKeyOf(p.planCode, p.planName) === f.planKey) ?? null);
  const cap = $derived(room?.capacityMax ?? 6);
  const roomSum = $derived(f.roomAdults.reduce((s, a) => s + (Number(a) || 0), 0));
  const deadlineOk = $derived(!ISO.test(f.checkIn) || canInquireFor(f.checkIn, settings));

  function changeRoom(code: string) {
    f.roomCode = code;
    const r = catalog.find((x) => x.code === code);
    if (!r) return;
    // 同じプランがあればそのまま。無ければ最初のプラン
    if (!r.plans.some((p) => planKeyOf(p.planCode, p.planName) === f.planKey)) f.planKey = r.plans[0] ? planKeyOf(r.plans[0].planCode, r.plans[0].planName) : '';
    // 定員を超える部屋が出るなら室数を目安に戻す
    if (f.roomAdults.some((a) => a > r.capacityMax)) {
      f.roomCount = suggestRoomCount(f.adults, r.capacityMax);
      f.roomAdults = splitAdultsEvenly(f.adults, f.roomCount);
    }
  }
  // 大人の人数を入れたら室数を目安（人数 ÷ 定員の切り上げ）にし、部屋ごとの人数を均等割
  function changeAdults(n: number) {
    f.adults = Math.max(0, Math.round(n) || 0);
    if (f.adults < 1) return;
    f.roomCount = Math.min(settings.groupMaxRooms, suggestRoomCount(f.adults, cap));
    f.roomAdults = splitAdultsEvenly(f.adults, f.roomCount);
  }
  function changeRoomCount(n: number) {
    f.roomCount = Math.max(0, Math.round(n) || 0);
    if (f.roomCount < 1) return;
    f.roomAdults = splitAdultsEvenly(f.adults, f.roomCount);
  }
  let roomsOpen = $state(false);

  /** フォームの内容を照会1件にする */
  function itemOfForm(): GroupDraftItem {
    return normalizeGroupDraftItem({
      facilityId: data.facility.id,
      groupName: f.groupName,
      roomCode: f.roomCode,
      planCode: plan?.planCode ?? '',
      planName: plan?.planName ?? '',
      checkIn: f.checkIn,
      nights: f.nights,
      adults: f.adults,
      rooms: f.roomAdults.map((a) => ({ adults: a })),
      paymentOption: f.payment,
      transport: f.transport,
      dinnerTime: f.dinner,
      note: f.note,
      booker: f.booker
    });
  }

  /** 照会1件をフォームに戻す（複製・前回の内容・同じ条件でもう一度） */
  function fillForm(it: GroupDraftItem, opts: { keepGroupName?: boolean } = {}) {
    const r = catalog.find((x) => x.code === it.roomCode);
    const p = r?.plans.find((x) => x.planCode === it.planCode && x.planName === it.planName) ?? r?.plans.find((x) => x.planCode === it.planCode);
    f = {
      groupName: opts.keepGroupName ? f.groupName : it.groupName,
      roomCode: r ? r.code : f.roomCode,
      planKey: p ? planKeyOf(p.planCode, p.planName) : r ? (r.plans[0] ? planKeyOf(r.plans[0].planCode, r.plans[0].planName) : '') : f.planKey,
      checkIn: ISO.test(it.checkIn) ? it.checkIn : f.checkIn,
      nights: it.nights >= 1 ? it.nights : 1,
      adults: it.adults,
      roomCount: it.rooms.length,
      roomAdults: it.rooms.map((x) => x.adults),
      payment: paymentIds.includes(it.paymentOption) ? it.paymentOption : f.payment,
      transport: { ...it.transport },
      dinner: { ...it.dinnerTime },
      note: it.note,
      booker: it.booker.name || it.booker.email ? normalizeBooker(it.booker) : f.booker
    };
    notice = r ? '' : 'お部屋・プランがこの施設に無いため、選び直してください。';
  }
  let notice = $state('');

  // ---- 自動計算額（/book/quote・400ms のデバウンス） ----
  type QuoteBody = { facilityId: string; roomCode: string; planCode: string; planName: string; checkIn: string; nights: number; rooms: { adults: number }[] };
  const quoteBody = $derived.by((): QuoteBody | null => {
    if (!plan || !ISO.test(f.checkIn) || f.nights < 1 || f.roomAdults.length < 1 || f.roomAdults.some((a) => !(a >= 1))) return null;
    return { facilityId: data.facility.id, roomCode: f.roomCode, planCode: plan.planCode, planName: plan.planName, checkIn: f.checkIn, nights: f.nights, rooms: f.roomAdults.map((a) => ({ adults: a })) };
  });
  const pending = $derived(
    !room ? 'お部屋を選んでください。' : !plan ? 'プラン（宿泊条件）を選んでください。' : !ISO.test(f.checkIn) ? 'チェックイン日を入れてください。' : !quoteBody ? '人数・室数を入れてください。' : ''
  );
  let quote = $state<GroupQuoteView | null>(null);
  let quoteKey = $state('');
  let quoting = $state(false);
  let seq = 0;

  async function fetchQuote(body: QuoteBody): Promise<GroupQuoteView> {
    try {
      const res = await fetch(`/p/${token}/book/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 401) {
        location.href = `/p/${token}`;
        return { ok: false, message: 'ログインの有効期限が切れました。' };
      }
      if (!res.ok) return { ok: false, message: res.status === 403 ? '現在ご予約・団体のお問い合わせを受け付けていません。' : '料金を計算できませんでした。' };
      const j = (await res.json()) as { quote: GroupQuoteView };
      return j.quote;
    } catch {
      return { ok: false, message: '料金を計算できませんでした。通信状況をご確認ください。' };
    }
  }
  $effect(() => {
    const body = quoteBody;
    if (!body) {
      seq += 1;
      quote = null;
      quoting = false;
      return;
    }
    const key = JSON.stringify(body);
    const mine = ++seq;
    quoting = true;
    const t = setTimeout(async () => {
      const q = await fetchQuote(body);
      if (mine === seq) {
        quote = q;
        quoteKey = key;
        quoting = false;
      }
    }, 400);
    return () => clearTimeout(t);
  });

  const quoteSnapshotOf = (q: GroupQuoteView | null): Pick<GroupDraftEntry, 'quote' | 'quoteNote'> =>
    !q ? { quote: null, quoteNote: '' } : q.ok ? { quote: { total: q.total, bathTax: q.bathTax }, quoteNote: '' } : { quote: null, quoteNote: GROUP_QUOTE_STATUS_TEXT[groupQuoteStatusOf(q.message)] || q.message };

  // ---- 束 ----
  let entries = $state<GroupDraftEntry[]>([]);
  let lastAddedKey = $state<string | null>(null);
  let formErrors = $state<string[]>([]);
  let serverErrors = $state<Record<number, string[]>>({});
  let serverWarnings = $state<Record<number, string[]>>({});
  let globalError = $state('');
  let dateEl = $state<HTMLInputElement | null>(null);
  let groupNameEl = $state<HTMLInputElement | null>(null);

  const capacityOf = (it: GroupDraftItem) =>
    it.facilityId === data.facility.id ? (catalog.find((r) => r.code === it.roomCode)?.capacityMax ?? null) : 6; // 別の施設の行はサーバで確かめる
  // 束の検証（画面でも先にかける。サーバでもう一度かける）
  const check = $derived(
    entries.length
      ? validateGroupDraft(
          // 保存から読み戻した行は予約者が空（localStorage に残さない）→ 入力欄の予約者で補う
          entries.map((e) => withDraftBooker(e.item, f.booker)),
          settings,
          { bounds: data.bounds, capacityOf, paymentIds }
        )
      : { ok: true, errors: [], warnings: [] }
  );
  const byIndex = (issues: { index: number; message: string }[]) => {
    const out: Record<number, string[]> = {};
    for (const i of issues) if (i.index >= 0) (out[i.index] ??= []).push(i.message);
    return out;
  };
  const rowErrors = $derived.by(() => {
    const local = byIndex(check.errors);
    for (const [k, v] of Object.entries(serverErrors)) (local[Number(k)] ??= []).push(...v);
    return local;
  });
  const rowWarnings = $derived.by(() => {
    const local = byIndex(check.warnings);
    for (const [k, v] of Object.entries(serverWarnings)) (local[Number(k)] ??= []).push(...v);
    return local;
  });
  const batchErrors = $derived(check.errors.filter((e) => e.index < 0).map((e) => e.message));
  const showFacility = $derived(entries.some((e) => e.item.facilityId !== data.facility.id));
  const knownTotal = $derived(entries.reduce((s, e) => s + (e.quote ? e.quote.total + e.quote.bathTax : 0), 0));
  const unknownCount = $derived(entries.filter((e) => !e.quote).length);

  const sortEntries = (list: GroupDraftEntry[]) =>
    [...list].sort((a, b) => a.item.checkIn.localeCompare(b.item.checkIn) || a.item.roomCode.localeCompare(b.item.roomCode));
  function setEntries(list: GroupDraftEntry[]) {
    entries = sortEntries(list);
    serverErrors = {};
    serverWarnings = {};
    globalError = '';
  }

  async function focusDate() {
    await tick();
    dateEl?.focus();
    try {
      dateEl?.showPicker?.();
    } catch {
      // カレンダーを開けないブラウザではフォーカスだけ
    }
  }

  async function addToBatch() {
    if (busy || data.blockReason) return;
    const item = itemOfForm();
    const v = validateGroupDraft([item], settings, { bounds: data.bounds, capacityOf, paymentIds });
    const errs = v.errors.map((e) => e.message);
    if (entries.length >= settings.groupMaxBatch) errs.unshift(`一度に送れるのは ${settings.groupMaxBatch} 件までです。先に送信してください。`);
    if (quote && !quote.ok && groupQuoteStatusOf(quote.message) === 'capacity' && quoteKey === JSON.stringify(quoteBody)) errs.push('1室の人数がお部屋の定員を超えています。');
    formErrors = errs;
    if (errs.length) {
      if (!f.groupName.trim()) groupNameEl?.focus();
      return;
    }
    const fresh = quoteBody && quoteKey === JSON.stringify(quoteBody) && !quoting;
    const entry: GroupDraftEntry = {
      key: newDraftKey(),
      item,
      facilityName: data.facility.name,
      roomName: room?.name ?? item.roomCode,
      planLabel: `${plan?.displayName ?? item.planName}${plan?.mealType ? `（${mealLabel(plan.mealType)}）` : ''}`,
      ...(fresh ? quoteSnapshotOf(quote) : { quote: null, quoteNote: '計算しています…' })
    };
    setEntries([...entries, entry]);
    lastAddedKey = entry.key;
    if (!fresh) void requoteEntry(entry.key);
    await focusDate();
  }

  /** 束の行の自動計算額を取り直す（行の中で日付・室数・人数を直したとき・追加の時点で未計算だったとき） */
  async function requoteEntry(key: string) {
    const e = entries.find((x) => x.key === key);
    if (!e) return;
    const it = e.item;
    const q = await fetchQuote({ facilityId: it.facilityId, roomCode: it.roomCode, planCode: it.planCode, planName: it.planName, checkIn: it.checkIn, nights: it.nights, rooms: it.rooms });
    const now = entries.find((x) => x.key === key);
    // 待っている間に行が変わっていたら捨てる（もう一度取り直しが走っている）
    if (!now || JSON.stringify(now.item) !== JSON.stringify(it)) return;
    entries = entries.map((x) => (x.key === key ? { ...x, ...quoteSnapshotOf(q) } : x));
  }

  function editEntry(index: number, patch: { checkIn?: string; adults?: number; roomCount?: number }) {
    const e = entries[index];
    if (!e) return;
    const it = { ...e.item };
    if (patch.checkIn !== undefined) it.checkIn = patch.checkIn;
    if (patch.adults !== undefined || patch.roomCount !== undefined) {
      const adults = patch.adults ?? it.adults;
      const rooms = patch.roomCount ?? (patch.adults !== undefined && it.facilityId === data.facility.id ? suggestRoomCount(adults, capacityOf(it) ?? 6) : it.rooms.length);
      it.adults = adults;
      it.rooms = splitAdultsEvenly(adults, Math.min(settings.groupMaxRooms, Math.max(1, rooms))).map((a) => ({ adults: a }));
    }
    setEntries(entries.map((x, i) => (i === index ? { ...x, item: it, quote: null, quoteNote: '計算しています…' } : x)));
    void requoteEntry(e.key);
  }
  function removeEntry(index: number) {
    setEntries(entries.filter((_, i) => i !== index));
  }
  async function duplicateEntry(index: number) {
    const e = entries[index];
    if (!e) return;
    fillForm({ ...e.item, checkIn: ISO.test(e.item.checkIn) ? addDays(e.item.checkIn, 1) : e.item.checkIn });
    formErrors = [];
    await focusDate();
  }
  function clearAll() {
    if (!entries.length) return;
    if (!confirm(`束の ${entries.length} 件をすべて消します。よろしいですか？`)) return;
    setEntries([]);
  }

  // キーボード: Ctrl+Enter＝束に追加、Ctrl+D＝日付を変えて複製（フォーカスのある束の行・無ければ最後に追加した行）
  function onKey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (confirmOpen) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      void addToBatch();
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      const row = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-draft-index]');
      const idx = row ? Number(row.dataset.draftIndex) : entries.findIndex((x) => x.key === lastAddedKey);
      if (idx >= 0 && entries[idx]) void duplicateEntry(idx);
      else if (entries.length) void duplicateEntry(entries.length - 1);
      else if (ISO.test(f.checkIn)) {
        f.checkIn = addDays(f.checkIn, 1);
        void focusDate();
      }
    }
  }

  // ---- 下書きの保存（localStorage）・読み込み ----
  let restored = $state(false);
  let skipSave = false;
  onMount(() => {
    const saved = loadGroupDraft(data.draftKey);
    if (saved.entries.length) entries = sortEntries(saved.entries);
    const copy = takeGroupCopy(token);
    if (copy) {
      fillForm(copy);
      notice = notice || '前の照会と同じ条件を入れました。チェックイン日を選び直してください。';
      void focusDate();
    } else if (saved.form && typeof saved.form === 'object') {
      const sf = saved.form as Partial<FormState>;
      fillForm(
        normalizeGroupDraftItem({
          facilityId: data.facility.id,
          groupName: sf.groupName,
          roomCode: sf.roomCode,
          planCode: catalog.flatMap((r) => r.plans).find((p) => planKeyOf(p.planCode, p.planName) === sf.planKey)?.planCode ?? '',
          planName: catalog.flatMap((r) => r.plans).find((p) => planKeyOf(p.planCode, p.planName) === sf.planKey)?.planName ?? '',
          checkIn: sf.checkIn,
          nights: sf.nights,
          adults: sf.adults,
          rooms: (sf.roomAdults ?? []).map((a) => ({ adults: a })),
          paymentOption: sf.payment,
          transport: sf.transport,
          dinnerTime: sf.dinner,
          note: sf.note,
          // 予約者は localStorage に残さない（入力欄の初期値＝アカウントの予約者情報のまま）
          booker: null
        })
      );
      notice = '';
      // 締切を過ぎた日付が残っていたら、選べる最初の日に
      if (!ISO.test(f.checkIn) || f.checkIn < data.bounds.earliest) f.checkIn = firstOpenDate();
    }
    restored = true;
  });
  $effect(() => {
    // 束かフォームが変わるたびに保存（送信の後は保存しない）
    const snapshot = { entries: $state.snapshot(entries), form: $state.snapshot(f) };
    if (!restored || skipSave) return;
    saveGroupDraft(data.draftKey, snapshot.entries, snapshot.form);
  });

  function useLatest() {
    if (!data.latest) return;
    fillForm(data.latest, { keepGroupName: true });
    if (data.latest.facilityId !== data.facility.id) notice = '前回は別の施設の照会でした。お部屋・プランを確かめてください。';
    if (!ISO.test(f.checkIn) || !canInquireFor(f.checkIn, settings)) f.checkIn = firstOpenDate();
    formErrors = [];
    groupNameEl?.focus();
  }

  // ---- まとめて送信 ----
  let confirmOpen = $state(false);
  let busy = $state(false);
  let sendBtn = $state<HTMLButtonElement | null>(null);
  async function openConfirm() {
    if (!entries.length) return;
    if (!check.ok) {
      globalError = '束に直すところがあります（赤い行）。直してから送信してください。';
      return;
    }
    globalError = '';
    confirmOpen = true;
    await tick();
    sendBtn?.focus();
  }
  async function submitAll() {
    if (busy || !entries.length) return;
    busy = true;
    globalError = '';
    try {
      const res = await fetch(`/p/${token}/group/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: entries.map((e) => withDraftBooker(e.item, f.booker)) })
      });
      if (res.status === 401) {
        location.href = `/p/${token}`;
        return;
      }
      const j = (await res.json().catch(() => null)) as
        | { ok: true; batchId: string }
        | { ok: false; message?: string; errors?: { index: number; message: string }[]; warnings?: { index: number; message: string }[] }
        | null;
      if (res.ok && j?.ok) {
        skipSave = true;
        clearGroupDraft(data.draftKey);
        await goto(`/p/${token}/group?done=batch`);
        return;
      }
      const errs = j && !j.ok ? (j.errors ?? []) : [];
      serverErrors = byIndex(errs);
      serverWarnings = byIndex(j && !j.ok ? (j.warnings ?? []) : []);
      const whole = errs.filter((e) => e.index < 0).map((e) => e.message);
      globalError =
        (j && !j.ok && j.message) ||
        whole.join('\n') ||
        (res.status === 403 ? 'この画面からは送信できません（確認モード・公開停止など）。' : '送信できませんでした。時間をおいてお試しください。');
      confirmOpen = false;
    } catch {
      globalError = '送信できませんでした。通信状況をご確認ください（束は残っています）。';
      confirmOpen = false;
    } finally {
      busy = false;
    }
  }

  const input =
    'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)] disabled:bg-stone-50';
  const label = 'mb-1 block text-sm font-medium';
</script>

<svelte:window onkeydown={onKey} />

<svelte:head>
  <title>{partnerTitle(data.portal, '団体予約の照会')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#snippet choiceField(title: string, value: GroupChoiceInput, choices: string[], id: string)}
  <div>
    <label for={id} class={label}>{title}</label>
    <select id={id} bind:value={value.choice} class={input}>
      <option value="">（指定なし）</option>
      {#each choices as c (c)}<option value={c}>{c}</option>{/each}
      <option value={OTHER}>その他（自由記入）</option>
    </select>
    {#if value.choice === OTHER}
      <input bind:value={value.other} maxlength="60" placeholder="内容を入力" aria-label={`${title}（その他）`} class={`${input} mt-2`} />
    {/if}
  </div>
{/snippet}

<main class="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:pb-10">
  <a href={`/p/${token}/group`} class="text-sm text-stone-500 hover:text-brand-900">← 団体予約の一覧</a>
  <div class="mt-2 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h2 class="text-2xl font-bold">団体予約の照会</h2>
      <p class="mt-1 text-sm text-stone-500">条件を入れて「束に追加」し、まとめて送信します。宿が受けられるか（必要なら料金）をご回答し、承諾いただくとご予約になります。</p>
    </div>
    {#if data.latest && !data.blockReason}
      <button type="button" onclick={useLatest} class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm hover:border-[var(--pt-accent)]">前回の内容を使う</button>
    {/if}
  </div>

  {#if data.portal.preview}
    <p class="mt-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900">確認モードです。入力と自動計算は試せますが、送信はできません。</p>
  {/if}

  {#if data.blockReason}
    <p class="mt-6 rounded-xl border border-amber-700/30 bg-amber-700/5 px-4 py-6 text-amber-800">{data.blockReason}</p>
  {:else if catalog.length === 0}
    <p class="mt-6 rounded-xl border border-dashed border-stone-300 px-4 py-10 text-center text-stone-500">ご案内できるお部屋・プランがありません。宿へお問い合わせください。</p>
  {:else}
    <div class="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_25rem]">
      <!-- 左: フォーム（Enter / Ctrl+Enter で束に追加） -->
      <div class="min-w-0 space-y-5">
        <form
          onsubmit={(e) => {
            e.preventDefault();
            void addToBatch();
          }}
          class="space-y-5 rounded-xl border border-stone-200 bg-white p-4 sm:p-6"
          aria-label="照会の条件"
        >
          {#if notice}<p class="rounded-lg bg-[var(--pt-accent-soft)] px-3 py-2 text-sm text-[var(--pt-accent)]" role="status">{notice}</p>{/if}
          <label class="block">
            <span class={label}>団体名 <em class="req">必須</em></span>
            <input bind:this={groupNameEl} bind:value={f.groupName} maxlength={data.limits.groupName} placeholder="例: 270413精華旅行社" class={input} />
          </label>
          <p class="text-sm text-stone-600">施設: <span class="font-medium text-brand-900">{data.facility.name}</span>{#if (data.portal.facilityChoices?.length ?? 0) >= 2}<span class="ml-1 text-xs text-stone-500">（施設は画面上部の切替で変えます）</span>{/if}</p>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class={label}>部屋タイプ <em class="req">必須</em></span>
              <select value={f.roomCode} onchange={(e) => changeRoom(e.currentTarget.value)} class={input}>
                {#each catalog as r (r.code)}<option value={r.code}>{r.name}（定員{r.capacityMax}名）</option>{/each}
              </select>
            </label>
            <label class="block">
              <span class={label}>プラン（宿泊条件） <em class="req">必須</em></span>
              <select bind:value={f.planKey} class={input}>
                {#each room?.plans ?? [] as p (planKeyOf(p.planCode, p.planName))}
                  <option value={planKeyOf(p.planCode, p.planName)}>{p.displayName}{p.mealType ? `（${mealLabel(p.mealType)}）` : ''}{p.minPerPerson ? ` 1名あたり ${yen(p.minPerPerson)}〜` : ''}</option>
                {/each}
              </select>
            </label>
          </div>

          <div class="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <label class="block">
              <span class={label}>チェックイン日 <em class="req">必須</em></span>
              <input bind:this={dateEl} type="date" bind:value={f.checkIn} min={data.bounds.earliest} max={data.bounds.latest} class={input} />
              <span class="mt-1 block text-xs text-stone-500">{ISO.test(f.checkIn) ? describeGroupStay(f.checkIn, f.nights) : ''}・照会は{data.deadlineText}</span>
            </label>
            <label class="block">
              <span class={label}>泊数</span>
              <select bind:value={f.nights} class={input}>
                {#each Array.from({ length: settings.groupMaxNights }, (_, i) => i + 1) as n (n)}<option value={n}>{n}泊</option>{/each}
              </select>
            </label>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class={label}>大人の人数 <em class="req">必須</em></span>
              <span class="flex items-center gap-2">
                <input type="number" min="1" max={settings.groupMaxRooms * cap} value={f.adults} oninput={(e) => changeAdults(Number(e.currentTarget.value))} class={`${input} tabular-nums`} />
                <span class="shrink-0">名</span>
              </span>
            </label>
            <label class="block">
              <span class={label}>客室数 <em class="req">必須</em></span>
              <span class="flex items-center gap-2">
                <input type="number" min="1" max={settings.groupMaxRooms} value={f.roomCount} oninput={(e) => changeRoomCount(Number(e.currentTarget.value))} class={`${input} tabular-nums`} />
                <span class="shrink-0">室</span>
              </span>
              <span class="mt-1 block text-xs text-stone-500">人数から目安を入れます（定員{cap}名・最大{settings.groupMaxRooms}室）</span>
            </label>
          </div>

          <div class="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2.5">
            <button type="button" onclick={() => (roomsOpen = !roomsOpen)} aria-expanded={roomsOpen} class="flex w-full items-center justify-between gap-2 text-left text-sm">
              <span>部屋ごとの人数: <span class="font-medium">{f.roomAdults.length ? describeRoomAdults(f.roomAdults.map((a) => ({ adults: a }))) : '—'}</span>{#if roomSum !== f.adults}<span class="ml-2 text-rose-700">合計 {roomSum}名（大人{f.adults}名と合いません）</span>{/if}</span>
              <span class="shrink-0 text-xs text-stone-500">{roomsOpen ? '閉じる ▲' : '直す ▼'}</span>
            </button>
            {#if roomsOpen}
              <div class="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                {#each f.roomAdults as _, i (i)}
                  <label class="block text-xs">
                    <span class="mb-0.5 block text-stone-500">{i + 1}室目</span>
                    <select bind:value={f.roomAdults[i]} class={`${input} px-2 py-1 text-sm`}>
                      {#each Array.from({ length: cap }, (_, k) => k + 1) as n (n)}<option value={n}>{n}名</option>{/each}
                    </select>
                  </label>
                {/each}
              </div>
            {/if}
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            {@render choiceField('夕食開始時間', f.dinner, settings.groupDinnerTimeChoices, 'g-dinner')}
            <label class="block">
              <span class={label}>お支払方法 <em class="req">必須</em></span>
              {#if data.paymentChoices.length === 1}
                <span class="block rounded-md border border-stone-200 bg-stone-50 px-3 py-2">{data.paymentChoices[0].label}</span>
              {:else}
                <select bind:value={f.payment} class={input}>
                  <option value="">選んでください</option>
                  {#each data.paymentChoices as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
                </select>
              {/if}
            </label>
            {@render choiceField('交通機関', f.transport, settings.groupTransportChoices, 'g-transport')}
          </div>

          <label class="block">
            <span class={label}>備考</span>
            <textarea bind:value={f.note} rows="2" maxlength={data.limits.note} placeholder="お子様・添い寝・食事のご要望など" class={input}></textarea>
          </label>

          <fieldset class="rounded-lg border border-stone-200 p-3 sm:p-4">
            <legend class="px-1 text-sm font-bold">ご予約者（ご担当者）</legend>
            <div class="grid gap-3 sm:grid-cols-2">
              <label class="block"><span class={label}>お名前 <em class="req">必須</em></span><input bind:value={f.booker.name} maxlength="60" autocomplete="name" class={input} /></label>
              <label class="block"><span class={label}>部署</span><input bind:value={f.booker.department} maxlength="60" autocomplete="organization-title" class={input} /></label>
              <label class="block"><span class={label}>電話番号 <em class="req">必須</em></span><input bind:value={f.booker.phone} type="tel" maxlength="20" placeholder="03-1234-5678" autocomplete="tel" class={input} /></label>
              <label class="block"><span class={label}>メールアドレス <em class="req">必須</em></span><input bind:value={f.booker.email} type="email" maxlength="254" autocomplete="email" class={input} /></label>
            </div>
            <p class="mt-2 text-xs text-stone-500">宿からの回答・予約確認のご連絡先になります。電話番号は団体のご予約の連絡先として宿にお伝えします。</p>
          </fieldset>

          {#if formErrors.length}
            <ul class="rounded-lg border border-rose-700/30 bg-rose-700/5 px-4 py-2.5 text-sm text-rose-700" role="alert">
              {#each formErrors as m}<li>{m}</li>{/each}
            </ul>
          {/if}
          <div class="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || !deadlineOk} class="rounded-lg bg-brand-800 px-6 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-50">束に追加</button>
            <span class="text-xs text-stone-500">Enter / Ctrl+Enter で追加。条件は残り、チェックイン日の欄に移ります。Ctrl+D で日付を +1 日して複製。</span>
          </div>
        </form>

        <PartnerGroupQuoteCard {quote} {quoting} {pending} roomCount={f.roomAdults.length} showInventory={data.showInventory} {deadlineOk} deadlineText={data.deadlineText} />
      </div>

      <!-- 右: 送る照会の束（スマホでは下に・下端のバーから送信） -->
      <aside id="group-batch" class="min-w-0 lg:sticky lg:top-[calc(var(--portal-header-h,6rem)+1rem)] lg:self-start" aria-label="送る照会の束">
        <div class="rounded-xl border border-stone-200 bg-stone-100/60 p-3 sm:p-4">
          <div class="mb-3 flex items-baseline justify-between gap-2">
            <h3 class="font-bold">送る照会の束 <span class="tabular-nums text-stone-500">{entries.length}件</span><span class="ml-1 text-xs font-normal text-stone-500">（最大{settings.groupMaxBatch}件）</span></h3>
            {#if entries.length}<button type="button" onclick={clearAll} class="text-xs text-stone-500 hover:text-rose-700">すべて消す</button>{/if}
          </div>
          <div class="lg:max-h-[calc(100vh-var(--portal-header-h,6rem)-14rem)] lg:overflow-y-auto">
            <PartnerGroupDraftList
              {entries}
              errors={rowErrors}
              warnings={rowWarnings}
              maxRooms={settings.groupMaxRooms}
              maxNights={settings.groupMaxNights}
              {showFacility}
              disabled={busy}
              onedit={editEntry}
              onremove={removeEntry}
              onduplicate={(i) => void duplicateEntry(i)}
            />
          </div>
          {#each batchErrors as m}<p class="mt-2 text-sm text-rose-700" role="alert">{m}</p>{/each}
          {#if globalError}<p class="mt-2 whitespace-pre-line rounded-lg bg-rose-700/5 px-3 py-2 text-sm text-rose-700" role="alert">{globalError}</p>{/if}
          {#if entries.length}
            <p class="mt-3 text-right text-sm">自動計算の合計 <span class="font-bold tabular-nums">{yen(knownTotal)}</span>{#if unknownCount}<span class="block text-xs text-stone-500">ほか {unknownCount} 件は宿からの回答でご案内</span>{/if}</p>
          {/if}
          <button type="button" onclick={openConfirm} disabled={!entries.length || busy || data.portal.preview} class="primary mt-3 hidden w-full lg:block">{entries.length ? `${entries.length} 件をまとめて送信` : 'まとめて送信'}</button>
          <p class="mt-2 text-xs text-stone-500">束はこのブラウザに自動で保存されます（送信すると消えます）。</p>
        </div>
      </aside>
    </div>

    <!-- スマホ: 下端のバー（束の件数・送信） -->
    <div class="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:hidden">
      <div class="mx-auto flex max-w-6xl items-center gap-3">
        <a href="#group-batch" class="min-w-0 flex-1 truncate text-sm">束 <span class="font-bold tabular-nums">{entries.length}件</span>{#if entries.length} ・ <span class="tabular-nums">{yen(knownTotal)}</span>{/if}</a>
        <button type="button" onclick={openConfirm} disabled={!entries.length || busy || data.portal.preview} class="primary shrink-0 px-4 py-2 text-sm">まとめて送信</button>
      </div>
    </div>
  {/if}
</main>

{#if confirmOpen}
  <!-- 送信の確認（表で全件・合計額） -->
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="presentation" onclick={(e) => e.target === e.currentTarget && !busy && (confirmOpen = false)} onkeydown={(e) => e.key === 'Escape' && !busy && (confirmOpen = false)}>
    <div class="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="g-confirm-title">
      <h3 id="g-confirm-title" class="text-lg font-bold">{entries.length} 件の照会を送信します</h3>
      <p class="mt-1 text-sm text-stone-500">宿へ届き、回答をメールでお知らせします。送信の時点ではまだご予約ではありません（承諾で確定）。</p>
      <ol class="mt-4 divide-y divide-stone-200 border-y border-stone-200 text-sm">
        {#each entries as e, i (e.key)}
          <li class="flex flex-wrap items-start justify-between gap-x-3 gap-y-0.5 py-2">
            <div class="min-w-0">
              <p class="font-medium"><span class="mr-1 tabular-nums text-stone-500">{i + 1}.</span>{e.item.groupName} ・ {describeGroupStay(e.item.checkIn, e.item.nights)}</p>
              <p class="text-stone-600">{showFacility ? `${e.facilityName} ・ ` : ''}{e.roomName} × {e.item.rooms.length}室 ・ 大人{e.item.adults}名（{describeRoomAdults(e.item.rooms)}）・ {e.planLabel}</p>
            </div>
            <p class="ml-auto text-right tabular-nums">{e.quote ? yen(e.quote.total + e.quote.bathTax) : '宿が回答'}</p>
          </li>
        {/each}
      </ol>
      <p class="mt-3 text-right">自動計算の合計 <span class="text-lg font-bold tabular-nums">{yen(knownTotal)}</span>{#if unknownCount}<span class="block text-xs text-stone-500">ほか {unknownCount} 件は宿からの回答でご案内します</span>{/if}</p>
      <div class="mt-5 grid gap-2 sm:grid-cols-2">
        <button type="button" onclick={() => (confirmOpen = false)} disabled={busy} class="rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50">戻って直す</button>
        <button bind:this={sendBtn} type="button" onclick={submitAll} disabled={busy} class="primary">{busy ? '送信しています…' : `${entries.length} 件を送信する`}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .req {
    margin-left: 0.25rem;
    border-radius: 0.25rem;
    background: color-mix(in srgb, var(--color-rose-700, #be123c) 12%, transparent);
    padding: 0 0.3rem;
    font-size: 0.7rem;
    font-style: normal;
    color: var(--color-rose-700, #be123c);
  }
  /* Book の予約ボタン（rounded-lg・accent-600 → hover accent-500）に合わせる */
  .primary {
    border-radius: 0.5rem;
    background: #16a34a;
    padding: 0.75rem 1rem;
    font-weight: 500;
    color: #fff;
    transition: background-color 0.15s;
  }
  .primary:hover:not(:disabled) {
    background: #15803d;
  }
  .primary:disabled {
    opacity: 0.4;
  }
</style>
