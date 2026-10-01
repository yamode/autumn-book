<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { beforeNavigate, goto } from '$app/navigation';
  import { askConfirm } from '$lib/components/admin/confirm-dialog.svelte';
  import {
    ADVANCE_PLAN_CODE,
    decidePartnerPrice,
    describeAdjust,
    normalizePartnerPricing,
    validatePartnerPricing,
    WEEKDAY_LABELS,
    type PartnerPricing,
    type PartnerRateRule
  } from '$lib/partner-pricing';
  import {
    CUSTOM_PAYMENT_PREFIX,
    isStripePaymentOption,
    MAX_CUSTOM_PAYMENT_OPTIONS,
    MAX_PARTNER_PERKS,
    PARTNER_PAYMENT_OPTIONS,
    type PartnerBookingSettings
  } from '$lib/partner-booking';
  import { isLastDayOfMonth, periodLabel } from '$lib/partner-invoice';
  import type { PageData } from './$types';

  type FormResult = {
    message?: string;
    saved?: boolean;
    urlRegenerated?: boolean;
    accountUpdated?: boolean;
    keyRevoked?: boolean;
    bookingCancelled?: string;
    chargeResult?: { status: 'paid' | 'failed' | 'skipped'; message?: string };
    apiKey?: string;
    issued?: { loginId: string; setupUrl: string; emailSent: boolean | null; emailReason: string | null };
    memorandumSaved?: boolean;
    documentUploaded?: string;
    documentDeleted?: boolean;
    invoiceResult?: { kind: 'issued' | 'existing' | 'empty' | 'sent' | 'voided' | 'error'; message: string };
  };
  let { data, form }: { data: PageData; form?: FormResult } = $props();

  // 操作（保存・発行・取消など）は管理者だけ。スタッフは閲覧のみ（サーバー側でも同じ線引きで弾く）
  const canEdit = $derived(data.canEdit);

  // ---- 設定フォーム（保存するまで手元で編集） ----
  // 画面で編集するための手元コピー（保存後の再読込で上書きしない）。
  const initial = untrack(() => data.partner);
  let settings = $state({
    name: initial.name,
    kind: initial.kind,
    contactName: initial.contactName ?? '',
    contactEmail: initial.contactEmail ?? '',
    isActive: initial.isActive,
    validFrom: initial.validFrom ?? '',
    validUntil: initial.validUntil ?? '',
    maxDaysAhead: initial.maxDaysAhead,
    showInventory: initial.showInventory,
    includeAdvance: initial.includeAdvance,
    note: initial.note ?? '',
    bookingEnabled: initial.bookingEnabled
  });
  let pricing = $state<PartnerPricing>(structuredClone(initial.pricing));
  const pricingJson = $derived(JSON.stringify(pricing));
  // 予約受付の設定（受付ルール・追加オプション・通知先）。通知先は画面では改行区切りの文字で持つ。
  let booking = $state<PartnerBookingSettings>(structuredClone(initial.bookingSettings));
  let notifyText = $state(initial.bookingSettings.notifyEmails.join('\n'));
  const bookingJson = $derived(
    JSON.stringify({ ...booking, notifyEmails: notifyText.split(/[\s,、]+/).map((e) => e.trim()).filter(Boolean) })
  );
  // 支払方法の並びは 固定の3種 → 自由入力（定義の順）。サーバの normalize と同じ並びにして、未保存の差分が出ないようにする
  function togglePayment(id: string) {
    const order = [...PARTNER_PAYMENT_OPTIONS.map((o) => o.id as string), ...booking.customPaymentOptions.map((o) => o.id)];
    booking.paymentOptions = booking.paymentOptions.includes(id)
      ? booking.paymentOptions.filter((x) => x !== id)
      : order.filter((x) => x === id || booking.paymentOptions.includes(x));
  }
  // 自由入力の支払方法（最大5）。追加すると選べる状態（チェックオン）にする
  function addCustomPayment() {
    if (booking.customPaymentOptions.length >= MAX_CUSTOM_PAYMENT_OPTIONS) return;
    const id = `${CUSTOM_PAYMENT_PREFIX}${crypto.randomUUID().slice(0, 8)}`;
    booking.customPaymentOptions = [...booking.customPaymentOptions, { id, label: '', note: '', billable: false }];
    togglePayment(id);
  }
  function removeCustomPayment(i: number) {
    const id = booking.customPaymentOptions[i]?.id;
    booking.customPaymentOptions = booking.customPaymentOptions.filter((_, k) => k !== i);
    booking.paymentOptions = booking.paymentOptions.filter((x) => x !== id);
  }
  // 取引先特典（最大10）
  function addPerk() {
    if (booking.perks.length >= MAX_PARTNER_PERKS) return;
    booking.perks = [...booking.perks, { id: `perk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: '', description: '', planCodes: [] }];
  }
  function removePerk(i: number) {
    booking.perks = booking.perks.filter((_, k) => k !== i);
  }
  // 特典の対象プランの選択肢: プレビュー由来のプラン＋保存済みの特典にしか無いコード
  const perkPlanOptions = $derived.by(() => {
    const list = data.planOptions.map((p) => ({ code: p.code, label: p.label }));
    const known = new Set(list.map((p) => p.code));
    for (const perk of booking.perks) {
      for (const code of perk.planCodes) {
        if (!known.has(code)) {
          known.add(code);
          list.push({ code, label: code });
        }
      }
    }
    return list;
  });
  function addOption() {
    booking.options = [...booking.options, { id: `o${Date.now().toString(36)}`, label: '', type: 'check', choices: [], required: false }];
  }
  function removeOption(i: number) {
    booking.options = booking.options.filter((_, k) => k !== i);
  }
  let bookingFilter = $state<'upcoming' | 'all'>('upcoming');
  let cancelTarget = $state<string | null>(null);
  const todayIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const shownBookings = $derived(
    bookingFilter === 'upcoming' ? data.bookings.filter((b) => b.status === 'confirmed' && b.checkIn >= todayIso) : data.bookings
  );

  // ---- 保存状態（未保存の変更・保存中・保存結果） ----
  const snapshotOf = () => JSON.stringify({ settings, pricing, bookingJson });
  let savedSnapshot = $state(untrack(snapshotOf));
  const dirty = $derived(snapshotOf() !== savedSnapshot);
  let saving = $state(false);
  let saveError = $state('');
  let justSaved = $state(false);
  let justSavedTimer: ReturnType<typeof setTimeout> | undefined;
  // 画面上部のお知らせは、保存以外の操作（URL再発行・ログインID発行など）の結果だけに使う。
  // 覚書（memo）・覚書ファイル（doc）は、それぞれの欄に結果を出す。
  let lastSubmit = $state<'save' | 'other' | 'memo' | 'doc' | 'invoice'>('other');

  // ---- 請求書 ----
  let voidTarget = $state<string | null>(null);
  let invoiceBusy = $state(false);
  const invoiceMonth = $derived(data.invoices.period.slice(0, 7));
  // 当月の途中で発行すると、月末までにチェックアウトする予約が載らない（同じ月は1枚だけ）
  const issuingMidMonth = $derived(data.invoices.period === data.invoices.currentPeriod && !isLastDayOfMonth(todayIso));
  function pickInvoiceMonth(v: string) {
    if (!/^\d{4}-\d{2}$/.test(v)) return;
    const url = new URL(window.location.href);
    url.searchParams.set('inv', v);
    goto(url, { keepFocus: true, noScroll: true, replaceState: true });
  }
  const invoiceEnhance = () => {
    lastSubmit = 'invoice';
    invoiceBusy = true;
    return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
      await update({ reset: false });
      invoiceBusy = false;
      voidTarget = null;
    };
  };

  // ---- 覚書（本文） ----
  // 設定フォームとは別のフォームで保存する。未保存の判定は離脱確認（beforeNavigate）だけ共有する。
  const normalizeMemo = (t: string) => t.replace(/\r\n/g, '\n').trim();
  let memoText = $state(untrack(() => data.memorandum.text));
  let memoSaved = $state(untrack(() => normalizeMemo(data.memorandum.text)));
  const memoDirty = $derived(normalizeMemo(memoText) !== memoSaved);
  let memoSaving = $state(false);
  let memoError = $state('');
  let memoJustSaved = $state(false);
  let memoTimer: ReturnType<typeof setTimeout> | undefined;
  let docUploading = $state(false);

  function revertChanges() {
    const snap = JSON.parse(savedSnapshot) as { settings: typeof settings; pricing: PartnerPricing; bookingJson: string };
    settings = snap.settings;
    pricing = snap.pricing;
    const b = JSON.parse(snap.bookingJson) as PartnerBookingSettings;
    booking = b;
    notifyText = b.notifyEmails.join('\n');
    saveError = '';
  }

  // 保存前に、画面で分かる入力ミスを知らせる（該当ルールを開く）。
  function checkBeforeSave(): string | null {
    if (!settings.name.trim()) return '取引先名を入力してください。';
    if (settings.bookingEnabled && !booking.paymentOptions.length) return '予約を受け付けるときは、支払方法を1つ以上選んでください。';
    for (const [i, o] of booking.customPaymentOptions.entries()) {
      if (!o.label.trim()) return `自由入力の支払方法${i + 1}: 名前を入れてください（不要なら削除）。`;
    }
    for (const [i, perk] of booking.perks.entries()) {
      if (!perk.title.trim()) return `取引先特典${i + 1}: タイトルを入れてください（不要なら削除）。`;
    }
    for (const [i, o] of booking.options.entries()) {
      if (!o.label.trim()) return `予約オプション${i + 1}: 項目名を入れてください（不要なら削除）。`;
      if (o.type === 'select' && o.choices.length < 2) return `予約オプション${i + 1}「${o.label}」: 選択肢を2つ以上入れてください。`;
    }
    const err = validatePartnerPricing(normalizePartnerPricing(pricing));
    if (err) {
      const m = err.match(/^ルール(\d+)/);
      if (m) openRule = pricing.rules[Number(m[1]) - 1]?.id ?? openRule;
    }
    return err;
  }

  // 未保存のままページを離れるときは確かめる（プレビューの日付変更など同じページ内の移動は除く）。
  beforeNavigate((nav) => {
    if (!(dirty || memoDirty) || saving || memoSaving) return;
    if (nav.to?.url.pathname === nav.from?.url.pathname) return;
    if (nav.type === 'leave') {
      nav.cancel();
      return;
    }
    if (!confirm('保存していない変更があります。破棄してページを移動しますか？')) nav.cancel();
  });

  const MEAL_TYPES = ['素泊', '朝食', '2食'];
  const GUEST_COUNTS = [1, 2, 3, 4, 5, 6];
  const newRuleId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  function addRule() {
    const rule: PartnerRateRule = {
      id: newRuleId(),
      label: '',
      roomCodes: [],
      planGroupCodes: [],
      mealTypes: [],
      guestCounts: [],
      weekdays: [],
      dateFrom: null,
      dateTo: null,
      action: 'adjust',
      adjustType: 'percent',
      value: -10
    };
    pricing.rules = [...pricing.rules, rule];
    openRule = rule.id;
  }
  function moveRule(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= pricing.rules.length) return;
    const next = [...pricing.rules];
    [next[i], next[j]] = [next[j], next[i]];
    pricing.rules = next;
  }
  function removeRule(i: number) {
    pricing.rules = pricing.rules.filter((_, k) => k !== i);
  }
  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }
  let openRule = $state<string | null>(null);

  const roomName = (code: string) => data.rooms.find((r) => r.code === code)?.name ?? code;
  const ruleProblem = (r: PartnerRateRule) => (r.action === 'adjust' && !r.planGroupCodes.length ? 'プラン未選択' : '');
  const planName = (code: string) =>
    code === ADVANCE_PLAN_CODE ? '先行案内料金' : (data.planOptions.find((p) => p.code === code)?.label ?? code);
  function ruleSummary(r: PartnerRateRule): string {
    const parts: string[] = [];
    parts.push(r.roomCodes.length ? r.roomCodes.map(roomName).join('・') : '全部屋');
    parts.push(r.planGroupCodes.length ? r.planGroupCodes.map(planName).join('・') : r.action === 'adjust' ? 'プラン未選択' : '全プラン');
    if (r.mealTypes.length) parts.push(r.mealTypes.join('・'));
    if (r.guestCounts.length) parts.push(`${r.guestCounts.join('・')}名`);
    if (r.weekdays.length) parts.push(r.weekdays.map((d) => WEEKDAY_LABELS[d]).join(''));
    if (r.dateFrom || r.dateTo) parts.push(`${r.dateFrom ?? ''}〜${r.dateTo ?? ''}`);
    return parts.join(' / ');
  }

  // ---- プレビュー ----
  let previewGuests = $state(2);
  // サーバからは全プランの基準価格（実売）が来るので、編集中（未保存を含む）のルールをここで当てる。
  const previewPricing = $derived(normalizePartnerPricing(pricing));
  const previewRows = $derived.by(() => {
    const rows = new Map<string, { key: string; roomName: string; planName: string; advance: boolean; cells: Record<string, { price: number; base: number }> }>();
    for (const day of data.preview.days) {
      for (const room of day.rooms) {
        for (const plan of room.plans) {
          if (plan.advance && !settings.includeAdvance) continue;
          const base = plan.pricesPerPerson[String(previewGuests)];
          if (base == null) continue;
          const decision = decidePartnerPrice(
            previewPricing,
            { date: day.date, roomCode: room.roomCode, planGroupCode: plan.planCode, mealType: plan.mealType ?? undefined, guestCount: previewGuests },
            base
          );
          if (decision.hidden) continue;
          const key = `${room.roomCode}|${plan.planCode}|${plan.planName}`;
          const row = rows.get(key) ?? { key, roomName: room.roomName, planName: plan.planName, advance: plan.advance, cells: {} };
          row.cells[day.date] = { price: decision.price, base };
          rows.set(key, row);
        }
      }
    }
    return [...rows.values()];
  });
  const dayHead = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return { md: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`, dow: WEEKDAY_LABELS[d.getUTCDay()], dowIdx: d.getUTCDay() };
  };
  const yen = (n: number) => n.toLocaleString('ja-JP');
  const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }) : '—');

  function copy(text: string) {
    navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  const ACTION_LABELS: Record<string, string> = {
    login: 'ログイン',
    login_failed: 'ログイン失敗',
    login_locked: 'ロック中のログイン',
    password_set: 'パスワード設定',
    view: '料金カレンダー閲覧',
    rates: 'API 料金取得',
    logout: 'ログアウト'
  };

  const inputClass = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm disabled:bg-stone-50 disabled:text-stone-500';
  const smallBtn = 'rounded-md border border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-50 disabled:opacity-50';
  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 text-xs transition ${on ? 'border-brand-800 bg-brand-800 text-white' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`;
</script>

<svelte:head><title>{data.partner.name} ｜ 取引先 ｜ 山人管理</title></svelte:head>

<!-- 未保存の離脱確認はこの画面独自の beforeNavigate で行う（レイアウト共通のガードは data-own-unsaved-guard で外す） -->
<div data-own-unsaved-guard>
    <nav class="mb-3 text-xs text-stone-400"><a href="/admin/partners" class="hover:underline">取引先</a> / {data.partner.name}</nav>
    <div class="mb-4">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="text-lg font-bold text-stone-800">{data.partner.name}</h1>
        {#if data.partner.isActive}
          <span class="rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] text-white">公開中</span>
        {:else}
          <span class="rounded-full bg-stone-600 px-2 py-0.5 text-[11px] text-white">公開停止中</span>
        {/if}
        {#if data.partner.bookingOpen}
          <span class="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-800">予約受付中</span>
        {:else}
          <span class="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] text-stone-600">予約受付なし（閲覧のみ）</span>
        {/if}
      </div>
      <p class="mt-0.5 text-xs text-stone-400">{data.kindLabels[data.partner.kind]}・{data.facilityName}{#if !canEdit}・閲覧のみ（編集は管理者だけができます）{/if}</p>
    </div>

    {#if form?.message && lastSubmit === 'other'}
      <p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
    {:else if form?.urlRegenerated}
      <p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">限定URLを再発行しました。旧URLとログイン中の画面は使えなくなりました。新しいURLを取引先へお知らせください。</p>
    {/if}

    <!-- 限定URL -->
    <div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
      <h2 class="text-sm font-bold text-stone-700">限定URL</h2>
      <p class="mt-1 text-xs text-stone-500">この取引先専用のログイン画面です。下で発行したログインIDとパスワードでログインします。</p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <code class="break-all rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs">{data.portalUrl}</code>
        <button type="button" class={smallBtn} onclick={() => copy(data.portalUrl)}>コピー</button>
        {#if canEdit}
          <form
            method="POST"
            action={`?/regenerateUrl`}
            use:enhance={async ({ cancel }) => {
              lastSubmit = 'other';
              if (!(await askConfirm({ message: '限定URLを作り直します。今のURLとログイン中の画面は使えなくなります。', confirmLabel: 'URLを再発行する' }))) cancel();
              return async ({ update }) => update({ reset: false });
            }}
          >
            <button type="submit" class={smallBtn}>URLを再発行</button>
          </form>
        {/if}
      </div>
      {#if !data.partner.isActive}
        <p class="mt-2 text-xs text-amber-700">現在「公開停止」です。取引先はログインできません（下の設定で公開にしてください）。</p>
      {/if}
    </div>

    <!-- 覚書（本文・ファイル） -->
    <div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
      <h2 class="text-sm font-bold text-stone-700">覚書</h2>
      <p class="mt-1 text-xs leading-5 text-stone-500">
        取引条件のまとめ（料金・支払条件・特典・連絡先など）です。<strong class="font-medium text-stone-700">取引先ページの「覚書」にそのまま表示されます</strong>（社内向けのメモは「公開設定」の社内メモへ）。
      </p>
      {#if data.memorandum.error}
        <p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">覚書を読み込めませんでした: {data.memorandum.error}</p>
      {/if}
      <form
        method="POST"
        action={`?/saveMemorandum`}
        use:enhance={() => {
          lastSubmit = 'memo';
          const submitted = normalizeMemo(memoText);
          memoSaving = true;
          memoError = '';
          memoJustSaved = false;
          return async ({ result, update }) => {
            memoSaving = false;
            if (result.type === 'success') {
              memoSaved = submitted;
              memoJustSaved = true;
              clearTimeout(memoTimer);
              memoTimer = setTimeout(() => (memoJustSaved = false), 4000);
            } else if (result.type === 'failure') {
              memoError = String((result.data as { message?: string } | undefined)?.message ?? '保存できませんでした。');
            } else if (result.type === 'error') {
              memoError = '通信状況を確認して、もう一度お試しください。';
            }
            await update({ reset: false });
          };
        }}
        class="mt-3"
      >
        <textarea
          name="memorandum"
          bind:value={memoText}
          rows="8"
          maxlength={data.memorandum.maxLength}
          readonly={!canEdit}
          placeholder={canEdit ? '例: 特別レートは正規料金の10%引き／お支払いは月末締め翌月末銀行振込／チェックイン時に館内利用券1,000円分をお渡し' : 'まだ覚書はありません。'}
          class={`${inputClass} leading-6 read-only:bg-stone-50`}
        ></textarea>
        <div class="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <span class="min-w-0 flex-1">
            {#if memoSaving}<span class="text-stone-500">保存しています…</span>
            {:else if memoError}<span class="font-medium text-rose-700">保存できませんでした: {memoError}</span>
            {:else if memoJustSaved}<span class="font-medium text-emerald-700">✓ 保存しました。取引先ページにもすぐ反映されます。</span>
            {:else if memoDirty}<span class="inline-flex items-center gap-1.5 font-medium"><span class="h-2 w-2 rounded-full bg-amber-500"></span>保存していない変更があります</span>
            {:else}<span class="text-stone-500">最終更新 {dt(data.memorandum.updatedAt)}</span>{/if}
          </span>
          {#if canEdit}
            {#if memoDirty && !memoSaving}
              <button type="button" class={smallBtn} onclick={() => ((memoText = memoSaved), (memoError = ''))}>元に戻す</button>
            {/if}
            <button
              type="submit"
              disabled={memoSaving || !memoDirty}
              class="rounded-lg bg-brand-800 px-4 py-1.5 text-sm text-white transition hover:bg-brand-700 disabled:cursor-default disabled:opacity-40"
            >{memoSaving ? '保存中…' : '覚書を保存'}</button>
          {/if}
        </div>
      </form>

      <h3 class="mt-5 text-xs font-bold text-stone-600">ファイル</h3>
      <p class="mt-0.5 text-[11px] text-stone-500">契約書・見積書などを宿と取引先の双方で保存できます（取引先ページの「覚書」にも出ます）。1ファイル 20MB まで。</p>
      {#if lastSubmit === 'doc' && form?.message}
        <p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
      {:else if lastSubmit === 'doc' && form?.documentUploaded}
        <p class="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">「{form.documentUploaded}」を保存しました。</p>
      {:else if lastSubmit === 'doc' && form?.documentDeleted}
        <p class="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">ファイルを削除しました。</p>
      {/if}
      {#if data.documentsError}
        <p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">ファイルの一覧を読み込めませんでした: {data.documentsError}</p>
      {:else if data.documents.length === 0}
        <p class="mt-2 text-sm text-stone-500">まだファイルはありません。</p>
      {:else}
        <div class="mt-2 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-stone-500">
              <tr><th class="py-1.5 pr-3 font-medium">ファイル</th><th class="pr-3 text-right font-medium">サイズ</th><th class="pr-3 font-medium">保存者</th><th class="pr-3 font-medium">日時</th><th></th></tr>
            </thead>
            <tbody>
              {#each data.documents as d (d.id)}
                <tr class="border-t border-stone-100 align-top">
                  <td class="py-2 pr-3">
                    <a href={`/admin/partners/${data.partner.id}/documents/${d.id}`} target="_blank" rel="noopener" class="break-all text-brand-800 hover:underline">{d.fileName}</a>
                    {#if d.note}<div class="text-[11px] text-stone-500">{d.note}</div>{/if}
                  </td>
                  <td class="py-2 pr-3 text-right text-xs tabular-nums whitespace-nowrap">{d.size}</td>
                  <td class="py-2 pr-3 text-xs">
                    <span class={`mr-1 rounded px-1.5 py-0.5 text-[10px] ${d.byKind === 'partner' ? 'bg-amber-50 text-amber-800' : 'bg-stone-100 text-stone-600'}`}>{d.byKind === 'partner' ? '取引先' : '宿'}</span>
                    <span class={d.byKind === 'partner' ? 'font-mono' : ''}>{d.byLabel}</span>
                  </td>
                  <td class="py-2 pr-3 text-xs whitespace-nowrap">{dt(d.createdAt)}</td>
                  <td class="py-2 text-right">
                    {#if canEdit}
                      <form
                        method="POST"
                        action={`?/deleteDocument`}
                        use:enhance={async ({ cancel }) => {
                          lastSubmit = 'doc';
                          if (!(await askConfirm({ message: `「${d.fileName}」を削除します。取引先ページからも見られなくなります。`, confirmLabel: '削除する' }))) cancel();
                          return async ({ update }) => update({ reset: false });
                        }}
                      >
                        <input type="hidden" name="document_id" value={d.id} />
                        <button type="submit" class={`${smallBtn} hover:text-rose-700`}>削除</button>
                      </form>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      {#if canEdit}
        <form
          method="POST"
          action={`?/uploadDocument`}
          enctype="multipart/form-data"
          use:enhance={() => {
            lastSubmit = 'doc';
            docUploading = true;
            return async ({ update }) => {
              docUploading = false;
              await update();
            };
          }}
          class="mt-3 grid gap-2 border-t border-stone-200 pt-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">ファイル</span>
            <input type="file" name="file" required accept={data.documentAccept} class="block w-full text-xs file:mr-2 file:rounded-md file:border file:border-stone-300 file:bg-white file:px-3 file:py-1 file:text-xs" />
          </label>
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">メモ（任意）</span>
            <input name="note" maxlength="200" placeholder="例: 2026年度 契約書" class={inputClass} autocomplete="off" />
          </label>
          <button type="submit" disabled={docUploading} class="rounded-lg bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50">{docUploading ? '保存中…' : 'ファイルを保存'}</button>
        </form>
      {/if}
    </div>

    <!-- 設定・特別レート -->
    <form
      method="POST"
      action={`?/save`}
      use:enhance={({ cancel }) => {
        lastSubmit = 'save';
        const problem = checkBeforeSave();
        if (problem) {
          saveError = problem;
          cancel();
          return;
        }
        const submitted = snapshotOf();
        saving = true;
        saveError = '';
        justSaved = false;
        return async ({ result, update }) => {
          saving = false;
          if (result.type === 'success') {
            savedSnapshot = submitted;
            justSaved = true;
            clearTimeout(justSavedTimer);
            justSavedTimer = setTimeout(() => (justSaved = false), 4000);
          } else if (result.type === 'failure') {
            saveError = String((result.data as { message?: string } | undefined)?.message ?? '保存できませんでした。');
          } else if (result.type === 'error') {
            saveError = '通信状況を確認して、もう一度お試しください。';
          }
          await update({ reset: false });
        };
      }}
      class="mb-6 rounded-xl border border-stone-200 bg-white p-5"
    >
      <h2 class="mb-3 text-sm font-bold text-stone-700">公開設定</h2>
      <fieldset disabled={!canEdit} class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label class="block">
          <span class="mb-0.5 block text-xs text-stone-500">取引先名</span>
          <input name="name" bind:value={settings.name} required maxlength="120" class={inputClass} />
        </label>
        <label class="block">
          <span class="mb-0.5 block text-xs text-stone-500">種別</span>
          <select name="kind" bind:value={settings.kind} class={inputClass}>
            {#each Object.entries(data.kindLabels) as [value, label]}<option {value}>{label}</option>{/each}
          </select>
        </label>
        <label class="flex cursor-pointer items-center gap-3 self-end rounded-lg border border-stone-200 bg-white px-3 py-2">
          <input type="checkbox" name="is_active" bind:checked={settings.isActive} class="peer sr-only" />
          <span class={`relative h-6 w-11 shrink-0 rounded-full transition ${settings.isActive ? 'bg-emerald-500' : 'bg-stone-300'} peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600`}>
            <span class={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${settings.isActive ? 'left-[22px]' : 'left-0.5'}`}></span>
          </span>
          <span class="text-sm">
            <span class="font-medium">公開</span>
            <span class={`ml-1.5 rounded px-1.5 py-0.5 text-xs font-bold ${settings.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{settings.isActive ? 'オン' : 'オフ'}</span>
            <span class="mt-0.5 block text-[11px] text-stone-500">{settings.isActive ? '取引先がログイン・API取得できます' : '取引先はログインもAPIも使えません'}</span>
          </span>
        </label>
        <label class="block">
          <span class="mb-0.5 block text-xs text-stone-500">担当者名</span>
          <input name="contact_name" bind:value={settings.contactName} maxlength="120" class={inputClass} />
        </label>
        <label class="block">
          <span class="mb-0.5 block text-xs text-stone-500">連絡先メール</span>
          <input name="contact_email" type="email" bind:value={settings.contactEmail} class={inputClass} />
        </label>
        <label class="block">
          <span class="mb-0.5 block text-xs text-stone-500">何日先まで出すか</span>
          <input name="max_days_ahead" type="number" min="1" max="730" bind:value={settings.maxDaysAhead} class={inputClass} />
        </label>
        <label class="block">
          <span class="mb-0.5 block text-xs text-stone-500">公開開始日（空欄 = すぐ）</span>
          <input name="valid_from" type="date" bind:value={settings.validFrom} class={inputClass} />
        </label>
        <label class="block">
          <span class="mb-0.5 block text-xs text-stone-500">公開終了日（空欄 = 無期限）</span>
          <input name="valid_until" type="date" bind:value={settings.validUntil} class={inputClass} />
        </label>
        <div class="flex flex-col justify-end gap-1 pb-1 text-sm">
          <label class="flex items-center gap-2"><input type="checkbox" name="show_inventory" bind:checked={settings.showInventory} />残室数を出す</label>
          <label class="flex items-start gap-2"><input type="checkbox" name="include_advance" bind:checked={settings.includeAdvance} class="mt-1" /><span>先行案内料金も出す<span class="block text-[11px] text-stone-400">料金の元データに無いため、現在は効きません</span></span></label>
        </div>
        <label class="block sm:col-span-2 lg:col-span-3">
          <span class="mb-0.5 block text-xs text-stone-500">社内メモ（取引先には出ません）</span>
          <textarea name="note" bind:value={settings.note} rows="2" maxlength="2000" class={inputClass}></textarea>
        </label>
      </fieldset>

      <h2 class="mb-1 mt-6 text-sm font-bold text-stone-700">特別レート</h2>
      <p class="mb-3 text-xs leading-5 text-stone-500">
        基準は料金マスタの理論値（booking.daily_rates・1名あたり・税込・入湯税別）です。<strong>ルールは上から順に見て、最初に当てはまったもの</strong>で決まります。
        <strong>公開するのは「調整して出す」ルールで指定したプランだけ</strong>で、どのルールにも当てはまらない料金は出しません。
        ％・円はマイナスで値引き（例: -10 = 10%引き、-1000 = 1名1,000円引き）。値引きなしで出すなら「％・0」にします。
      </p>
      <fieldset disabled={!canEdit}>
        {#if pricing.rules.every((r) => r.action !== 'adjust')}
          <p class="rounded-lg border border-dashed border-stone-200 bg-stone-50 p-3 text-sm text-stone-500">
            まだ公開するプランがありません。「＋ ルールを追加」で、出すプランを選んでください。
          </p>
        {/if}

        <div class="mt-3 grid gap-2">
          {#each pricing.rules as rule, i (rule.id)}
            <div class="rounded-lg border border-stone-200 bg-white">
              <div class="flex flex-wrap items-center gap-2 px-3 py-2">
                <span class="text-xs font-semibold text-stone-500">#{i + 1}</span>
                <button type="button" class="min-w-0 flex-1 text-left text-sm" onclick={() => (openRule = openRule === rule.id ? null : rule.id)}>
                  <span class="font-medium">{rule.label || '（名前なし）'}</span>
                  {#if ruleProblem(rule)}<span class="ml-1 rounded bg-rose-50 px-1.5 py-0.5 text-[11px] font-medium text-rose-700">{ruleProblem(rule)}</span>{/if}
                  <span class="ml-2 text-xs text-stone-500">{ruleSummary(rule)}</span>
                  <span class="ml-2 text-xs font-semibold text-brand-800">→ {describeAdjust(rule.action, rule.adjustType, Number(rule.value) || 0)}</span>
                </button>
                <button type="button" class={smallBtn} onclick={() => moveRule(i, -1)} disabled={i === 0} aria-label="上へ">↑</button>
                <button type="button" class={smallBtn} onclick={() => moveRule(i, 1)} disabled={i === pricing.rules.length - 1} aria-label="下へ">↓</button>
                <button type="button" class={smallBtn} onclick={() => removeRule(i)}>削除</button>
              </div>
              {#if openRule === rule.id}
                <div class="grid gap-3 border-t border-stone-200 p-3">
                  <div class="grid gap-3 sm:grid-cols-[1fr_150px_130px_130px]">
                    <label class="block">
                      <span class="mb-0.5 block text-xs text-stone-500">ルール名（任意）</span>
                      <input bind:value={rule.label} maxlength="80" placeholder="例: 繁忙期は割引なし" class={inputClass} />
                    </label>
                    <label class="block">
                      <span class="mb-0.5 block text-xs text-stone-500">扱い</span>
                      <select bind:value={rule.action} class={inputClass}>
                        <option value="adjust">調整して出す</option>
                        <option value="hide">出さない</option>
                      </select>
                    </label>
                    {#if rule.action === 'adjust'}
                      <label class="block">
                        <span class="mb-0.5 block text-xs text-stone-500">調整方法</span>
                        <select bind:value={rule.adjustType} class={inputClass}>
                          <option value="percent">％</option>
                          <option value="amount">円/人</option>
                          <option value="fixed">固定単価</option>
                        </select>
                      </label>
                      <label class="block">
                        <span class="mb-0.5 block text-xs text-stone-500">{rule.adjustType === 'fixed' ? '1名あたり（円）' : '値'}</span>
                        <input type="number" step="any" bind:value={rule.value} class={inputClass} />
                      </label>
                    {/if}
                  </div>
                  <div>
                    <p class="mb-1 text-xs text-stone-500">部屋タイプ（未選択 = すべて）</p>
                    <div class="flex flex-wrap gap-1.5">
                      {#each data.rooms as room}
                        <button type="button" class={chip(rule.roomCodes.includes(room.code))} onclick={() => (rule.roomCodes = toggle(rule.roomCodes, room.code))}>{room.name}</button>
                      {/each}
                    </div>
                  </div>
                  <div>
                    <p class="mb-1 text-xs text-stone-500">
                      {#if rule.action === 'adjust'}プラン（<span class="text-rose-700">必須</span>・選んだプランだけ公開）{:else}プラン（未選択 = すべて）{/if}
                    </p>
                    <div class="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                      <button type="button" class={chip(rule.planGroupCodes.includes(ADVANCE_PLAN_CODE))} onclick={() => (rule.planGroupCodes = toggle(rule.planGroupCodes, ADVANCE_PLAN_CODE))}>先行案内料金（すべて）</button>
                      {#each data.planOptions as plan}
                        <button type="button" class={chip(rule.planGroupCodes.includes(plan.code))} onclick={() => (rule.planGroupCodes = toggle(rule.planGroupCodes, plan.code))}>
                          <span class="font-mono">{plan.code}</span> {plan.label}
                        </button>
                      {/each}
                    </div>
                  </div>
                  <div class="grid gap-3 sm:grid-cols-3">
                    <div>
                      <p class="mb-1 text-xs text-stone-500">食事</p>
                      <div class="flex flex-wrap gap-1.5">
                        {#each MEAL_TYPES as meal}
                          <button type="button" class={chip(rule.mealTypes.includes(meal))} onclick={() => (rule.mealTypes = toggle(rule.mealTypes, meal))}>{meal}</button>
                        {/each}
                      </div>
                    </div>
                    <div>
                      <p class="mb-1 text-xs text-stone-500">人数</p>
                      <div class="flex flex-wrap gap-1.5">
                        {#each GUEST_COUNTS as g}
                          <button type="button" class={chip(rule.guestCounts.includes(g))} onclick={() => (rule.guestCounts = toggle(rule.guestCounts, g).sort((a, b) => a - b))}>{g}名</button>
                        {/each}
                      </div>
                    </div>
                    <div>
                      <p class="mb-1 text-xs text-stone-500">曜日（祝 = 祝日）</p>
                      <div class="flex flex-wrap gap-1.5">
                        {#each WEEKDAY_LABELS as label, d}
                          <button type="button" class={chip(rule.weekdays.includes(d))} onclick={() => (rule.weekdays = toggle(rule.weekdays, d).sort((a, b) => a - b))}>{label}</button>
                        {/each}
                      </div>
                    </div>
                  </div>
                  <div class="grid gap-3 sm:grid-cols-2">
                    <label class="block">
                      <span class="mb-0.5 block text-xs text-stone-500">宿泊日 から</span>
                      <input type="date" value={rule.dateFrom ?? ''} oninput={(e) => (rule.dateFrom = e.currentTarget.value || null)} class={inputClass} />
                    </label>
                    <label class="block">
                      <span class="mb-0.5 block text-xs text-stone-500">宿泊日 まで</span>
                      <input type="date" value={rule.dateTo ?? ''} oninput={(e) => (rule.dateTo = e.currentTarget.value || null)} class={inputClass} />
                    </label>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
          <button type="button" onclick={addRule} class="justify-self-start rounded-md border border-dashed border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50">＋ ルールを追加</button>
        </div>

        <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">端数の単位</span>
            <select bind:value={pricing.roundingUnit} class={inputClass}>
              {#each [1, 10, 100, 1000] as u}<option value={u}>{u}円</option>{/each}
            </select>
          </label>
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">端数処理</span>
            <select bind:value={pricing.roundingMode} class={inputClass}>
              <option value="floor">切り捨て</option>
              <option value="round">四捨五入</option>
              <option value="ceil">切り上げ</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">最低料金（1名1泊・円、空欄 = なし）</span>
            <input
              type="number"
              min="0"
              value={pricing.minPricePerPerson ?? ''}
              oninput={(e) => (pricing.minPricePerPerson = e.currentTarget.value ? Number(e.currentTarget.value) : null)}
              class={inputClass}
            />
          </label>
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">最高料金（1名1泊・円、空欄 = なし）</span>
            <input
              type="number"
              min="0"
              value={pricing.maxPricePerPerson ?? ''}
              oninput={(e) => (pricing.maxPricePerPerson = e.currentTarget.value ? Number(e.currentTarget.value) : null)}
              class={inputClass}
            />
          </label>
        </div>
        <p class="mt-1 text-[11px] text-stone-500">プラン料金がこの範囲を外れるときは、最低・最高料金で上書きして取引先に見せます（端数処理の後）。</p>
        {#if pricing.minPricePerPerson != null && pricing.maxPricePerPerson != null && pricing.minPricePerPerson > pricing.maxPricePerPerson}
          <p class="mt-1 text-xs text-rose-700">最低料金が最高料金を上回っています。</p>
        {/if}
      </fieldset>

      <!-- 予約受付 -->
      <h2 class="mb-1 mt-8 text-sm font-bold text-stone-700">予約受付</h2>
      <p class="mb-3 text-xs leading-5 text-stone-500">
        限定URLの料金カレンダーから、取引先がそのまま予約できます。予約は即時確定し、PMS に「取引先予約（RMS）」として1分ほどで取り込まれます
        （部屋割り・在庫送信も PMS が行います）。空室は確定の瞬間に PMS と同じ規則で数え直すので、売り越しは起きません。
      </p>
      <fieldset disabled={!canEdit} class="grid gap-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="flex cursor-pointer items-center gap-3 self-start rounded-lg border border-stone-200 bg-white px-3 py-2.5">
            <input type="checkbox" name="booking_enabled" bind:checked={settings.bookingEnabled} class="peer sr-only" />
            <span class={`relative h-6 w-11 shrink-0 rounded-full transition ${settings.bookingEnabled ? 'bg-emerald-500' : 'bg-stone-300'} peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600`}>
              <span class={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${settings.bookingEnabled ? 'left-[22px]' : 'left-0.5'}`}></span>
            </span>
            <span class="text-sm">
              <span class="font-medium">予約受付</span>
              <span class={`ml-1.5 rounded px-1.5 py-0.5 text-xs font-bold ${settings.bookingEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{settings.bookingEnabled ? 'オン' : 'オフ'}</span>
              <span class="mt-0.5 block text-[11px] text-stone-500">
                {settings.bookingEnabled ? '取引先の料金パネルに「予約する」が出ます（締切前・空室のある日だけ）' : '取引先は料金を見るだけで、予約はできません'}
              </span>
            </span>
          </label>
          <div>
            <p class="mb-1 text-sm font-medium">支払方法（複数可） {#if settings.bookingEnabled}<span class="text-rose-700">1つ以上必須</span>{/if}</p>
            <div class="grid gap-1.5">
              {#each PARTNER_PAYMENT_OPTIONS as o (o.id)}
                <label class="flex items-start gap-2 text-sm">
                  <input type="checkbox" checked={booking.paymentOptions.includes(o.id)} onchange={() => togglePayment(o.id)} class="mt-0.5" />
                  <span>
                    {o.label}
                    <span class="block text-[11px] text-stone-500">
                      {o.note}{#if isStripePaymentOption(o.id) && !data.onlinePaymentReady}<span class="text-amber-700">（{data.stripeKeyKind === 'publishable' ? 'Stripe のキーが公開可能キー（pk_）です。シークレットキー（sk_）を登録してください' : data.stripeKeyKind === 'webhook_secret' ? 'STRIPE_SECRET_KEY に Webhook の署名シークレット（whsec_）が入っています。2つが逆に登録されていないか確認してください' : data.stripeKeyKind === 'invalid' ? `Stripe のキーの形式が正しくありません（sk_ で始まるシークレットキーを登録してください。登録されている値: ${data.stripeKeyHint}）` : data.stripePublishableIssue ? `${data.stripePublishableIssue}（Stripe の決済を取引先の画面に出せません）` : 'Stripe 接続後に取引先の画面に出ます'}）</span>{:else if isStripePaymentOption(o.id) && data.stripeTestMode}<span class="text-amber-700">（Stripe テストモード: 実際の請求は発生しません）</span>{/if}
                    </span>
                  </span>
                </label>
              {/each}
            </div>
            <!-- 自由入力の支払方法（取引先ごとの契約に合わせた名前。決済は伴わない） -->
            <div class="mt-2 grid gap-1.5 rounded-md border border-stone-200 bg-white p-2.5">
              <p class="text-xs font-medium">自由入力の支払方法 <span class="font-normal text-stone-500">（最大{MAX_CUSTOM_PAYMENT_OPTIONS}つ）</span></p>
              {#each booking.customPaymentOptions as o, i (o.id)}
                <div class="grid gap-1.5 sm:grid-cols-[auto_1fr_1.5fr_auto] sm:items-center">
                  <input
                    type="checkbox"
                    checked={booking.paymentOptions.includes(o.id)}
                    onchange={() => togglePayment(o.id)}
                    aria-label="取引先が選べるようにする"
                    title="取引先が選べるようにする"
                  />
                  <input bind:value={o.label} maxlength="40" required placeholder="名前（例: 現地精算（法人カード））" class={inputClass} />
                  <input bind:value={o.note} maxlength="200" placeholder="説明（任意。取引先の画面に出ます）" class={inputClass} />
                  <button type="button" class={smallBtn} onclick={() => removeCustomPayment(i)}>削除</button>
                  <label class="flex items-center gap-1.5 text-[11px] text-stone-600 sm:col-span-4 sm:pl-6">
                    <input type="checkbox" bind:checked={o.billable} />
                    請求書で精算する（月次の請求書でご請求）
                  </label>
                </div>
              {/each}
              {#if booking.customPaymentOptions.length < MAX_CUSTOM_PAYMENT_OPTIONS}
                <button type="button" onclick={addCustomPayment} class="justify-self-start rounded-md border border-dashed border-stone-300 bg-white px-3 py-1 text-xs hover:bg-stone-50">＋ 支払方法を追加</button>
              {/if}
              <p class="text-[11px] text-stone-500">決済は伴いません。予約はその場で確定し、名前が PMS の支払方法・備考に入ります。チェックを外すと定義は残したまま選べなくなります。「請求書で精算する」にすると、月末の請求書でご請求額に入ります（入れないものは利用明細だけに載ります）。</p>
            </div>
            <p class="mt-1 text-[11px] text-stone-500">複数選んだときは、取引先が予約時に選びます。選ばれた支払方法は PMS の予約・備考に入ります。</p>
            {#if booking.paymentOptions.includes('online')}
              <div class="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-stone-50 px-2.5 py-2 text-sm">
                <span class="text-xs font-medium">予約時決済の割引</span>
                <select bind:value={booking.prepayDiscount.type} class="rounded-md border border-stone-300 bg-white px-2 py-1 text-xs">
                  <option value="none">なし</option>
                  <option value="percent">％引き</option>
                  <option value="yen">1名1泊あたり円引き</option>
                </select>
                {#if booking.prepayDiscount.type !== 'none'}
                  <input
                    type="number"
                    min="1"
                    max={booking.prepayDiscount.type === 'percent' ? 50 : 100000}
                    bind:value={booking.prepayDiscount.value}
                    class="w-24 rounded-md border border-stone-300 bg-white px-2 py-1 text-right text-xs tabular-nums"
                  />
                  <span class="text-xs">{booking.prepayDiscount.type === 'percent' ? '%' : '円'}</span>
                {/if}
                <span class="w-full text-[11px] text-stone-500">「オンライン決済（予約時）」を選んだ予約だけ、泊ごとの単価から割り引きます（PMS の請求額も割引後）。取引先の画面に割引後の金額が出ます。</span>
              </div>
            {/if}
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-4">
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">予約の締切</span>
            <select bind:value={booking.leadDays} class={inputClass}>
              {#each [0, 1, 2, 3, 5, 7, 10, 14, 21, 30] as d}<option value={d}>{d === 0 ? '当日' : `${d}日前`}</option>{/each}
            </select>
          </label>
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">締切の時刻</span>
            <select bind:value={booking.cutoffHour} class={inputClass}>
              {#each Array.from({ length: 24 }, (_, h) => h) as h}<option value={h}>{h}時まで</option>{/each}
            </select>
          </label>
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">取引先による取消</span>
            <select
              value={booking.cancelDays == null ? '' : String(booking.cancelDays)}
              onchange={(e) => (booking.cancelDays = e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
              class={inputClass}
            >
              <option value="">画面からは不可</option>
              {#each [0, 1, 2, 3, 5, 7, 10, 14, 21, 30] as d}<option value={String(d)}>{d === 0 ? '当日' : `${d}日前`}の同時刻まで</option>{/each}
            </select>
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="mb-0.5 block text-xs text-stone-500">最大室数</span>
              <input type="number" min="1" max="20" bind:value={booking.maxRooms} class={inputClass} />
            </label>
            <label class="block">
              <span class="mb-0.5 block text-xs text-stone-500">最大泊数</span>
              <input type="number" min="1" max="30" bind:value={booking.maxNights} class={inputClass} />
            </label>
          </div>
        </div>

        <label class="block">
          <span class="mb-0.5 block text-xs text-stone-500">予約画面の案内（取引先に表示。お支払・キャンセル規定など）</span>
          <textarea bind:value={booking.notice} rows="2" maxlength="1000" class={inputClass}></textarea>
        </label>

        <div>
          <p class="mb-1 text-xs text-stone-500">予約時に聞く項目（回答は PMS の予約備考に入ります）</p>
          <div class="grid gap-2">
            {#each booking.options as o, i (o.id)}
              <div class="grid gap-2 rounded-lg border border-stone-200 bg-white p-2.5 sm:grid-cols-[1fr_130px_1fr_auto_auto] sm:items-center">
                <input bind:value={o.label} maxlength="60" placeholder="例: 送迎希望 / 夕食時間 / 記念日" class={inputClass} />
                <select bind:value={o.type} class={inputClass}>
                  <option value="check">チェック</option>
                  <option value="select">選択肢</option>
                  <option value="text">自由入力</option>
                </select>
                {#if o.type === 'select'}
                  <input
                    value={o.choices.join('、')}
                    oninput={(e) => (o.choices = e.currentTarget.value.split(/[、,]/).map((c) => c.trim()).filter(Boolean))}
                    placeholder="選択肢を「、」区切りで（例: 18:00、18:30、19:00）"
                    class={inputClass}
                  />
                {:else}
                  <span class="text-[11px] text-stone-500">{o.type === 'check' ? '「あり」にチェックする項目' : '文字で入力する項目'}</span>
                {/if}
                <label class="flex items-center gap-1.5 text-xs"><input type="checkbox" bind:checked={o.required} />必須</label>
                <button type="button" class={smallBtn} onclick={() => removeOption(i)}>削除</button>
              </div>
            {/each}
            <button type="button" onclick={addOption} class="justify-self-start rounded-md border border-dashed border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50">＋ 項目を追加</button>
          </div>
          <p class="mt-1 text-[11px] text-stone-500">宿泊者名・人数・電話・メール・住所・食物アレルギー・到着予定・備考は、項目を足さなくても毎回聞きます。</p>
        </div>

        <div>
          <p class="mb-1 text-xs text-stone-500">取引先特典 <span>（最大{MAX_PARTNER_PERKS}件）</span></p>
          <p class="mb-2 text-[11px] leading-5 text-stone-500">
            この取引先ページから予約した場合だけ付く特典です。対象プランを絞ると「取引先専用プラン」として見せられます。予約の要望（PMS）と確認メールに「取引先特典」として載ります。
          </p>
          <div class="grid gap-2">
            {#each booking.perks as perk, i (perk.id)}
              <div class="grid gap-2 rounded-lg border border-stone-200 bg-white p-2.5">
                <div class="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                  <input bind:value={perk.title} maxlength="60" required placeholder="タイトル（例: ウェルカムドリンク）" class={inputClass} />
                  <button type="button" class={smallBtn} onclick={() => removePerk(i)}>削除</button>
                </div>
                <textarea bind:value={perk.description} rows="2" maxlength="500" placeholder="説明（任意。取引先の画面に出ます）" class={inputClass}></textarea>
                <div>
                  <p class="mb-1 text-[11px] text-stone-500">対象プラン（未選択 = すべてのプラン）</p>
                  <div class="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
                    {#each perkPlanOptions as plan (plan.code)}
                      <button type="button" class={chip(perk.planCodes.includes(plan.code))} onclick={() => (perk.planCodes = toggle(perk.planCodes, plan.code))}>
                        <span class="font-mono">{plan.code}</span> {plan.label}
                      </button>
                    {:else}
                      <span class="text-[11px] text-stone-400">選べるプランがありません（プレビューに出るプランから選べます）。</span>
                    {/each}
                  </div>
                </div>
              </div>
            {/each}
            {#if booking.perks.length < MAX_PARTNER_PERKS}
              <button type="button" onclick={addPerk} class="justify-self-start rounded-md border border-dashed border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50">＋ 特典を追加</button>
            {/if}
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">宿への通知メール（予約・取消のたびに送る。改行・カンマ区切り）</span>
            <textarea bind:value={notifyText} rows="2" placeholder="front@example.com" class={inputClass}></textarea>
          </label>
          <label class="flex items-start gap-2 pt-5 text-sm">
            <input type="checkbox" bind:checked={booking.notifyPartner} class="mt-0.5" />
            <span>取引先にも予約確認メールを送る<span class="block text-[11px] text-stone-500">予約したログインIDのメールと、上の「連絡先メール」へ</span></span>
          </label>
        </div>
      </fieldset>

      <input type="hidden" name="booking" value={bookingJson} />
      <input type="hidden" name="pricing" value={pricingJson} />
      {#if canEdit}
        <!-- 保存バー: フォームの下端に貼り付く（Book の ContentEditor と同じ sticky）。状態（未保存・保存中・保存済み・エラー）が見える。 -->
        <div class="sticky bottom-0 z-10 -mx-1 mt-6">
          <div
            class={`flex w-full flex-wrap items-center gap-3 rounded-xl border px-4 py-3 shadow-sm backdrop-blur transition
              ${saveError ? 'border-rose-300 bg-white/95' : justSaved ? 'border-emerald-300 bg-white/95' : dirty ? 'border-amber-400 bg-white/95' : 'border-stone-200 bg-white/90'}`}
            role="status"
            aria-live="polite"
          >
            <div class="min-w-0 flex-1 text-sm">
              {#if saving}
                <span class="inline-flex items-center gap-2 text-stone-500"><span class="h-3.5 w-3.5 animate-spin rounded-full border-2 border-stone-200 border-t-brand-800"></span>保存しています…</span>
              {:else if saveError}
                <span class="font-medium text-rose-700">保存できませんでした: {saveError}</span>
              {:else if justSaved}
                <span class="font-medium text-emerald-700">✓ 保存しました。取引先の画面・API にもすぐ反映されます。</span>
              {:else if dirty}
                <span class="inline-flex items-center gap-2 font-medium"><span class="h-2 w-2 rounded-full bg-amber-500"></span>保存していない変更があります</span>
                <span class="ml-1 text-xs text-stone-500">プレビューには反映済みです</span>
              {:else}
                <span class="text-stone-500">変更はありません・最終保存 {dt(data.partner.updatedAt)}</span>
              {/if}
            </div>
            {#if dirty && !saving}
              <button type="button" onclick={revertChanges} class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">元に戻す</button>
            {/if}
            <button
              type="submit"
              disabled={saving || (!dirty && !saveError)}
              class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white transition hover:bg-brand-700 disabled:cursor-default disabled:opacity-40"
            >{saving ? '保存中…' : dirty ? '保存する' : '保存済み'}</button>
          </div>
        </div>
      {/if}
    </form>

    <!-- プレビュー -->
    <div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-sm font-bold text-stone-700">プレビュー（取引先に見える価格）</h2>
          <p class="mt-1 text-xs text-stone-500">
            <strong class="font-medium text-stone-800">編集中の内容で計算しています（保存前の変更も反映）。</strong>小さい数字は基準の理論値（料金マスタ）です。
          </p>
        </div>
        <div class="flex items-end gap-2">
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">開始日</span>
            <input
              type="date"
              min={data.today}
              value={data.preview.from}
              onchange={(e) => goto(`?preview=${e.currentTarget.value}`, { noScroll: true, keepFocus: true })}
              class={inputClass}
            />
          </label>
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">人数</span>
            <select bind:value={previewGuests} class={inputClass}>
              {#each GUEST_COUNTS as g}<option value={g}>{g}名</option>{/each}
            </select>
          </label>
        </div>
      </div>
      {#if data.preview.error}
        <p class="mt-3 text-sm text-rose-700">プレビューを作れませんでした: {data.preview.error}</p>
      {:else if previewRows.length === 0}
        <p class="mt-3 text-sm text-stone-500">この期間・人数で出る料金がありません。</p>
      {:else}
        <div class="mt-3 overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <thead>
              <tr>
                <th class="sticky left-0 z-10 min-w-56 border-b border-stone-200 bg-white px-2 py-1.5 text-left font-medium">部屋 / プラン</th>
                {#each data.preview.days as day}
                  {@const h = dayHead(day.date)}
                  <th class={`border-b border-stone-200 px-2 py-1.5 text-right font-medium ${h.dowIdx === 0 ? 'text-rose-700' : h.dowIdx === 6 ? 'text-brand-800' : ''}`}>
                    {h.md}<span class="ml-0.5 text-[10px]">({h.dow})</span>
                    {#if day.closed}<div class="text-[10px] text-stone-500">休館</div>
                    {:else if day.remainingRooms != null}<div class="text-[10px] font-normal text-stone-500">残{day.remainingRooms}</div>{/if}
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each previewRows as row (row.key)}
                <tr class="border-b border-stone-100">
                  <td class="sticky left-0 z-10 bg-white px-2 py-1.5">
                    <div class="font-medium">{row.planName}{#if row.advance}<span class="ml-1 rounded border border-brand-600/40 px-1 text-[10px] text-brand-800">先行</span>{/if}</div>
                    <div class="text-[10px] text-stone-500">{row.roomName}</div>
                  </td>
                  {#each data.preview.days as day}
                    {@const cell = row.cells[day.date]}
                    <td class="px-2 py-1.5 text-right tabular-nums">
                      {#if cell}
                        <div class="font-semibold">{yen(cell.price)}</div>
                        {#if cell.base != null && cell.base !== cell.price}<div class="text-[10px] text-stone-500">{yen(cell.base)}</div>{/if}
                      {:else}<span class="text-stone-500">—</span>{/if}
                    </td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <!-- 取引先予約 -->
    <div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 class="text-sm font-bold text-stone-700">予約一覧</h2>
          <p class="mt-1 text-xs text-stone-500">この取引先が限定URLから入れた予約です。取消はここ（または取引先の画面）から行います。PMS の画面からは取り消せません。</p>
        </div>
        <div class="flex overflow-hidden rounded-md border border-stone-300 bg-white text-xs">
          <button type="button" onclick={() => (bookingFilter = 'upcoming')} class={`px-3 py-1.5 ${bookingFilter === 'upcoming' ? 'bg-brand-800 text-white' : ''}`}>これから</button>
          <button type="button" onclick={() => (bookingFilter = 'all')} class={`px-3 py-1.5 ${bookingFilter === 'all' ? 'bg-brand-800 text-white' : ''}`}>すべて（{data.bookings.length}）</button>
        </div>
      </div>
      {#if form?.chargeResult}
        <p class={`mt-3 rounded-lg px-3 py-2 text-sm ${form.chargeResult.status === 'paid' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {form.chargeResult.status === 'paid' ? 'カードへの請求が完了しました。PMS の請求書に1分ほどで入金が入ります。' : `請求できませんでした：${form.chargeResult.message ?? ''}`}
        </p>
      {/if}
      {#if form?.bookingCancelled}
        <p class="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">予約 {form.bookingCancelled} を取り消しました。PMS にも1分ほどで反映されます。</p>
      {/if}
      {#if shownBookings.length === 0}
        <p class="mt-3 text-sm text-stone-500">{bookingFilter === 'upcoming' ? 'これからの予約はありません。' : 'まだ予約はありません。'}</p>
      {:else}
        <div class="mt-3 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-stone-500">
              <tr><th class="py-1.5 pr-3 font-medium">予約番号</th><th class="pr-3 font-medium">宿泊日</th><th class="pr-3 font-medium">宿泊者</th><th class="pr-3 font-medium">部屋・プラン</th><th class="pr-3 text-right font-medium">合計</th><th class="pr-3 font-medium">状態</th><th></th></tr>
            </thead>
            <tbody>
              {#each shownBookings as b (b.id)}
                <tr class="border-t border-stone-100 align-top">
                  <td class="py-2 pr-3 font-mono text-xs">{b.code}<div class="font-sans text-[11px] text-stone-500">{dt(b.createdAt)}{b.bookedBy ? ` ${b.bookedBy}` : ''}</div></td>
                  <td class="py-2 pr-3 whitespace-nowrap">{b.checkIn}<span class="text-xs text-stone-500"> {b.nights}泊</span></td>
                  <td class="py-2 pr-3">
                    {b.guestName}<div class="text-[11px] text-stone-500">{b.phone ?? ''}</div>
                    {#if b.transport}<div class="text-[11px] text-stone-500">交通: {b.transport}</div>{/if}
                    {#if b.booker}<div class="text-[11px] text-stone-500">予約者: {b.booker}</div>{/if}
                  </td>
                  <td class="py-2 pr-3 text-xs">
                    {b.roomName} × {b.roomCount}室・{b.adultTotal}名<div class="text-stone-500">{b.planName}</div>
                    {#if b.perks.length}<div class="text-[11px] text-amber-800">取引先特典: {b.perks.join('／')}</div>{/if}
                  </td>
                  <td class="py-2 pr-3 text-right tabular-nums">{yen(b.total)}円</td>
                  <td class="py-2 pr-3 text-xs">
                    {#if b.status === 'pending_payment'}<span class="text-amber-700">支払待ち（仮押さえ）</span>
                    {:else if b.status === 'expired'}<span class="text-stone-500">支払期限切れ</span>
                    {:else if b.status === 'cancelled'}<span class="text-stone-500">取消（{b.cancelledBy === 'staff' ? '宿' : b.cancelledBy === 'system' ? '自動' : '取引先'}）</span>
                    {:else if b.checkedIn}<span class="text-emerald-700">チェックイン済み</span>
                    {:else}<span class="text-brand-800">予約中</span>{/if}
                    {#if b.paymentName}<div class="text-[11px] text-stone-500">{b.paymentName}{b.paymentStatus === 'paid' ? '・支払済' : b.paymentStatus === 'refunded' ? '・返金済' : b.paymentStatus === 'scheduled' ? `・チェックイン日に請求${b.cardLabel ? `（${b.cardLabel}）` : ''}` : ''}</div>{/if}
                    {#if b.billedToPartner}<div class="mt-0.5"><span class="rounded-full border border-red-300 bg-red-50 px-1.5 py-px text-[11px] font-bold whitespace-nowrap text-red-700">取引先へ請求（お客様には請求しない）</span></div>{/if}
                    {#if b.cardConsentAt}<div class="text-[11px] text-stone-500" title={b.cardConsentText ?? ''}>請求の同意: {dt(b.cardConsentAt)}</div>{/if}
                    {#if b.paymentStatus === 'charge_failed'}<div class="text-[11px] text-rose-700">請求失敗{b.chargeError ? `：${b.chargeError}` : ''}</div>{/if}
                    {#if b.paymentStatus === 'refund_failed'}<div class="text-[11px] text-rose-700" title={b.refundError ?? ''}>返金失敗（Stripe で対応が必要）</div>{/if}
                  </td>
                  <td class="py-2 text-right">
                    {#if canEdit && b.status === 'confirmed' && b.paymentOption === 'online_checkin' && (b.paymentStatus === 'charge_failed' || (b.paymentStatus === 'scheduled' && b.checkIn <= todayIso))}
                      <form
                        method="POST"
                        action={`?/retryCharge`}
                        use:enhance={() => {
                          lastSubmit = 'other';
                          return async ({ update }) => {
                            await update({ reset: false });
                          };
                        }}
                        class="mb-1 inline-block"
                      >
                        <input type="hidden" name="booking_id" value={b.id} />
                        <button type="submit" class={`${smallBtn} border-brand-600/50 text-brand-800`}>{b.paymentStatus === 'charge_failed' ? '再請求' : '今すぐ請求'}</button>
                      </form>
                    {/if}
                    {#if canEdit && (b.status === 'confirmed' || b.status === 'pending_payment') && !b.checkedIn}
                      {#if cancelTarget === b.id}
                        <form
                          method="POST"
                          action={`?/cancelBooking`}
                          use:enhance={() => {
                            lastSubmit = 'other';
                            return async ({ update }) => {
                              cancelTarget = null;
                              await update({ reset: false });
                            };
                          }}
                          class="flex flex-wrap items-center justify-end gap-1.5"
                        >
                          <input type="hidden" name="booking_id" value={b.id} />
                          <input name="reason" maxlength="500" placeholder="理由（任意）" class="w-32 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs" />
                          {#if b.paymentStatus === 'paid'}<label class="flex items-center gap-1 text-[11px]"><input type="checkbox" name="refund" checked />全額返金</label>{/if}
                          <button type="submit" class={`${smallBtn} border-rose-300 text-rose-700`}>取り消す</button>
                          <button type="button" class={smallBtn} onclick={() => (cancelTarget = null)}>やめる</button>
                        </form>
                      {:else}
                        <button type="button" class={`${smallBtn} hover:text-rose-700`} onclick={() => (cancelTarget = b.id)}>取消</button>
                      {/if}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <!-- 請求書（利用明細書＋適格請求書） -->
    <div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
      <h2 class="text-sm font-bold text-stone-700">請求書</h2>
      <p class="mt-1 text-xs leading-5 text-stone-500">
        チェックアウト日基準・月末締めで、利用明細書と適格請求書をセットで発行します。月末日の15:00に自動で発行し、取引先（連絡先メール・マスタユーザー）へメールで送ります。
        金額は予約時の金額です。ご請求の対象は「月末締め翌月末銀行振込」と「請求書で精算する」にした自由入力の支払方法だけで、それ以外は利用明細に 0 円のご請求として載ります。お支払期限は翌月末です。取引先は取引先ページの「アカウント → 請求書」からいつでもダウンロードできます。
      </p>
      {#if data.invoices.bankAccountMissing}
        <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">振込先が未設定のため、月末の自動発行は行われません。<a href="/admin/partners" class="underline">取引先一覧の「請求書の設定」</a>で振込先を登録してください。</p>
      {:else if !data.invoices.autoIssue}
        <p class="mt-2 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-700">この施設は月末の自動発行が OFF です（取引先一覧の「請求書の設定」）。必要なときはここから発行してください。</p>
      {/if}
      {#if !data.invoices.pdfReady}
        <p class="mt-2 text-[11px] text-stone-500">※ PDF 生成（Cloudflare Browser Rendering）が未設定のため、ダウンロードは HTML（ブラウザで開いて印刷）になり、メールは PDF を添付せずに取引先ページへ案内します。</p>
      {/if}

      {#if form?.message && lastSubmit === 'invoice'}
        <p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
      {:else if form?.invoiceResult}
        <p class={`mt-3 rounded-lg px-3 py-2 text-sm ${form.invoiceResult.kind === 'error' ? 'bg-red-50 text-red-700' : form.invoiceResult.kind === 'issued' || form.invoiceResult.kind === 'sent' || form.invoiceResult.kind === 'voided' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{form.invoiceResult.message}</p>
      {/if}

      <!-- 発行済み -->
      {#if data.invoices.error}
        <p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.invoices.error}</p>
      {:else if data.invoices.rows.length === 0}
        <p class="mt-3 text-sm text-stone-500">まだ請求書はありません。</p>
      {:else}
        <div class="mt-3 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-stone-500">
              <tr>
                <th class="py-1.5 pr-3 font-medium">番号</th>
                <th class="pr-3 font-medium">対象月</th>
                <th class="pr-3 font-medium">発行日</th>
                <th class="pr-3 text-right font-medium">ご請求額</th>
                <th class="pr-3 font-medium">送信</th>
                <th class="pr-3 font-medium">状態</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each data.invoices.rows as inv (inv.id)}
                <tr class={`border-t border-stone-100 align-top ${inv.status === 'void' ? 'text-stone-400' : ''}`}>
                  <td class="py-2 pr-3 font-mono text-xs whitespace-nowrap">{inv.invoiceNo}</td>
                  <td class="py-2 pr-3 text-xs whitespace-nowrap">{periodLabel(inv.period)}<div class="text-stone-500">{inv.bookingCount}件</div></td>
                  <td class="py-2 pr-3 text-xs whitespace-nowrap">{inv.issueDate}<div class="text-stone-500">{inv.issuedBy === 'auto' ? '自動' : 'スタッフ'}・期限 {inv.dueDate}</div></td>
                  <td class="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{yen(inv.billedTotal)}円<div class="text-[11px] text-stone-500">利用 {yen(inv.usageTotal)}円</div></td>
                  <td class="py-2 pr-3 text-xs">
                    {#if inv.sentAt}
                      <span class="text-emerald-700">{dt(inv.sentAt)}</span>
                      <div class="break-all text-stone-500">{inv.sentTo.join(', ')}</div>
                    {:else}
                      <span class="text-stone-500">未送信</span>
                    {/if}
                    {#if inv.sendError}<div class="break-all text-rose-700">{inv.sendError}</div>{/if}
                  </td>
                  <td class="py-2 pr-3 text-xs whitespace-nowrap">
                    {#if inv.status === 'void'}
                      <span class="rounded-full bg-stone-200 px-2 py-0.5 text-stone-600">取消</span>
                      <div class="mt-0.5 whitespace-normal text-stone-500">{dt(inv.voidedAt)}{inv.voidReason ? `・${inv.voidReason}` : ''}</div>
                    {:else}
                      <span class="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">発行済み</span>
                    {/if}
                  </td>
                  <td class="py-2">
                    <div class="flex flex-wrap justify-end gap-1.5">
                      <a class={smallBtn} href={`/admin/partners/${data.partner.id}/invoices/${inv.id}?format=pdf`} data-sveltekit-reload>PDF</a>
                      <a class={smallBtn} href={`/admin/partners/${data.partner.id}/invoices/${inv.id}?format=html`} target="_blank" rel="noopener">HTML</a>
                      {#if canEdit && inv.status === 'issued'}
                        <form
                          method="POST"
                          action={`?/resendInvoice`}
                          use:enhance={async ({ cancel }) => {
                            if (!(await askConfirm({ message: `${inv.invoiceNo} を取引先へメールで${inv.sentAt ? '再送' : '送信'}します。`, confirmLabel: '送信する' }))) {
                              cancel();
                              return;
                            }
                            return invoiceEnhance();
                          }}
                        >
                          <input type="hidden" name="invoice_id" value={inv.id} />
                          <button type="submit" class={smallBtn} disabled={invoiceBusy}>{inv.sentAt ? '再送' : '送信'}</button>
                        </form>
                        <button type="button" class={`${smallBtn} hover:text-rose-700`} onclick={() => (voidTarget = voidTarget === inv.id ? null : inv.id)}>取消</button>
                      {/if}
                    </div>
                    {#if canEdit && voidTarget === inv.id}
                      <form method="POST" action={`?/voidInvoice`} use:enhance={invoiceEnhance} class="mt-2 flex flex-wrap items-center justify-end gap-1.5">
                        <input type="hidden" name="invoice_id" value={inv.id} />
                        <input name="reason" required maxlength="300" placeholder="取消の理由（必須）" class="w-56 rounded-md border border-stone-300 px-2 py-1 text-xs" />
                        <button type="submit" class={`${smallBtn} text-rose-700`} disabled={invoiceBusy}>取り消す</button>
                      </form>
                      <p class="mt-1 text-right text-[11px] text-stone-500">取り消すと番号は欠番になり、同じ月を発行し直せます。取引先への連絡は別途行ってください。</p>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <!-- 対象月のプレビューと今すぐ発行 -->
      <div class="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-4">
        <div class="flex flex-wrap items-end gap-3">
          <label class="block text-xs">
            <span class="mb-0.5 block text-stone-500">対象月（チェックアウト）</span>
            <input
              type="month"
              value={invoiceMonth}
              max={data.invoices.currentPeriod.slice(0, 7)}
              onchange={(e) => pickInvoiceMonth(e.currentTarget.value)}
              class="rounded-md border border-stone-300 bg-white px-2 py-1 text-sm"
            />
          </label>
          <p class="text-xs text-stone-500">{periodLabel(data.invoices.period)}のプレビュー（まだ発行していない内容です）</p>
        </div>

        {#if data.invoices.previewError}
          <p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.invoices.previewError}</p>
        {:else if data.invoices.preview}
          {@const pv = data.invoices.preview}
          {#if pv.lines.length === 0}
            <p class="mt-3 text-sm text-stone-500">この月（今日まで）にチェックアウトの確定予約はありません（発行されません）。</p>
          {:else}
            <div class="mt-3 overflow-x-auto">
              <table class="w-full bg-white text-xs">
                <thead class="text-left text-stone-500">
                  <tr class="border-b border-stone-200">
                    <th class="px-2 py-1.5 font-medium">チェックアウト</th>
                    <th class="px-2 font-medium">予約番号</th>
                    <th class="px-2 font-medium">宿泊者・お部屋</th>
                    <th class="px-2 font-medium">お支払方法</th>
                    <th class="px-2 text-right font-medium">ご利用額</th>
                    <th class="px-2 text-right font-medium">ご請求額</th>
                  </tr>
                </thead>
                <tbody>
                  {#each pv.lines as l (l.bookingId)}
                    <tr class="border-t border-stone-100 align-top">
                      <td class="px-2 py-1.5 whitespace-nowrap">{l.checkOut}<div class="text-stone-500">{l.nights}泊</div></td>
                      <td class="px-2 py-1.5 font-mono">{l.bookingCode}</td>
                      <td class="px-2 py-1.5">{l.guestName} 様<div class="text-stone-500">{l.roomName} {l.roomCount}室・{l.adults}名</div></td>
                      <td class="px-2 py-1.5">{l.paymentLabel}</td>
                      <td class="px-2 py-1.5 text-right tabular-nums whitespace-nowrap">{yen(l.usage)}円{#if l.discount}<div class="text-stone-500">割引 −{yen(l.discount)}円</div>{/if}</td>
                      <td class={`px-2 py-1.5 text-right tabular-nums whitespace-nowrap ${l.billable ? 'font-semibold' : 'text-stone-400'}`}>{l.billable ? `${yen(l.billed)}円` : '—'}</td>
                    </tr>
                  {/each}
                </tbody>
                <tfoot>
                  <tr class="border-t border-stone-300 font-semibold">
                    <td class="px-2 py-1.5" colspan="4">合計（{pv.lines.length}件）</td>
                    <td class="px-2 py-1.5 text-right tabular-nums">{yen(pv.totals.usageTotal)}円</td>
                    <td class="px-2 py-1.5 text-right tabular-nums">{yen(pv.totals.billedTotal)}円</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p class="mt-2 text-xs text-stone-600">
              ご請求 {yen(pv.totals.billedTotal)}円（10%対象 {yen(pv.totals.taxable10)}円・うち消費税 {yen(pv.totals.tax10)}円／入湯税〔不課税〕 {yen(pv.totals.nonTaxable)}円）・お支払い済み・別途精算 {yen(pv.totals.paidTotal)}円・お支払期限 {pv.dueDate}
              {#if pv.totals.billedTotal === 0}<span class="text-stone-500">（ご請求 0 円のため、利用明細書だけを発行します）</span>{/if}
            </p>
            {#if data.invoices.chargeFailed.length}
              <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                カード決済（チェックイン日）が失敗したままの予約があります：{data.invoices.chargeFailed.join('、')}。請求書には「カード決済失敗（要確認）」として載り、ご請求には含めません。予約の画面で再請求するか、別途ご精算ください。
              </p>
            {/if}
          {/if}

          {#if canEdit && pv.lines.length > 0}
            <form
              method="POST"
              action={`?/issueInvoice`}
              use:enhance={async ({ formData, cancel }) => {
                const send = formData.get('send') !== null;
                const msg = `${periodLabel(data.invoices.period)}分の請求書を発行${send ? 'し、取引先へメールで送信' : ''}します。同じ月は1枚だけです（作り直すには取消が必要です）。${issuingMidMonth ? '\n※ 月の途中です。今日より後にチェックアウトする予約は載りません。' : ''}${data.invoices.chargeFailed.length ? `\n※ カード決済が失敗したままの予約（${data.invoices.chargeFailed.join('、')}）は請求しません。` : ''}`;
                if (!(await askConfirm({ message: msg, confirmLabel: '発行する' }))) {
                  cancel();
                  return;
                }
                return invoiceEnhance();
              }}
              class="mt-3 flex flex-wrap items-center gap-3 border-t border-stone-200 pt-3"
            >
              <input type="hidden" name="period" value={data.invoices.period} />
              <label class="flex items-center gap-1.5 text-xs"><input type="checkbox" name="send" checked />取引先へメールで送信する</label>
              <button type="submit" disabled={invoiceBusy} class="rounded-lg bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50">{invoiceBusy ? '処理中…' : '今すぐ発行'}</button>
              {#if issuingMidMonth}<span class="text-[11px] text-amber-800">月の途中です。今日より後にチェックアウトする予約は載りません（発行せずに待てば月末に自動発行されます）。</span>{/if}
            </form>
          {/if}
        {/if}
      </div>
    </div>

    <!-- ログインID -->
    <div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
      <h2 class="text-sm font-bold text-stone-700">ログインID</h2>
      <p class="mt-1 text-xs text-stone-500">
        ここでログインIDを発行し、パスワード設定リンク（有効期限7日・1回限り）を取引先へ送ります。ここで発行するログインIDはマスタユーザーです（取引先ページで子ユーザーを作れます）。パスワードは取引先が自分で決めます（宿側では分かりません）。メールの差出人は施設名、返信先は施設の予約用アドレスです。
      </p>

      {#if form?.issued}
        <div class="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p class="font-medium">ログインID <span class="font-mono">{form.issued.loginId}</span> のパスワード設定リンク</p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <code class="break-all rounded border border-stone-200 bg-white px-2 py-1 text-xs">{form.issued.setupUrl}</code>
            <button type="button" class={smallBtn} onclick={() => copy(form?.issued?.setupUrl ?? '')}>コピー</button>
          </div>
          <p class="mt-2 text-xs text-stone-500">
            このリンクは今だけ表示されます（再表示はできません。必要なら再発行してください）。
            {#if form.issued.emailSent === true}取引先へメールでも送りました。
            {:else if form.issued.emailSent === false}メールは送れませんでした（{form.issued.emailReason}）。リンクをコピーしてお送りください。{/if}
          </p>
        </div>
      {/if}

      {#if data.accounts.length}
        <div class="mt-3 overflow-x-auto">
          <table class="w-full text-sm">
            <thead class="text-left text-xs text-stone-500">
              <tr><th class="py-1.5 pr-3 font-medium">ログインID</th><th class="pr-3 font-medium">名前・メール</th><th class="pr-3 font-medium">状態</th><th class="pr-3 font-medium">最終ログイン</th><th></th></tr>
            </thead>
            <tbody>
              {#each data.accounts as a (a.id)}
                <tr class="border-t border-stone-100 align-top">
                  <td class="py-2 pr-3">
                    <span class="font-mono">{a.loginId}</span>
                    {#if a.isMaster}
                      <span class="ml-1 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] text-brand-800">マスタ</span>
                    {:else}
                      <span class="ml-1 rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">子ユーザー</span>
                      {#if a.createdBy}<div class="text-[11px] text-stone-500">作成: <span class="font-mono">{a.createdBy}</span></div>{/if}
                    {/if}
                  </td>
                  <td class="py-2 pr-3 text-xs">{a.displayName ?? ''}<div class="text-stone-500">{a.email ?? ''}</div></td>
                  <td class="py-2 pr-3 text-xs">
                    {#if !a.isActive}<span class="text-stone-500">停止中</span>
                    {:else if a.lockedUntil}<span class="text-rose-700">ロック中（〜{dt(a.lockedUntil)}）</span>
                    {:else if !a.hasPassword}<span class="text-amber-700">パスワード設定待ち</span>
                    {:else}<span class="text-emerald-700">利用可</span>{/if}
                    {#if a.setupPending && a.hasPassword}<div class="text-stone-500">再設定リンク発行中</div>{/if}
                  </td>
                  <td class="py-2 pr-3 text-xs">{dt(a.lastLoginAt)}</td>
                  <td class="py-2">
                    {#if canEdit}
                      <div class="flex flex-wrap justify-end gap-1.5">
                        <form method="POST" action={`?/reissueSetup`} use:enhance={() => { lastSubmit = 'other'; return async ({ update }) => update({ reset: false }); }} class="flex items-center gap-1">
                          <input type="hidden" name="account_id" value={a.id} />
                          {#if a.email}<label class="flex items-center gap-1 text-[11px] text-stone-500"><input type="checkbox" name="send_email" />メール</label>{/if}
                          <button type="submit" class={smallBtn}>{a.hasPassword ? 'パスワード再設定リンク' : '設定リンク再発行'}</button>
                        </form>
                        {#each a.lockedUntil ? ['unlock'] : [] as op}
                          <form method="POST" action={`?/updateAccount`} use:enhance={() => { lastSubmit = 'other'; return async ({ update }) => update({ reset: false }); }}>
                            <input type="hidden" name="account_id" value={a.id} /><input type="hidden" name="op" value={op} />
                            <button type="submit" class={smallBtn}>ロック解除</button>
                          </form>
                        {/each}
                        <form method="POST" action={`?/updateAccount`} use:enhance={() => { lastSubmit = 'other'; return async ({ update }) => update({ reset: false }); }}>
                          <input type="hidden" name="account_id" value={a.id} /><input type="hidden" name="op" value={a.isActive ? 'disable' : 'enable'} />
                          <button type="submit" class={smallBtn}>{a.isActive ? '停止' : '再開'}</button>
                        </form>
                        <form
                          method="POST"
                          action={`?/updateAccount`}
                          use:enhance={async ({ cancel }) => {
                            if (!(await askConfirm({ message: `ログインID ${a.loginId} を削除します。`, confirmLabel: '削除する' }))) cancel();
                            return async ({ update }) => update({ reset: false });
                          }}
                        >
                          <input type="hidden" name="account_id" value={a.id} /><input type="hidden" name="op" value="delete" />
                          <button type="submit" class={`${smallBtn} hover:text-rose-700`}>削除</button>
                        </form>
                      </div>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      {#if canEdit}
        <form method="POST" action={`?/createAccount`} use:enhance={() => { lastSubmit = 'other'; }} class="mt-4 grid gap-3 border-t border-stone-200 pt-4 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">ログインID（空欄 = 自動）</span>
            <input name="login_id" maxlength="64" placeholder={`${data.facilitySlugHint}-xxxxxx`} class={inputClass} autocomplete="off" />
          </label>
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">担当者名（任意）</span>
            <input name="display_name" maxlength="80" class={inputClass} autocomplete="off" />
          </label>
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">メール（任意）</span>
            <input name="email" type="email" class={inputClass} autocomplete="off" />
            <label class="mt-1 flex items-center gap-1 text-xs text-stone-500"><input type="checkbox" name="send_email" />設定リンクをメールで送る</label>
          </label>
          <button type="submit" class="self-start rounded-lg bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700 sm:mt-5">ログインIDを発行</button>
        </form>
      {/if}
    </div>

    <!-- API -->
    <div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
      <h2 class="text-sm font-bold text-stone-700">REST API</h2>
      <p class="mt-1 text-xs leading-5 text-stone-500">
        取引先のシステムから特別レート・残室を JSON で取得できます。API キーは発行時に1度だけ表示します（キー本体は保存しません）。
      </p>
      {#if form?.apiKey}
        <div class="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm">
          <p class="font-medium">API キーを発行しました（今だけ表示）</p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <code class="break-all rounded border border-stone-200 bg-white px-2 py-1 text-xs">{form.apiKey}</code>
            <button type="button" class={smallBtn} onclick={() => copy(form?.apiKey ?? '')}>コピー</button>
          </div>
        </div>
      {/if}
      <pre class="mt-3 overflow-x-auto rounded border border-stone-200 bg-stone-50 p-3 text-xs leading-5">GET {data.apiEndpoint}?from=YYYY-MM-DD&to=YYYY-MM-DD
Authorization: Bearer rmsp_xxxxxxxx

任意: room=部屋コード（複数可） / guests=人数（複数可）
1回で最大31日。from 省略 = 今日、to 省略 = from から31日。

curl -H "Authorization: Bearer $KEY" "{data.apiEndpoint}?from={data.today}&guests=2"</pre>

      {#if data.apiKeys.length}
        <table class="mt-3 w-full text-sm">
          <thead class="text-left text-xs text-stone-500">
            <tr><th class="py-1.5 pr-3 font-medium">キー</th><th class="pr-3 font-medium">用途</th><th class="pr-3 font-medium">発行</th><th class="pr-3 font-medium">最終利用</th><th></th></tr>
          </thead>
          <tbody>
            {#each data.apiKeys as k (k.id)}
              <tr class="border-t border-stone-100">
                <td class="py-2 pr-3 font-mono text-xs">{k.prefix}…</td>
                <td class="py-2 pr-3 text-xs">{k.label ?? ''}</td>
                <td class="py-2 pr-3 text-xs">{dt(k.createdAt)}</td>
                <td class="py-2 pr-3 text-xs">{dt(k.lastUsedAt)}</td>
                <td class="py-2 text-right">
                  {#if k.revokedAt}<span class="text-xs text-stone-500">無効（{dt(k.revokedAt)}）</span>
                  {:else if canEdit}
                    <form
                      method="POST"
                      action={`?/revokeKey`}
                      use:enhance={async ({ cancel }) => {
                        if (!(await askConfirm({ message: 'この API キーを無効にします。取引先のシステムから取得できなくなります。', confirmLabel: '無効にする' }))) cancel();
                        return async ({ update }) => update({ reset: false });
                      }}
                    >
                      <input type="hidden" name="key_id" value={k.id} />
                      <button type="submit" class={`${smallBtn} hover:text-rose-700`}>無効にする</button>
                    </form>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if canEdit}
        <form method="POST" action={`?/issueKey`} use:enhance={() => { lastSubmit = 'other'; }} class="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-200 pt-4">
          <label class="block">
            <span class="mb-0.5 block text-xs text-stone-500">用途（任意）</span>
            <input name="label" maxlength="80" placeholder="例: 予約システム連携" class={inputClass} autocomplete="off" />
          </label>
          <button type="submit" class="rounded-lg bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700">API キーを発行</button>
        </form>
      {/if}
    </div>

    <!-- アクセスログ -->
    <div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
      <h2 class="text-sm font-bold text-stone-700">アクセスログ（直近50件）</h2>
      {#if data.logs.length === 0}
        <p class="mt-2 text-sm text-stone-500">まだアクセスはありません。</p>
      {:else}
        <table class="mt-3 w-full text-xs">
          <tbody>
            {#each data.logs as l (l.id)}
              <tr class="border-t border-stone-100">
                <td class="py-1.5 pr-3 whitespace-nowrap">{dt(l.at)}</td>
                <td class="pr-3">{l.channel === 'api' ? 'API' : '画面'}</td>
                <td class={`pr-3 ${l.action.startsWith('login_') ? 'text-rose-700' : ''}`}>{ACTION_LABELS[l.action] ?? l.action}</td>
                <td class="pr-3 font-mono">{l.who ?? (l.detail?.loginId as string | undefined) ?? ''}</td>
                <td class="pr-3 text-stone-500">{l.detail?.from ? `${l.detail.from}〜${l.detail.to}` : (l.detail?.month ?? '')}</td>
                <td class="text-stone-500">{l.ip ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    {#if canEdit}
      <form
        method="POST"
        action={`?/deletePartner`}
        use:enhance={async ({ cancel }) => {
          if (!(await askConfirm({ message: `取引先「${data.partner.name}」を削除します。ログインID・API キー・アクセスログも消えます。`, confirmLabel: '取引先を削除する' }))) cancel();
        }}
        class="text-right"
      >
        <button type="submit" class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-rose-600 hover:bg-rose-50">取引先を削除</button>
      </form>
    {/if}
  </div>
