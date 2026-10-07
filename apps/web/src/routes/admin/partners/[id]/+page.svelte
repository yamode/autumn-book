<script lang="ts">
  import PartnerCancelFeeFields from '$lib/components/admin/PartnerCancelFeeFields.svelte';
  import BookingQuestionsEditor from '$lib/components/admin/BookingQuestionsEditor.svelte';
  import { untrack } from 'svelte';
  import { deserialize, enhance } from '$app/forms';
  import { beforeNavigate, goto, invalidateAll } from '$app/navigation';
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
    CREDIT_DEPOSIT_TYPES,
    CUSTOM_PAYMENT_PREFIX,
    describeCreditDeposit,
    describeInvoiceDue,
    invoiceDueDate,
    isStripePaymentOption,
    MAX_CUSTOM_PAYMENT_OPTIONS,
    MAX_PARTNER_PERKS,
    PARTNER_PAYMENT_OPTIONS,
    type CreditDepositType,
    type PartnerBookingSettings
  } from '$lib/partner-booking';
  import { isLastDayOfMonth, periodLabel } from '$lib/partner-invoice';
  import { displayPlanName, partnerContentScope } from '$lib/partner-contents';
  import { PMS_PARTNER_GUEST_TYPE_LABELS, type PmsPartnerGuest } from '$lib/pms-partner-guest';
  import {
    CREDIT_OVER_ACTION_OPTIONS,
    CREDIT_UNIT_NOTE,
    creditMonthLabel,
    creditRemainingBefore,
    isSelectableCreditOverAction,
    type CreditOverAction
  } from '$lib/partner-credit';
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
    booking.perks = [...booking.perks, { id: `perk-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: '', description: '', imageUrl: '', planCodes: [] }];
  }
  function removePerk(i: number) {
    booking.perks = booking.perks.filter((_, k) => k !== i);
  }
  // 特典の画像: 選んだ時点で ?/uploadPerkImage に上げる。保存済みの特典ならサーバ側でその場で保存されるので、
  // 保存済みの状態（savedSnapshot）にも同じ画像を反映して「未保存」にしない。まだ保存していない特典は「保存する」で確定。
  let perkUploading = $state<string | null>(null);
  let perkImageError = $state<{ id: string; text: string } | null>(null);
  async function sendPerkImage(perk: PartnerBookingSettings['perks'][number], file: File | null) {
    perkUploading = perk.id;
    perkImageError = null;
    try {
      const fd = new FormData();
      fd.append('perk_id', perk.id);
      if (file) fd.append('photo', file);
      else fd.append('remove', '1');
      const res = await fetch('?/uploadPerkImage', { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
      const result = deserialize(await res.text());
      if (result.type === 'success' && typeof result.data?.perkImageUploaded === 'string') {
        const url = result.data.perkImageUploaded;
        perk.imageUrl = url;
        if (result.data.perkImagePersisted) {
          const snap = JSON.parse(savedSnapshot) as { settings: unknown; pricing: unknown; bookingJson: string };
          const b = JSON.parse(snap.bookingJson) as PartnerBookingSettings;
          b.perks = b.perks.map((p) => (p.id === perk.id ? { ...p, imageUrl: url } : p));
          savedSnapshot = JSON.stringify({ ...snap, bookingJson: JSON.stringify(b) });
        }
      } else {
        const text = result.type === 'failure' && typeof result.data?.message === 'string' ? result.data.message : '画像を保存できませんでした。';
        perkImageError = { id: perk.id, text };
      }
    } catch {
      perkImageError = { id: perk.id, text: '画像を保存できませんでした。' };
    } finally {
      perkUploading = null;
    }
  }
  function onPerkImagePicked(perk: PartnerBookingSettings['perks'][number], e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) sendPerkImage(perk, file);
  }
  // 取引先向けのプラン名: 販売対象（「調整して出す」ルールのプラン。全プラン対象なら全部）＋名前を付け済みのコード
  const namePlanOptions = $derived.by(() => {
    const scope = partnerContentScope(pricing);
    const list = data.planOptions
      .filter((p) => !scope.plans || scope.plans.has(p.code) || booking.planNames[p.code])
      .map((p) => ({ code: p.code, label: p.label }));
    for (const code of Object.keys(booking.planNames)) if (!list.some((p) => p.code === code)) list.push({ code, label: code });
    return list;
  });
  function setPlanName(code: string, v: string) {
    const next = { ...booking.planNames };
    if (v.trim()) next[code] = v;
    else delete next[code];
    booking.planNames = next;
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
  // ご請求書のお支払期限（翌月末 / 翌月 N 日）。種類を切り替えたときの日は 25 日を既定にする
  function setInvoiceDueType(type: string) {
    booking.invoiceDue = type === 'next_month_day' ? { type: 'next_month_day', day: booking.invoiceDue.type === 'next_month_day' ? booking.invoiceDue.day : 25 } : { type: 'next_month_end' };
  }
  function setInvoiceDueDay(v: string) {
    const day = Math.round(Number(v));
    if (Number.isFinite(day) && day >= 1 && day <= 28) booking.invoiceDue = { type: 'next_month_day', day };
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
  // ---- PMS の顧客マスタ（旅行会社・法人）との紐づけ（Phase 1） ----
  // 「公開設定」の保存フォームの中に置くため、入れ子のフォームにせず fetch でアクションを呼ぶ（特典の画像と同じ方式）。
  // 検索欄には name を付けない（「保存する」で一緒に送らない）。紐づけ・解除の後は invalidateAll で読み直す
  // （設定フォームは手元コピーなので、未保存の編集は消えない）。
  type PmsGuestCandidate = PmsPartnerGuest & { url: string };
  let pmsQuery = $state('');
  let pmsResults = $state<PmsGuestCandidate[] | null>(null);
  let pmsSearchedQuery = $state('');
  let pmsBusy = $state<'search' | 'link' | 'unlink' | null>(null);
  let pmsMessage = $state<{ kind: 'error' | 'ok'; text: string } | null>(null);
  async function postPmsAction(action: string, fields: Record<string, string>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const res = await fetch(`?/${action}`, { method: 'POST', body: fd, headers: { 'x-sveltekit-action': 'true' } });
    return deserialize(await res.text());
  }
  const failureText = (result: ReturnType<typeof deserialize>, fallback: string) =>
    result.type === 'failure' && typeof result.data?.message === 'string' ? result.data.message : fallback;
  async function searchPmsGuests() {
    const q = pmsQuery.trim();
    if (!q || pmsBusy) return;
    pmsBusy = 'search';
    pmsMessage = null;
    try {
      const result = await postPmsAction('searchPmsGuests', { q });
      if (result.type === 'success' && Array.isArray(result.data?.pmsGuestResults)) {
        pmsResults = result.data.pmsGuestResults as PmsGuestCandidate[];
        pmsSearchedQuery = q;
      } else {
        pmsMessage = { kind: 'error', text: failureText(result, '検索できませんでした。') };
      }
    } catch {
      pmsMessage = { kind: 'error', text: '通信状況を確認して、もう一度お試しください。' };
    } finally {
      pmsBusy = null;
    }
  }
  async function linkPmsGuest(g: PmsGuestCandidate) {
    if (pmsBusy) return;
    if (!(await askConfirm({ message: `「${g.formalName}」（${PMS_PARTNER_GUEST_TYPE_LABELS[g.guestType]}）に紐づけます。以後この取引先からの予約は、PMS の「予約者」にこの顧客が入ります。`, confirmLabel: '紐づける' }))) return;
    pmsBusy = 'link';
    pmsMessage = null;
    try {
      const result = await postPmsAction('linkPmsGuest', { guest_id: g.id });
      if (result.type === 'success') {
        pmsResults = null;
        pmsQuery = '';
        await invalidateAll();
        pmsMessage = { kind: 'ok', text: `「${g.formalName}」に紐づけました。` };
      } else {
        pmsMessage = { kind: 'error', text: failureText(result, '紐づけられませんでした。') };
      }
    } catch {
      pmsMessage = { kind: 'error', text: '通信状況を確認して、もう一度お試しください。' };
    } finally {
      pmsBusy = null;
    }
  }
  async function unlinkPmsGuest() {
    if (pmsBusy) return;
    const name = data.pmsLink.guest?.formalName ?? '紐づけ先';
    if (!(await askConfirm({ message: `「${name}」との紐づけを外します。以後の予約は PMS の「予約者」に入らなくなります（取引先の他の設定は変わりません）。`, confirmLabel: '紐づけを外す' }))) return;
    pmsBusy = 'unlink';
    pmsMessage = null;
    try {
      const result = await postPmsAction('unlinkPmsGuest', {});
      if (result.type === 'success') {
        await invalidateAll();
        pmsMessage = { kind: 'ok', text: '紐づけを外しました。' };
      } else {
        pmsMessage = { kind: 'error', text: failureText(result, '紐づけを外せませんでした。') };
      }
    } catch {
      pmsMessage = { kind: 'error', text: '通信状況を確認して、もう一度お試しください。' };
    } finally {
      pmsBusy = null;
    }
  }
  // ---- 予約名義（Phase 2）: 紐づけ済みのときだけ選べる。紐づけ・解除と同じく選んだ時点で保存する ----
  // ラジオは「保存する」の送信に混ぜないよう name を付けず、手元の状態（bind:group）で持つ。失敗したら元に戻す。
  type NameMode = 'guest' | 'partner';
  let nameMode = $state<NameMode>('guest');
  $effect(() => {
    nameMode = data.pmsLink.bookingNameMode;
  });
  let nameModeBusy = $state(false);
  async function changeNameMode(next: NameMode) {
    const prev = data.pmsLink.bookingNameMode;
    if (nameModeBusy || next === prev) return;
    nameModeBusy = true;
    pmsMessage = null;
    try {
      const result = await postPmsAction('setBookingNameMode', { mode: next });
      if (result.type === 'success') {
        await invalidateAll();
        pmsMessage = { kind: 'ok', text: next === 'partner' ? '予約名義を「旅行会社名で取る」にしました。以後の予約から反映されます。' : '予約名義を「宿泊者名で取る」に戻しました。以後の予約から反映されます。' };
      } else {
        nameMode = prev;
        pmsMessage = { kind: 'error', text: failureText(result, '予約名義を保存できませんでした。') };
      }
    } catch {
      nameMode = prev;
      pmsMessage = { kind: 'error', text: '通信状況を確認して、もう一度お試しください。' };
    } finally {
      nameModeBusy = false;
    }
  }
  // ---- 与信（受付枠・Phase 3a）: 紐づけ先が旅行会社のときだけ。設定の保存・超過時の挙動は管理者だけ・即時保存 ----
  // 入力欄は「保存する」の送信に混ぜないよう name を付けない。画面に出した時点の core.guests.updated_at を
  // 楽観ロックに使い、他の人（PMS を含む）が先に変えていたら保存しない。
  type CreditFormState = { enabled: boolean; growthRate: string; minRooms: string; note: string };
  let creditForm = $state<CreditFormState>({ enabled: false, growthRate: '', minRooms: '', note: '' });
  let creditLoadedAt = $state('');
  // 読み直したとき（updated_at が変わったとき）だけ手元の入力を入れ替える（他の操作の読み直しで編集中の値を消さない）
  $effect(() => {
    const s = data.pmsLink.credit?.state;
    if (!s || s.guestUpdatedAt === untrack(() => creditLoadedAt)) return;
    creditForm = { enabled: s.enabled, growthRate: s.growthRate, minRooms: s.minRooms, note: s.note };
    creditLoadedAt = s.guestUpdatedAt;
  });
  let creditBusy = $state<'save' | 'action' | 'reload' | null>(null);
  let creditMessage = $state<{ kind: 'error' | 'ok'; text: string; conflict?: boolean } | null>(null);
  const creditDirty = $derived.by(() => {
    const s = data.pmsLink.credit?.state;
    if (!s) return false;
    return s.enabled !== creditForm.enabled || s.growthRate !== creditForm.growthRate.trim() || s.minRooms !== creditForm.minRooms.trim() || s.note !== creditForm.note.trim();
  });
  async function saveAgencyCredit() {
    const s = data.pmsLink.credit?.state;
    if (!s || creditBusy) return;
    creditBusy = 'save';
    creditMessage = null;
    try {
      const result = await postPmsAction('saveAgencyCredit', {
        enabled: creditForm.enabled ? '1' : '',
        growth_rate: creditForm.growthRate,
        min_rooms: creditForm.minRooms,
        note: creditForm.note,
        expected_updated_at: creditLoadedAt
      });
      if (result.type === 'success') {
        await invalidateAll();
        creditMessage = { kind: 'ok', text: '与信の設定を保存しました（PMS の旅行会社の設定にも反映されています）。' };
      } else {
        creditMessage = { kind: 'error', text: failureText(result, '与信の設定を保存できませんでした。'), conflict: result.type === 'failure' && result.status === 409 };
      }
    } catch {
      creditMessage = { kind: 'error', text: '通信状況を確認して、もう一度お試しください。' };
    } finally {
      creditBusy = null;
    }
  }
  // 競合のあと: 最新の設定を読み直す（手元の入力は最新の値に置き換わる）
  async function reloadAgencyCredit() {
    if (creditBusy) return;
    creditBusy = 'reload';
    try {
      creditLoadedAt = '';
      await invalidateAll();
      creditMessage = { kind: 'ok', text: '最新の設定を読み直しました。' };
    } finally {
      creditBusy = null;
    }
  }
  // 超過時の挙動（warn / ignore を選べる。deposit は 3b まで選べない＝表示だけ）
  let creditOverAction = $state<CreditOverAction>('deposit');
  $effect(() => {
    creditOverAction = data.pmsLink.creditOverAction;
  });
  async function changeCreditOverAction(next: CreditOverAction) {
    const prev = data.pmsLink.creditOverAction;
    if (creditBusy || next === prev || !isSelectableCreditOverAction(next)) return;
    creditBusy = 'action';
    creditMessage = null;
    try {
      const result = await postPmsAction('setCreditOverAction', { action: next });
      if (result.type === 'success') {
        await invalidateAll();
        creditMessage = { kind: 'ok', text: `超過時の挙動を「${CREDIT_OVER_ACTION_OPTIONS.find((o) => o.id === next)?.label ?? next}」にしました。以後の予約から反映されます。` };
      } else {
        creditOverAction = prev;
        creditMessage = { kind: 'error', text: failureText(result, '超過時の挙動を保存できませんでした。') };
      }
    } catch {
      creditOverAction = prev;
      creditMessage = { kind: 'error', text: '通信状況を確認して、もう一度お試しください。' };
    } finally {
      creditBusy = null;
    }
  }
  // デポジット（Phase 3b）: 超過時の挙動が deposit のときの額の決め方・残額の精算先（管理者だけ・押した時点で保存）
  type DepositFormState = { type: CreditDepositType; value: string; remainder: '' | 'invoice' | 'onsite' };
  const depositFormOf = (): DepositFormState => ({
    type: data.pmsLink.creditDeposit.type,
    value: data.pmsLink.creditDeposit.type === 'first_night' ? '' : String(data.pmsLink.creditDeposit.value),
    remainder: data.pmsLink.creditDepositRemainder ?? ''
  });
  let depositForm = $state<DepositFormState>({ type: 'percent', value: '30', remainder: '' });
  // 保存済みの値が変わったときだけ入れ替える（他の操作の読み直しで編集中の値を消さない）
  let depositLoaded = '';
  $effect(() => {
    const f = depositFormOf();
    const key = JSON.stringify(f);
    if (key === depositLoaded) return;
    depositLoaded = key;
    untrack(() => (depositForm = f));
  });
  const depositDirty = $derived.by(() => {
    const cur = depositFormOf();
    return cur.type !== depositForm.type || cur.remainder !== depositForm.remainder || (depositForm.type !== 'first_night' && cur.value !== depositForm.value.trim());
  });
  let depositBusy = $state(false);
  let depositMessage = $state<{ kind: 'error' | 'ok'; text: string } | null>(null);
  async function saveCreditDeposit() {
    if (depositBusy) return;
    depositBusy = true;
    depositMessage = null;
    try {
      const result = await postPmsAction('setCreditDeposit', { type: depositForm.type, value: depositForm.value, remainder: depositForm.remainder });
      if (result.type === 'success') {
        await invalidateAll();
        depositMessage = { kind: 'ok', text: 'デポジットの設定を保存しました。以後の予約から反映されます。' };
      } else {
        depositMessage = { kind: 'error', text: failureText(result, 'デポジットの設定を保存できませんでした。') };
      }
    } catch {
      depositMessage = { kind: 'error', text: '通信状況を確認して、もう一度お試しください。' };
    } finally {
      depositBusy = false;
    }
  }
  // Enter で外側の「保存する」フォームを送らない
  const noSubmitOnEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  // 請求書の宛名の既定（入力欄が空のとき）: 紐づけ先の正式名称 → 取引先名
  // 宛名の既定（請求書の発行と同じ順）: 紐づけ先の正式名称 → 取引先名。正式名称が空の顧客は取引先名
  const linkedRecipient = $derived(data.pmsLink.guest?.recipientName ?? '');
  const defaultRecipientName = $derived(linkedRecipient || settings.name);

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
      <h2 class="text-lg font-bold text-stone-900">限定URL</h2>
      <p class="mt-1 text-xs text-stone-500">この取引先専用のログイン画面です。下で発行したログインIDとパスワードでログインします。「確認ページを開く」は、ログインなしでこの取引先から見た画面を開きます（2時間・見るだけで、予約の確定・取消はできません）。</p>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <code class="break-all rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs">{data.portalUrl}</code>
        <button type="button" class={smallBtn} onclick={() => copy(data.portalUrl)}>コピー</button>
        <!-- 取引先のアカウントなしで、その取引先から見た画面を開く（確認モード・予約の確定はできない） -->
        <a href={`/admin/partners/${data.partner.id}/preview`} target="_blank" rel="noopener" class={`${smallBtn} border-brand-900 font-bold text-brand-900`}>確認ページを開く ↗</a>
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
      <h2 class="text-lg font-bold text-stone-900">覚書</h2>
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

      <h3 class="mt-5 text-[15px] font-bold text-stone-800">ファイル</h3>
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
      <h2 class="mb-3 text-lg font-bold text-stone-900">公開設定</h2>
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

      <!-- PMS の顧客マスタとの紐づけ（Phase 1・docs/partner-pms-customer-link.md §6.1）。保存フォームとは別に即時保存 -->
      <section class="mt-6 rounded-lg border border-stone-200 bg-stone-50/60 p-4">
        <h3 class="text-base font-bold text-stone-900">PMS の顧客マスタとの紐づけ</h3>
        <p class="mt-1 text-xs leading-5 text-stone-500">
          この取引先を、PMS の顧客マスタにある旅行会社・法人に紐づけます。紐づけると、<strong class="font-medium text-stone-700">この取引先からの予約の「予約者」として PMS にこの顧客が入ります</strong>（PMS の顧客カルテの紹介実績に数えられます）。宿泊者（代表者）はこれまでどおりお客様です（予約名義を「旅行会社名で取る」にしたときは、代表者がこの顧客になります）。
          紐づけ・解除・予約名義は押した時点で保存されます（下の「保存する」は不要です）。
        </p>
        {#if pmsMessage}
          <p class={`mt-2 rounded-md px-3 py-1.5 text-xs ${pmsMessage.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>{pmsMessage.text}</p>
        {/if}
        {#if data.pmsLink.error}
          <p class="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">紐づけ先を読み込めませんでした（{data.pmsLink.error}）</p>
        {/if}

        {#if data.pmsLink.guestId}
          <div class="mt-3 flex flex-wrap items-start justify-between gap-3 rounded-md border border-stone-200 bg-white p-3">
            {#if data.pmsLink.guest}
              {@const g = data.pmsLink.guest}
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class={`rounded-full px-2 py-0.5 text-[11px] ${g.guestType === 'group' ? 'bg-brand-100 text-brand-800' : 'bg-stone-200 text-stone-700'}`}>{PMS_PARTNER_GUEST_TYPE_LABELS[g.guestType]}</span>
                  <span class="font-medium text-stone-900">{g.formalName}</span>
                  {#if g.branch}<span class="text-xs text-stone-500">{g.branch}</span>{/if}
                </div>
                <p class="mt-0.5 text-xs text-stone-500">顧客コード: {g.guestCode ?? '—'}{#if g.kana}・{g.kana}{/if}</p>
                <a href={g.url} target="_blank" rel="noopener" class="mt-1 inline-block text-xs text-brand-800 underline">PMS の顧客カルテを開く ↗</a>
              </div>
            {:else if !data.pmsLink.error}
              <p class="text-sm text-amber-800">紐づけ先の顧客が見つかりません（PMS で削除・種別変更された可能性があります）。紐づけを外して、選び直してください。</p>
            {/if}
            {#if canEdit}
              <button type="button" class={smallBtn} disabled={pmsBusy !== null} onclick={unlinkPmsGuest}>{pmsBusy === 'unlink' ? '解除中…' : '紐づけを外す'}</button>
            {/if}
          </div>
          {#if data.pmsLink.guest}
            <!-- 予約名義（Phase 2・決定 #4）。紐づけ先が読めるときだけ。name は付けない（「保存する」の送信に混ぜない） -->
            <fieldset class="mt-3 rounded-md border border-stone-200 bg-white p-3" disabled={!canEdit || nameModeBusy || pmsBusy !== null}>
              <legend class="px-1 text-sm font-bold text-stone-800">予約名義</legend>
              <label class="flex items-start gap-2 py-1 text-sm">
                <input type="radio" value="guest" bind:group={nameMode} onchange={() => changeNameMode('guest')} class="mt-1" />
                <span>宿泊者名で取る<span class="block text-xs text-stone-500">PMS の代表者＝お客様・予約者＝この顧客</span></span>
              </label>
              <label class="flex items-start gap-2 py-1 text-sm">
                <input type="radio" value="partner" bind:group={nameMode} onchange={() => changeNameMode('partner')} class="mt-1" />
                <span>旅行会社名で取る<span class="block text-xs text-stone-500">PMS の代表者＝この顧客・お客様は部屋別の宿泊者名。お客様の顧客台帳は作りません</span></span>
              </label>
              <p class="mt-1 text-[11px] text-stone-400">
                選んだ時点で保存され、以後の予約から反映されます（予約済みの分は変わりません）。紐づけを外すと「宿泊者名で取る」に戻ります。{#if nameModeBusy}保存中…{/if}
              </p>
            </fieldset>
            {#if data.pmsLink.credit}
              {@const credit = data.pmsLink.credit}
              <!-- 与信（受付枠・Phase 3a・§6.1）。紐づけ先が旅行会社のときだけ（法人・未紐づけでは出さない）。入力欄に name は付けない -->
              <div class="mt-3 rounded-md border border-stone-200 bg-white p-3">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <h4 class="text-sm font-bold text-stone-800">与信（月別の受付枠）</h4>
                  <a href={credit.pmsCreditUrl} target="_blank" rel="noopener" class="text-xs text-brand-800 underline">PMS の与信画面を開く ↗</a>
                </div>
                <p class="mt-1 text-xs leading-5 text-stone-500">
                  PMS の旅行会社の与信管理と同じ設定です（どちらで変えても同じ値）。上限＝過去3年の同月の送客実績の平均×（1＋増加率）、ただし最低枠を下回りません。{CREDIT_UNIT_NOTE}
                  取引先ページには月ごとの残り室数を出します。枠を超える予約には、宿への通知メール・予約一覧・PMS の備考に【受付枠超過】の印が付きます。超えたときの受け方は下の「受付枠を超えたとき」で選びます。
                </p>
                {#if creditMessage}
                  <p class={`mt-2 rounded-md px-3 py-1.5 text-xs ${creditMessage.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>
                    {creditMessage.text}
                    {#if creditMessage.conflict}<button type="button" class="ml-2 underline" disabled={creditBusy !== null} onclick={reloadAgencyCredit}>読み直す</button>{/if}
                  </p>
                {/if}
                {#if credit.error}
                  <p class="mt-2 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-700">与信を読み込めませんでした（{credit.error}）</p>
                {/if}
                {#if credit.state}
                  <!-- 設定（決定 #7・N4: 編集は管理者だけ。スタッフは表示のみ） -->
                  <fieldset class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" disabled={!canEdit || creditBusy !== null}>
                    <label class="flex items-center gap-2 self-end pb-1.5 text-sm">
                      <input type="checkbox" bind:checked={creditForm.enabled} />
                      <span class="font-medium">与信管理をする</span>
                    </label>
                    <label class="block">
                      <span class="mb-0.5 block text-xs text-stone-500">増加率（％）</span>
                      <input type="text" inputmode="decimal" bind:value={creditForm.growthRate} onkeydown={noSubmitOnEnter} placeholder="0" maxlength="8" class={inputClass} />
                    </label>
                    <label class="block">
                      <span class="mb-0.5 block text-xs text-stone-500">最低枠（室/月）</span>
                      <input type="text" inputmode="numeric" bind:value={creditForm.minRooms} onkeydown={noSubmitOnEnter} placeholder="0" maxlength="5" class={inputClass} />
                    </label>
                    <label class="block sm:col-span-2 lg:col-span-4">
                      <span class="mb-0.5 block text-xs text-stone-500">運用メモ（社内用・取引先には出ません）</span>
                      <textarea bind:value={creditForm.note} rows="2" maxlength="500" class={inputClass}></textarea>
                    </label>
                  </fieldset>
                  <div class="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <p class="text-[11px] text-stone-500">
                      {credit.updatedAt ? `book で最後に保存: ${dt(credit.updatedAt)}（${credit.updatedSource}）` : '最終更新: PMS などで設定'}
                      {#if !credit.updatedAt}<span class="text-stone-400">（PMS で保存した日時は記録されません）</span>{/if}
                    </p>
                    {#if canEdit}
                      <button type="button" class={smallBtn} disabled={creditBusy !== null || !creditDirty} onclick={saveAgencyCredit}>{creditBusy === 'save' ? '保存中…' : '与信の設定を保存'}</button>
                    {:else}
                      <p class="text-[11px] text-stone-400">与信の設定は管理者だけが変えられます。</p>
                    {/if}
                  </div>

                  <!-- 今後 12 か月の月別（上限・予約済み・残り）。与信 OFF なら判定しない -->
                  {#if credit.state.enabled && credit.months.length}
                    <div class="mt-3 overflow-x-auto">
                      <table class="w-full text-xs tabular-nums">
                        <thead class="text-left text-stone-500">
                          <tr><th class="py-1 pr-3 font-medium">月</th><th class="pr-3 text-right font-medium">基準（実績平均）</th><th class="pr-3 text-right font-medium">上限</th><th class="pr-3 text-right font-medium">予約済み</th><th class="pr-3 text-right font-medium">残り</th><th class="font-medium"></th></tr>
                        </thead>
                        <tbody>
                          {#each credit.months as m (m.month)}
                            {@const rest = creditRemainingBefore(m)}
                            <tr class={`border-t border-stone-100 ${rest < 0 ? 'bg-amber-50' : ''}`}>
                              <td class="py-1 pr-3 whitespace-nowrap">{creditMonthLabel(m.month)}</td>
                              <td class="pr-3 text-right text-stone-500">{m.baseline}</td>
                              <td class="pr-3 text-right">{m.limit} 室</td>
                              <td class="pr-3 text-right">{m.booked} 室</td>
                              <td class={`pr-3 text-right ${rest <= 0 ? 'font-bold text-amber-800' : ''}`}>{rest} 室</td>
                              <td>{#if rest < 0}<span class="rounded-full bg-amber-100 px-1.5 py-px text-[11px] text-amber-800">超過 {-rest} 室</span>{:else if rest === 0}<span class="text-[11px] text-stone-500">満枠</span>{/if}</td>
                            </tr>
                          {/each}
                        </tbody>
                      </table>
                    </div>
                  {:else if !credit.state.enabled}
                    <p class="mt-3 text-xs text-stone-500">与信管理がオフのため、受付枠は判定しません（取引先ページにも残り室数は出ません）。</p>
                  {/if}

                  <!-- 超過時の挙動（rms_partners.credit_over_action）。deposit は 3b まで選べない（表示だけ・いまは warn と同じ動き） -->
                  <fieldset class="mt-3 border-t border-stone-100 pt-2" disabled={!canEdit || creditBusy !== null}>
                    <legend class="pt-2 text-xs font-bold text-stone-700">受付枠を超えたとき</legend>
                    {#each CREDIT_OVER_ACTION_OPTIONS as o (o.id)}
                      {#if o.selectable || creditOverAction === o.id}
                        <label class="flex items-start gap-2 py-1 text-sm">
                          <input type="radio" value={o.id} bind:group={creditOverAction} disabled={!o.selectable} onchange={() => changeCreditOverAction(o.id)} class="mt-1" />
                          <span>{o.label}<span class="block text-xs text-stone-500">{o.note}</span></span>
                        </label>
                      {/if}
                    {/each}
                    <p class="mt-1 text-[11px] text-stone-400">選んだ時点で保存されます。{#if creditBusy === 'action'}保存中…{/if}</p>
                  </fieldset>

                  {#if creditOverAction === 'deposit'}
                    <!-- デポジット（Phase 3b・§5.3）: 額の決め方と残額の精算先（取引先ごと）。入力欄に name は付けない（「保存する」に混ぜない） -->
                    <fieldset class="mt-3 border-t border-stone-100 pt-2" disabled={!canEdit || depositBusy}>
                      <legend class="pt-2 text-xs font-bold text-stone-700">デポジット（受付枠を超えた予約で予約時に受ける額）</legend>
                      {#if depositMessage}
                        <p class={`mt-1 rounded-md px-3 py-1.5 text-xs ${depositMessage.kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'}`}>{depositMessage.text}</p>
                      {/if}
                      <div class="mt-1 grid gap-1">
                        {#each CREDIT_DEPOSIT_TYPES as t (t.id)}
                          <label class="flex flex-wrap items-center gap-2 py-0.5 text-sm">
                            <input type="radio" value={t.id} bind:group={depositForm.type} />
                            <span>{t.label}</span>
                            {#if t.id !== 'first_night' && depositForm.type === t.id}
                              <input type="text" inputmode="numeric" bind:value={depositForm.value} onkeydown={noSubmitOnEnter} maxlength="9" class="w-28 rounded-md border border-stone-300 bg-white px-2 py-1 text-sm" />
                              <span class="text-xs text-stone-500">{t.unit}</span>
                            {/if}
                            <span class="text-xs text-stone-500">{t.note}</span>
                          </label>
                        {/each}
                      </div>
                      <div class="mt-2 text-sm">
                        <span class="block text-xs text-stone-500">残額の精算</span>
                        <label class="mr-4 inline-flex items-center gap-1.5"><input type="radio" value="" bind:group={depositForm.remainder} />既定（いまは{data.pmsLink.creditDepositRemainderDefault === 'invoice' ? '請求書' : '現地'}）</label>
                        <label class="mr-4 inline-flex items-center gap-1.5"><input type="radio" value="invoice" bind:group={depositForm.remainder} />月末の請求書で取引先へ</label>
                        <label class="inline-flex items-center gap-1.5"><input type="radio" value="onsite" bind:group={depositForm.remainder} />現地でお客様から</label>
                      </div>
                      <p class="mt-1.5 text-[11px] leading-5 text-stone-500">
                        いまの設定: {describeCreditDeposit(data.pmsLink.creditDeposit)}・残額は{(data.pmsLink.creditDepositRemainder ?? data.pmsLink.creditDepositRemainderDefault) === 'invoice' ? '月末の請求書' : '現地'}。
                        デポジットに予約時決済の割引は付きません。請求額（宿泊料金＋入湯税）を超えません。既定の精算先は、請求書払いの支払方法（月末締め・請求書で精算する自由入力）があれば請求書、無ければ現地です。
                        取消時はデポジットをキャンセル料に充当して差額を返金し、キャンセル料がデポジットを超えた分は、残額の精算先にかかわらず月末の請求書でご請求します（不課税）。
                      </p>
                      {#if canEdit}
                        <button type="button" class={`${smallBtn} mt-2`} disabled={depositBusy || !depositDirty} onclick={saveCreditDeposit}>{depositBusy ? '保存中…' : 'デポジットの設定を保存'}</button>
                      {:else}
                        <p class="mt-1 text-[11px] text-stone-400">デポジットの設定は管理者だけが変えられます。</p>
                      {/if}
                    </fieldset>
                  {/if}
                {/if}
              </div>
            {/if}
          {/if}
        {:else}
          <p class="mt-3 text-sm text-stone-600">未紐づけです。</p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <!-- name を付けない（「保存する」の送信に混ぜない）。Enter は保存ではなく検索にする -->
            <input
              type="search"
              bind:value={pmsQuery}
              maxlength="50"
              placeholder="旅行会社名・法人名・かな・顧客コード"
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  searchPmsGuests();
                }
              }}
              class="w-full max-w-sm rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm"
            />
            <button type="button" class={smallBtn} disabled={!pmsQuery.trim() || pmsBusy !== null} onclick={searchPmsGuests}>{pmsBusy === 'search' ? '検索中…' : '検索'}</button>
          </div>
          <p class="mt-1 text-[11px] text-stone-400">PMS の種別「旅行会社」「法人」の顧客だけが候補に出ます（最大20件）。</p>
          {#if pmsResults}
            {#if pmsResults.length === 0}
              <p class="mt-2 text-xs text-stone-500">「{pmsSearchedQuery}」に当てはまる旅行会社・法人は見つかりませんでした。</p>
            {:else}
              <ul class="mt-2 divide-y divide-stone-100 rounded-md border border-stone-200 bg-white">
                {#each pmsResults as g (g.id)}
                  <li class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <span class={`rounded-full px-2 py-0.5 text-[11px] ${g.guestType === 'group' ? 'bg-brand-100 text-brand-800' : 'bg-stone-200 text-stone-700'}`}>{PMS_PARTNER_GUEST_TYPE_LABELS[g.guestType]}</span>
                        <span class="text-sm font-medium text-stone-900">{g.formalName}</span>
                        {#if g.branch}<span class="text-xs text-stone-500">{g.branch}</span>{/if}
                      </div>
                      <p class="mt-0.5 text-[11px] text-stone-500">顧客コード: {g.guestCode ?? '—'}{#if g.kana}・{g.kana}{/if}・<a href={g.url} target="_blank" rel="noopener" class="underline">カルテ ↗</a></p>
                    </div>
                    {#if canEdit}
                      <button type="button" class={smallBtn} disabled={pmsBusy !== null} onclick={() => linkPmsGuest(g)}>この顧客に紐づける</button>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        {/if}
      </section>

      <h2 class="mb-1 mt-6 text-lg font-bold text-stone-900">特別レート</h2>
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
      <h2 class="mb-1 mt-8 text-lg font-bold text-stone-900">予約受付</h2>
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
            <h3 class="mb-1.5 text-[15px] font-bold text-stone-800">支払方法（複数可） {#if settings.bookingEnabled}<span class="text-xs font-normal text-rose-700">1つ以上必須</span>{/if}</h3>
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
            {#if data.savedCards}
              <!-- 取引先のお支払いカード（保存カード・2026-10-07）: 枚数と最終登録だけ（操作は取引先ページの「アカウント → お支払いカード」） -->
              <p class="mt-1.5 text-xs text-stone-600">お支払いカード（取引先が保存したカード）: {data.savedCards.count} 枚{#if data.savedCards.lastAt}（最終登録 {new Date(data.savedCards.lastAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' })}）{/if}</p>
            {/if}
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
          <h3 class="mb-1.5 mt-3 border-t border-stone-300 pt-5 text-[15px] font-bold text-stone-800">この取引先だけ追加で聞く項目 <span class="text-xs font-normal text-stone-500">（回答は PMS の予約備考に入ります）</span></h3>
          <p class="mb-2 text-[11px] text-stone-500">
            プランで設定した「予約時に聞く項目」（<a href="/admin/booking-questions" class="underline">テンプレート</a>またはプラン独自）の後ろに、この取引先からの予約のときだけ足して聞きます。
          </p>
          <BookingQuestionsEditor bind:questions={booking.options} />
          <p class="mt-1 text-[11px] text-stone-500">宿泊者名・人数・電話・メール・住所・食物アレルギー・到着予定・備考は、項目を足さなくても毎回聞きます。</p>
        </div>

        <div>
          <h3 class="mb-1.5 mt-3 border-t border-stone-300 pt-5 text-[15px] font-bold text-stone-800">取引先特典 <span class="text-xs font-normal text-stone-500">（最大{MAX_PARTNER_PERKS}件）</span></h3>
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
                <div class="flex flex-wrap items-center gap-2">
                  {#if perk.imageUrl}
                    <img src={perk.imageUrl} alt={perk.title} class="h-16 w-24 rounded-md border border-stone-200 object-cover" />
                  {/if}
                  <label class={`${smallBtn} cursor-pointer ${perkUploading ? 'pointer-events-none opacity-50' : ''}`}>
                    {perkUploading === perk.id ? 'アップロード中…' : perk.imageUrl ? '画像を差し替え' : '画像を追加'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" class="hidden" disabled={!!perkUploading} onchange={(e) => onPerkImagePicked(perk, e)} />
                  </label>
                  {#if perk.imageUrl}
                    <button type="button" class={smallBtn} disabled={!!perkUploading} onclick={() => sendPerkImage(perk, null)}>画像を外す</button>
                  {/if}
                  <span class="text-[11px] text-stone-400">任意。JPEG・PNG・WebP（10MBまで）。選ぶとすぐ保存され、取引先の画面に出ます（追加したばかりの特典は「保存する」で確定）。</span>
                  {#if perkImageError?.id === perk.id}<span class="text-[11px] text-rose-700">{perkImageError.text}</span>{/if}
                </div>
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
          <label class="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" bind:checked={booking.showOfficialPerks} class="mt-0.5" />
            <span>公式HP限定特典もこの取引先ページに出す<span class="block text-[11px] text-stone-500">プラン紹介文テンプレートの「特典」（例: 貸切露天風呂 無料）を、取引先特典と並べてバナーで出します。公式HPからの予約の特典なので、出すのは取引先からの予約にも付けるときだけ。</span></span>
          </label>
        </div>

        <div>
          <h3 class="mb-1.5 mt-3 border-t border-stone-300 pt-5 text-[15px] font-bold text-stone-800">プラン名（取引先向け）</h3>
          <p class="mb-2 text-[11px] leading-5 text-stone-500">
            取引先ページ・取引先宛てのメール・請求書に出すプラン名です。空欄のプランは右の既定の名前で出ます。PMS・宿への通知には元のプラン名のまま届きます。
          </p>
          <div class="grid gap-1.5">
            {#each namePlanOptions as plan (plan.code)}
              <div class="grid items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:gap-3">
                <div class="min-w-0 text-xs text-stone-500">
                  <span class="font-mono">{plan.code}</span> <span class="break-all">{plan.label}</span>
                </div>
                <input
                  value={booking.planNames[plan.code] ?? ''}
                  oninput={(e) => setPlanName(plan.code, e.currentTarget.value)}
                  maxlength="60"
                  placeholder={displayPlanName(plan.label)}
                  class={inputClass}
                />
              </div>
            {:else}
              <span class="text-[11px] text-stone-400">販売対象のプランがありません（特別レートで「調整して出す」ルールを作ると出ます）。</span>
            {/each}
          </div>
        </div>

        <h3 class="mb-1.5 mt-3 border-t border-stone-300 pt-5 text-[15px] font-bold text-stone-800">通知メール</h3>
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

        <div>
          <h3 class="mb-1.5 mt-3 border-t border-stone-300 pt-5 text-[15px] font-bold text-stone-800">ご請求書（月次）</h3>
          <div class="grid gap-3 sm:grid-cols-2">
            <label class="block">
              <span class="mb-0.5 block text-xs text-stone-500">ご請求書の宛名（正式社名）</span>
              <input bind:value={booking.invoiceRecipientName} maxlength="120" placeholder={defaultRecipientName || '例: 株式会社〇〇'} class={inputClass} />
              <span class="mt-0.5 block text-[11px] text-stone-500">空欄なら{linkedRecipient ? 'PMS の紐づけ先の正式名称' : '取引先名'}（{defaultRecipientName || '未入力'}）で発行します。「御中」は自動で付きます。</span>
            </label>
            <div>
              <span class="mb-0.5 block text-xs text-stone-500">お支払期限</span>
              <div class="flex flex-wrap items-center gap-2">
                <select value={booking.invoiceDue.type} onchange={(e) => setInvoiceDueType(e.currentTarget.value)} class="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm">
                  <option value="next_month_end">翌月末</option>
                  <option value="next_month_day">翌月の指定日</option>
                </select>
                {#if booking.invoiceDue.type === 'next_month_day'}
                  <select value={String(booking.invoiceDue.day)} onchange={(e) => setInvoiceDueDay(e.currentTarget.value)} class="rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm" aria-label="お支払期限の日">
                    {#each Array.from({ length: 28 }, (_, i) => i + 1) as d}<option value={String(d)}>{d}日</option>{/each}
                  </select>
                {/if}
              </div>
              <span class="mt-0.5 block text-[11px] text-stone-500">
                {describeInvoiceDue(booking.invoiceDue)}（例: {periodLabel(data.invoices.currentPeriod)}分 → {invoiceDueDate(data.invoices.currentPeriod, booking.invoiceDue)}）。過去の月をあとから発行して期限が発行日より前になるときは、発行月を基準に同じ規則で決めます。
              </span>
            </div>
          </div>
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
          <h2 class="text-lg font-bold text-stone-900">プレビュー（取引先に見える価格）</h2>
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
          <h2 class="text-lg font-bold text-stone-900">予約一覧</h2>
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
                  <td class="py-2 pr-3 font-mono text-xs">{b.code}{#if b.attachmentCount}<span class="ml-1 font-sans whitespace-nowrap" title="添付ファイル（予約管理の詳細で見る・追加・削除）">📎 {b.attachmentCount}</span>{/if}<div class="font-sans text-[11px] text-stone-500">{dt(b.createdAt)}{b.bookedBy ? ` ${b.bookedBy}` : ''}</div></td>
                  <td class="py-2 pr-3 whitespace-nowrap">{b.checkIn}<span class="text-xs text-stone-500"> {b.nights}泊</span></td>
                  <td class="py-2 pr-3">
                    {b.guestName}{#if b.nameMode === 'partner'}<span class="ml-1 rounded-full bg-brand-100 px-1.5 py-px text-[11px] whitespace-nowrap text-brand-800">旅行会社名義</span>{/if}{#if b.creditOver && b.status !== 'cancelled' && b.status !== 'expired'}<span class="ml-1 rounded-full bg-amber-100 px-1.5 py-px text-[11px] whitespace-nowrap text-amber-800" title={b.creditOverText ?? ''}>受付枠超過</span>{/if}<div class="text-[11px] text-stone-500">{b.phone ?? ''}</div>
                    {#if b.nameLine}<div class="text-[11px] text-stone-500">{b.nameLine}</div>{/if}
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
                    {#if b.paymentName}<div class="text-[11px] text-stone-500">{b.paymentName}{b.paymentStatus === 'paid' ? '・支払済' : b.paymentStatus === 'refunded' ? '・返金済' : b.paymentStatus === 'scheduled' ? `・チェックアウト日に請求${b.cardLabel ? `（${b.cardLabel}）` : ''}` : ''}</div>{/if}
                    {#if b.depositText}<div class="text-[11px] font-medium text-amber-800">{b.depositText}</div>{/if}
                    {#if b.billedToPartner}<div class="mt-0.5"><span class="rounded-full border border-red-300 bg-red-50 px-1.5 py-px text-[11px] font-bold whitespace-nowrap text-red-700">取引先へ請求（お客様には請求しない）</span></div>{/if}
                    {#if b.cardConsentAt}<div class="text-[11px] text-stone-500" title={b.cardConsentText ?? ''}>請求の同意: {dt(b.cardConsentAt)}</div>{/if}
                    {#if b.paymentStatus === 'charge_failed'}<div class="text-[11px] text-rose-700">請求失敗{b.chargeError ? `：${b.chargeError}` : ''}</div>{/if}
                    {#if b.paymentStatus === 'refund_failed'}<div class="text-[11px] text-rose-700" title={b.refundError ?? ''}>返金失敗（Stripe で対応が必要）</div>{/if}
                    {#if b.cancelFee}<span class="block text-xs text-stone-700">キャンセル料 {b.cancelFee.fee > 0 ? `${b.cancelFee.fee.toLocaleString('ja-JP')}円（${b.cancelFee.basis}・不課税）${b.cancelFee.settlement ? ` ${b.cancelFee.settlement}` : ''}` : `なし${b.cancelFee.waived ? '（免除）' : ''}`}{#if b.cancelFee.kept}<span class="block text-stone-600">{b.cancelFee.kept}</span>{/if}{#if b.cancelFee.note}<span class="text-stone-500">・{b.cancelFee.note}</span>{/if}{#if b.cancelFee.status === 'charge_failed'}<span class="block text-rose-700">カードへの請求に失敗したため請求書へ回しました{b.cancelFee.error ? `（${b.cancelFee.error}）` : ''}</span>{/if}</span>{/if}
                  </td>
                  <td class="py-2 text-right">
                    {#if canEdit && b.status === 'confirmed' && b.paymentOption === 'online_checkin' && (b.paymentStatus === 'charge_failed' || (b.paymentStatus === 'scheduled' && b.checkOut <= todayIso))}
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
                          class="flex w-[26rem] max-w-full flex-wrap items-center justify-end gap-1.5 text-left"
                        >
                          <input type="hidden" name="booking_id" value={b.id} />
                          <div class="w-full"><PartnerCancelFeeFields preview={b.cancelPreview} paid={b.paymentStatus === 'paid'} card={b.hasCard} invoiceMonth={b.invoiceMonth} /></div>
                          <input name="reason" maxlength="500" placeholder="理由（任意）" class="w-32 rounded-md border border-stone-300 bg-white px-2 py-1 text-xs" />
                          {#if b.paymentStatus === 'paid'}<label class="flex items-center gap-1 text-[11px]"><input type="checkbox" name="refund" checked />返金する</label>{/if}
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

    <!-- ご請求書（ご利用明細書＋適格請求書） -->
    <div class="mb-6 rounded-xl border border-stone-200 bg-white p-5">
      <h2 class="text-lg font-bold text-stone-900">ご請求書</h2>
      <p class="mt-1 text-xs leading-5 text-stone-500">
        チェックアウト日基準・月末締めで、ご利用明細書とご請求書（適格請求書）をセットで発行します。月末日の15:00に自動で発行し、取引先（連絡先メール・マスタユーザー）へメールで送ります。
        金額は予約時の金額です。ご請求の対象は「月末締め翌月末銀行振込」と「請求書で精算する」にした自由入力の支払方法だけで、それ以外はご利用明細に 0 円のご請求として載ります。お支払期限は「予約受付」の設定（この取引先は{describeInvoiceDue(data.partner.bookingSettings.invoiceDue)}）、宛名は{data.partner.bookingSettings.invoiceRecipientName ? `「${data.partner.bookingSettings.invoiceRecipientName}」` : linkedRecipient ? `PMS の紐づけ先の正式名称「${linkedRecipient}」` : '取引先名'}です。取引先は取引先ページの「アカウント → ご請求書」からいつでもダウンロードできます。
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
        <p class="mt-3 text-sm text-stone-500">まだご請求書はありません。</p>
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
          <div class="ml-auto flex flex-wrap items-center gap-1.5">
            <a class={smallBtn} href={`/admin/partners/${data.partner.id}/invoices/preview?period=${data.invoices.period}&format=html`} target="_blank" rel="noopener">予定請求書を見る</a>
            <a class={smallBtn} href={`/admin/partners/${data.partner.id}/invoices/preview?period=${data.invoices.period}&format=pdf`} data-sveltekit-reload>予定請求書 PDF</a>
            <a class="text-xs text-brand-800 hover:underline" href={`/admin/partners/invoices?period=${invoiceMonth}`}>全取引先の予定請求書 →</a>
          </div>
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
              ご請求 {yen(pv.totals.billedTotal)}円（10%対象 {yen(pv.totals.taxable10)}円・うち消費税 {yen(pv.totals.tax10)}円／入湯税〔不課税〕 {yen(pv.totals.nonTaxable)}円{pv.totals.cancelFee ? `／キャンセル料〔不課税〕 ${yen(pv.totals.cancelFee)}円` : ''}）・お支払い済み・別途精算 {yen(pv.totals.paidTotal)}円・お支払期限 {pv.dueDate}
              {#if pv.totals.billedTotal === 0}<span class="text-stone-500">（ご請求 0 円のため、ご利用明細書だけを発行します）</span>{/if}
              <span class="block text-stone-500">宛名: {pv.recipient.name} 御中（宛名・お支払期限は保存済みの設定で計算しています）</span>
            </p>
            {#if data.invoices.chargeFailed.length}
              <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                カード決済（チェックアウト日）が失敗したままの予約があります：{data.invoices.chargeFailed.join('、')}。ご請求書には「カード決済失敗（要確認）」として載り、ご請求には含めません。予約の画面で再請求するか、別途ご精算ください。
              </p>
            {/if}
          {/if}

          {#if canEdit && pv.lines.length > 0}
            <form
              method="POST"
              action={`?/issueInvoice`}
              use:enhance={async ({ formData, cancel }) => {
                const send = formData.get('send') !== null;
                const msg = `${periodLabel(data.invoices.period)}分のご請求書を発行${send ? 'し、取引先へメールで送信' : ''}します。同じ月は1枚だけです（作り直すには取消が必要です）。${issuingMidMonth ? '\n※ 月の途中です。今日より後にチェックアウトする予約は載りません。' : ''}${data.invoices.chargeFailed.length ? `\n※ カード決済が失敗したままの予約（${data.invoices.chargeFailed.join('、')}）は請求しません。` : ''}`;
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
      <h2 class="text-lg font-bold text-stone-900">ログインID</h2>
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
      <h2 class="text-lg font-bold text-stone-900">REST API</h2>
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
      <h2 class="text-lg font-bold text-stone-900">アクセスログ（直近50件）</h2>
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
