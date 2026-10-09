<script lang="ts">
  import { partnerTitle } from '$lib/partner-title';
  import { untrack } from 'svelte';
  import { adminFeeNotice } from '$lib/cancel-admin-fee';
  import PerkBanners from '$lib/components/PerkBanners.svelte';
  import PartnerTermsTable from '$lib/components/PartnerTermsTable.svelte';
  import MarkdownView from '$lib/components/MarkdownView.svelte';
  import PerkModal, { type PerkModalContent } from '$lib/components/PerkModal.svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import PartnerPriceTable from '$lib/components/PartnerPriceTable.svelte';
  import StripePayment from '$lib/components/payment/StripePayment.svelte';
  import type { PaymentConfirmed, PaymentPrepareResult } from '$lib/components/payment/types';
  import { partnerAccent } from '$lib/partner-theme';
  import { fetchPartnerCustomerSession } from '$lib/partner-saved-cards';
  import { SAVED_CARD_EXPIRY_WARNING, selectedCardExpiresBefore, type SavedCardExp } from '$lib/saved-cards';
  import { quoteChargeOf } from '$lib/partner-booking';
  import { bookingNameHolderText } from '$lib/pms-partner-guest';
  import { CREDIT_OVER_NOTICE, CREDIT_UNIT_NOTE, creditMonthText, type CreditMonth } from '$lib/partner-credit';
  import { expandQuestions, type BookingQuestion } from '$lib/booking-questions';
  import PartnerAttachments, { type AttachmentItem } from '$lib/components/PartnerAttachments.svelte';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string } } = $props();

  type Quote = PageData['quote'];
  type CreditView = { over: boolean; months: CreditMonth[] };

  // 表示用（金額・日付・時刻）
  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const hm = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
  };
  const init = untrack(() => data);
  const token = $derived($page.params.token);

  // ---- 宿泊条件 ----
  let checkIn = $state(init.target.checkIn);
  // キャンセル料が無料の最終日（最初に料率がかかる日の前日）。料率の段が無いプランは null（取消の期限まで無料）
  const todayIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const freeUntil = $derived.by(() => {
    if (data.cancelFeeFromDays == null || !checkIn) return null;
    const d = new Date(`${checkIn}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (data.cancelFeeFromDays + 1));
    return d.toISOString().slice(0, 10);
  });
  const ymdJa = (iso: string) => `${Number(iso.slice(0, 4))}年${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
  // 取消の帯の文言（最後の語 tail はⓘと同じ行に置く）
  const band = $derived(
    freeUntil === null
      ? data.cancelText
        ? { head: `宿泊日の${data.cancelText}、`, tail: 'キャンセル料無料' }
        : { head: '取消は宿へ', tail: 'ご連絡ください' }
      : freeUntil >= todayIso
        ? { head: `${ymdJa(freeUntil)}まで`, tail: 'キャンセル料無料' }
        : { head: 'キャンセル料が', tail: 'かかる期間です' }
  );
  let nights = $state(init.target.nights ?? 1);
  let roomCount = $state(init.target.roomCount ?? 1);
  let adults = $state<number[]>(Array.from({ length: init.target.roomCount ?? 1 }, () => Math.min(init.capacity.max, Math.max(init.capacity.min, init.target.guests))));
  $effect(() => {
    // 室数を増減したら、部屋ごとの人数の欄を揃える（増やした部屋は1室目の人数で始める）
    const n = roomCount;
    untrack(() => {
      if (adults.length === n) return;
      adults = Array.from({ length: n }, (_, i) => adults[i] ?? adults[0] ?? init.target.guests);
    });
  });

  let quote = $state<Quote>(init.quote);
  let canBook = $state(init.canBook);
  let quoting = $state(false);
  // 確定に失敗したとき（受付枠が埋まって後払いが選べなくなった等）に見積を取り直す
  let requote = $state(0);
  let seq = 0;
  $effect(() => {
    void requote;
    const body = { facilityId: data.portal.facilityId, roomCode: init.target.roomCode, planCode: init.target.planCode, planName: init.target.planName, checkIn, nights, rooms: adults.map((a) => ({ adults: a })) };
    const mine = ++seq;
    quoting = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/p/${token}/book/quote`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        if (res.status === 401) {
          location.href = `/p/${token}`;
          return;
        }
        const j = (await res.json()) as { quote: Quote; canBook: boolean };
        if (mine === seq) {
          quote = j.quote;
          canBook = j.canBook;
        }
      } catch {
        if (mine === seq) quote = { ok: false, message: '料金を計算できませんでした。通信状況をご確認ください。' };
      } finally {
        if (mine === seq) quoting = false;
      }
    }, 250);
    return () => clearTimeout(t);
  });

  // ---- 予約者・交通手段 ----
  // 交通手段（「その他」を選んだときだけ自由入力の欄を出す）
  let transport = $state('');
  const transportLabel = (id: string, other: string) => {
    const o = data.transportOptions.find((t) => t.id === id);
    if (!o) return '';
    return o.id === 'other' ? `その他${other ? `（${other}）` : ''}` : o.label;
  };

  // ---- 入力 → 確認 ----
  let step = $state<'input' | 'confirm'>('input');
  // お支払方法の選択肢。受付枠を超え、超過時の挙動が deposit のときは見積が差し替える（全額の予約時決済とデポジットだけ・Phase 3b）
  const payChoices = $derived(quote.ok && quote.paymentChoices ? quote.paymentChoices : data.paymentOptions);
  // 受付枠を超えたのにオンライン決済を出せない（Stripe 未接続）: 予約できない
  const noPayChoice = $derived(quote.ok && !!quote.paymentChoices && quote.paymentChoices.length === 0);
  // お支払方法（1つだけならそれに決まる）
  let paymentOption = $state(init.quote.ok && init.quote.paymentChoices ? (init.quote.paymentChoices[0]?.id ?? '') : (init.paymentOptions[0]?.id ?? ''));
  // 選択肢が差し替わったら、今の選択が無ければ先頭に
  $effect(() => {
    const ids = payChoices.map((o) => o.id);
    untrack(() => {
      if (!ids.includes(paymentOption)) paymentOption = ids[0] ?? '';
    });
  });
  const paymentLabel = $derived(payChoices.find((o) => o.id === paymentOption)?.label ?? '');
  // 請求書払い（取引先払い）: ご宿泊者様には請求しないことを支払方法の近くに出す（2026-10-02 指示）
  const billedToPartner = $derived(payChoices.find((o) => o.id === paymentOption)?.billable ?? false);
  // デポジット（受付枠を超えたときだけ・Phase 3b）。額は見積の見込み（確定時はサーバが計算し直す）
  const deposit = $derived(quote.ok ? quote.deposit : null);
  const isDeposit = $derived(paymentOption === 'deposit_online' && !!deposit);
  const BILLED_NOTE = 'ご宿泊者様へのご請求はありません（宿泊料金・入湯税は貴社へご請求します）';
  // 専用特典のモーダル
  let perkContent = $state<PerkModalContent | null>(null);
  // 右欄の料金明細の開閉
  let showBreakdown = $state(false);
  const num = (n: number) => n.toLocaleString('ja-JP');
  // 予約時決済の割引（選んだときだけ合計に効く）
  const prepay = $derived(quote.ok ? quote.prepay : null);
  // 金額の計算はサーバ（Intent の金額）と同じ純関数（lib/partner-booking.ts の quoteChargeOf）
  const charge = $derived(quote.ok ? quoteChargeOf(quote, paymentOption) : null);
  const discounted = $derived(!!charge?.discounted);
  // お支払い合計＝宿泊料金（割引後）＋入湯税
  const lodgingTotal = $derived(charge?.lodging ?? 0);
  const payTotal = $derived(charge?.charge ?? 0);
  let submitting = $state(false);
  let clientError = $state('');
  let formEl: HTMLFormElement | undefined = $state();
  const soldShort = $derived(quote.ok && quote.remaining != null && quote.remaining < roomCount);
  const ready = $derived(quote.ok && canBook && !soldShort && !quoting && !noPayChoice);

  // ---- オンライン決済（同じ画面で払う・lib/components/payment/StripePayment.svelte）----
  // 確定ボタン（または Apple Pay / Google Pay）で ① 予約を仮押さえ＋Intent（/book/reserve）② Stripe で確定
  // ③ 確定の連絡（/payment confirm）→ 予約一覧へ。カードが断られたら、仮押さえはそのままで別のカードを試せる。
  const isStripe = $derived(paymentOption === 'online' || paymentOption === 'online_checkin' || paymentOption === 'deposit_online');
  // 予約時にカードで払う額（デポジットはデポジットの額・それ以外は合計）
  const payNowAmount = $derived(isDeposit && deposit ? deposit.amount : payTotal);
  const payMode = $derived<'payment' | 'setup'>(paymentOption === 'online_checkin' ? 'setup' : 'payment');
  const accent = $derived(partnerAccent(data.portal.facilitySlug));
  const submitLabel = $derived(
    isDeposit
      ? `予約してデポジット ${yen(payNowAmount)} を支払う`
      : paymentOption === 'online'
        ? `予約して ${yen(payTotal)} を支払う`
        : paymentOption === 'online_checkin'
          ? '予約してカードを登録する'
          : 'この内容で予約を確定する'
  );
  type Pending = {
    bookingId: string;
    bookingCode: string;
    mode: 'payment' | 'setup';
    clientSecret: string;
    expiresAt: string | null;
    consentText: string | null;
    returnUrl: string;
  };
  // 仮押さえ中の予約（支払が通るまで。同じ予約・同じ Intent で再試行する）
  let pending = $state<Pending | null>(null);
  let payRef: { submit: () => Promise<boolean> } | undefined = $state();
  let paying = $state(false);
  let payError = $state('');
  let releasing = $state(false);
  // 期限の1分前を切った仮押さえは使わない（確定前に切れて返金になるため）
  const pendingUsable = (p: Pending) => !p.expiresAt || new Date(p.expiresAt).getTime() > Date.now() + 60_000;

  // ---- 添付ファイル（2026-10-07・PARTNER_BOOKING_ATTACHMENTS が on のときだけ）----
  // 1件ずつ仮置きし（/book/attachments）、id を hidden の attachment_ids で確定に渡す。DB 関数が予約に結ぶ。
  // 仮押さえ（オンライン決済）を解放すると、その予約に結ばれた添付は引き継がない（§11-N5）ので、一覧を空にして上げ直してもらう。
  // 開いた時点で、このログインIDの仮置き（24時間以内・未束縛）があれば最初から欄に出す（そのまま使う・消すができる）
  let attachments = $state<AttachmentItem[]>(init.attachments?.staged ?? []);
  let attachmentsReset = $state('');
  const RESET_NOTE = 'お部屋の確保を解除したため、添付ファイルは引き継がれません。お手数ですが、もう一度お付けください。';
  function resetAttachmentsAfterRelease() {
    if (!attachments.length) return;
    attachments = [];
    attachmentsReset = RESET_NOTE;
  }
  // カード登録の同意文（確定前の見本。予約を作った後はサーバが作った文面＝記録に残る文面を出す）
  const consentPreview = $derived(
    quote.ok && paymentOption === 'online_checkin'
      ? `${data.portal.facilityName}のご宿泊について、チェックアウト日の ${fmt(quote.checkOut)} に、このカードへ ${yen(payTotal)}（宿泊料金 ${yen(lodgingTotal)}${quote.bathTax > 0 ? `・入湯税 ${yen(quote.bathTax)}` : ''}）を請求することに同意します。キャンセル料がかかる日に取り消した場合は、キャンセル料をこのカードへ請求します。`
      : null
  );

  // 保存カード（2026-10-07・docs/saved-cards.md §6.4・§7.3）: 部品のマウントのたびに CustomerSession を取り直す（確認モードは取らない）。
  // チェックアウト日決済で選んだ保存カードの有効期限が近ければ、確定前に警告して止める（サーバでも card_expiry で断る）
  let savedCards = $state<SavedCardExp[]>([]);
  let savedSel = $state<{ id: string; card: { exp_month?: number; exp_year?: number } | null } | null>(null);
  async function loadSavedSession(): Promise<string | null> {
    if (data.portal.preview) return null;
    const r = await fetchPartnerCustomerSession(token);
    savedCards = r.cards;
    return r.clientSecret;
  }
  const savedTooSoon = $derived(payMode === 'setup' && quote.ok && selectedCardExpiresBefore(savedSel, savedCards, quote.checkOut));

  function validatePay(): string | null {
    if (!formEl) return '画面の準備ができていません。';
    if (savedTooSoon) return SAVED_CARD_EXPIRY_WARNING;
    snapshot();
    if (!formEl.checkValidity()) {
      step = 'input';
      setTimeout(() => formEl?.reportValidity(), 0);
      return '入力内容をご確認ください（必須の項目があります）。';
    }
    if (!ready && !pending) return '料金・空室を確認できるまでお待ちください。';
    return null;
  }

  async function preparePay(): Promise<PaymentPrepareResult> {
    if (pending && pending.mode === payMode && pendingUsable(pending)) return { clientSecret: pending.clientSecret, returnUrl: pending.returnUrl };
    // 期限が迫った仮押さえはやめて、取り直す
    if (pending) {
      const hadAttachments = attachments.length > 0;
      await releasePending(false);
      // 解放した予約に結ばれた添付は新しい予約へ引き継がない。黙って添付なしで確定しないよう、入力へ戻して上げ直してもらう
      if (hadAttachments) {
        step = 'input';
        throw new Error(RESET_NOTE);
      }
    }
    if (!formEl) throw new Error('画面の準備ができていません。');
    const fd = new FormData(formEl);
    fd.set('payment_option', paymentOption);
    const res = await fetch(`/p/${token}/book/reserve`, { method: 'POST', body: fd });
    if (res.status === 401) {
      location.href = `/p/${token}`;
      throw new Error('ログインの有効期限が切れました。');
    }
    const j = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; returnUrl?: string; payment?: Omit<Pending, 'returnUrl'> } | null;
    if (!res.ok || !j?.ok || !j.payment || !j.returnUrl) {
      // 受付枠の変化で支払方法が変わることがあるので、見積を取り直す
      requote += 1;
      throw new Error(j?.message || 'ご予約を確定できませんでした。時間をおいてもう一度お試しください。');
    }
    pending = { ...j.payment, returnUrl: j.returnUrl };
    return { clientSecret: pending.clientSecret, returnUrl: pending.returnUrl };
  }

  async function onPayConfirmed(r: PaymentConfirmed) {
    const code = pending?.bookingCode ?? '';
    let status = 'unpaid';
    try {
      const res = await fetch(`/p/${token}/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', intentId: r.intentId })
      });
      const j = (await res.json().catch(() => null)) as { result?: { status?: string } } | null;
      status = j?.result?.status ?? 'unpaid';
    } catch {
      // 連絡が届かなくても Webhook が確定する（一覧では「確認中」と出る）
    }
    location.href = `/p/${token}/bookings?code=${encodeURIComponent(code)}&result=${encodeURIComponent(status)}`;
  }

  async function payNow() {
    if (data.portal.preview) return; // 確認モードは確定しない（サーバでも断る）
    payError = '';
    await payRef?.submit();
  }

  // 仮押さえをやめる（入力に戻って内容を変えたいとき・期限が迫ったとき）
  async function releasePending(toInput = true) {
    if (!pending) return;
    releasing = true;
    try {
      await fetch(`/p/${token}/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'release', bookingId: pending.bookingId })
      }).catch(() => null);
      pending = null;
      payError = '';
      resetAttachmentsAfterRelease();
      if (toInput) {
        step = 'input';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } finally {
      releasing = false;
    }
  }

  function toConfirm() {
    clientError = '';
    if (!formEl?.reportValidity()) return;
    if (!ready) {
      clientError = '料金・空室を確認できるまでお待ちください。';
      return;
    }
    step = 'confirm';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // 確認画面に出す値（フォームの今の値）
  let values = $state<Record<string, string>>({});
  function snapshot() {
    if (!formEl) return;
    const fd = new FormData(formEl);
    const out: Record<string, string> = {};
    for (const [k, v] of fd.entries()) out[k] = String(v);
    values = out;
  }

  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));
  const range = (a: number, b: number) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i);
  const ARRIVALS = ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00'];
  const input = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2 outline-none transition focus:border-[var(--pt-accent)] focus:ring-2 focus:ring-[var(--pt-accent-soft)]';
  const label = 'mb-1 block text-sm font-medium';

  // 予約時に聞く項目: 予約ごと（食事・ご要望の欄）と部屋ごと（宿泊条件の部屋の欄）
  const bookingQuestions = $derived(data.settings.options.filter((o) => o.scope !== 'room'));
  const roomQuestions = $derived(data.settings.options.filter((o) => o.scope === 'room'));
  // 部屋ごとの男女の内訳（男性の人数。女性は人数から引く）。部屋数・人数が変わったら選び直してもらう
  let males = $state<string[]>([]);
  $effect(() => {
    const a = adults.map((x) => x);
    untrack(() => {
      males = a.map((n, i) => (males[i] !== undefined && males[i] !== '' && Number(males[i]) <= n ? males[i] : ''));
    });
  });
</script>

<!-- 御社の受付枠（与信・Phase 3a・決定 #3）: 紐づけ先が与信 ON の旅行会社のときだけ見積に入る。月ごとに残りとこの予約の後の残り。
     超えても止めない（warn / deposit とも 3a では案内だけ） -->
{#snippet creditBox(c: CreditView)}
  <div class={`mt-3 rounded-lg border px-3 py-2.5 text-sm ${c.over ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-stone-50'}`}>
    <p class="font-bold">御社の受付枠</p>
    <ul class="mt-1 space-y-1">
      {#each c.months as m (m.month)}
        {@const t = creditMonthText(m)}
        <li>{t.head}{#if t.after}<span class={`block text-[13px] ${m.over ? 'font-medium text-amber-800' : 'text-stone-600'}`}>／{t.after}</span>{/if}</li>
      {/each}
    </ul>
    <p class="mt-1.5 text-xs text-stone-500">{CREDIT_UNIT_NOTE}</p>
    {#if c.over}<p class="mt-1.5 text-[13px] font-medium text-amber-800">{deposit ? deposit.notice : CREDIT_OVER_NOTICE}</p>{/if}
  </div>
{/snippet}

{#snippet questionField(o: BookingQuestion, key: string)}
  {#if o.type === 'check'}
    <label class="flex items-center gap-2.5">
      <input type="checkbox" name={`opt_${key}`} required={o.required} class="h-5 w-5 accent-[var(--pt-accent)]" />
      <span>{o.label}{#if o.required} <em class="req">必須</em>{/if}</span>
    </label>
  {:else if o.type === 'select'}
    <label class="block sm:max-w-sm">
      <span class={label}>{o.label}{#if o.required} <em class="req">必須</em>{/if}</span>
      <select name={`opt_${key}`} required={o.required} class={input}>
        <option value="">選択してください</option>
        {#each o.choices as c}<option value={c}>{c}</option>{/each}
      </select>
    </label>
  {:else}
    <label class="block">
      <span class={label}>{o.label}{#if o.required} <em class="req">必須</em>{/if}</span>
      <input name={`opt_${key}`} required={o.required} maxlength="500" class={input} />
    </label>
  {/if}
{/snippet}


<svelte:head>
  <title>{partnerTitle(data.portal, 'ご予約')}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6">
  <a href={data.back.href} class="text-sm text-stone-500 hover:text-brand-900">← {data.back.label}</a>
  <h2 class="mt-2 text-2xl font-bold">{step === 'input' ? 'ご予約内容の入力' : 'ご予約内容の確認'}</h2>
  <ol class="mt-3 flex gap-2 text-sm">
    <li class={`rounded-full px-3 py-1 ${step === 'input' ? 'bg-brand-900 text-white' : 'bg-stone-200 text-stone-500'}`}>1. 入力</li>
    <li class={`rounded-full px-3 py-1 ${step === 'confirm' ? 'bg-brand-900 text-white' : 'bg-stone-200 text-stone-500'}`}>2. 確認・確定</li>
  </ol>

  {#if form?.message}
    <p class="mt-4 rounded-lg border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">{form.message}</p>
  {/if}

  <form
    bind:this={formEl}
    method="POST"
    use:enhance={({ cancel }) => {
      // 管理画面からの確認モードは送らない（入力欄で Enter を押したときも）
      if (data.portal.preview) {
        cancel();
        return;
      }
      // オンライン決済はフォーム送信ではなく決済部品から確定する（入力欄で Enter を押したときも）
      if (isStripe) {
        cancel();
        if (step === 'confirm') void payNow();
        return;
      }
      submitting = true;
      return async ({ result, update }) => {
        if (result.type === 'redirect') {
          await update();
          return;
        }
        submitting = false;
        await update({ reset: false });
        // 満室・締切などで確定できなかったときは、条件を直せるよう入力に戻す。受付枠が埋まって後払いが
        // 選べなくなった（デポジット方式）こともあるので、見積（支払方法の選択肢）を取り直す
        step = 'input';
        requote += 1;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    }}
    class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start"
  >
    <!-- 予約する施設（画面を開いたときの施設。サーバはこの施設で見積・確定する・2026-10-09 複数施設化） -->
    <input type="hidden" name="facility_id" value={data.portal.facilityId} />
    <input type="hidden" name="room_code" value={data.target.roomCode} />
    <input type="hidden" name="plan_code" value={data.target.planCode} />
    <input type="hidden" name="plan_name" value={data.target.planName} />
    <input type="hidden" name="room_count" value={roomCount} />
    <!-- 仮置きした添付ファイルの id（確定時に DB 関数が予約へ結ぶ） -->
    <input type="hidden" name="attachment_ids" value={attachments.map((a) => a.id).join(',')} />

    <div class="grid gap-5">
      <!-- 宿泊条件 -->
      <section id="stay-conditions" class={`card ${step === 'confirm' ? 'hidden' : ''}`}>
        <h3 class="card-title">ご宿泊の条件</h3>
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="block">
            <span class={label}>チェックイン日</span>
            <input type="date" name="check_in" bind:value={checkIn} min={new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })} required class={input} />
          </label>
          <label class="block">
            <span class={label}>泊数</span>
            <select name="nights" bind:value={nights} class={input}>
              {#each range(1, data.settings.maxNights) as n}<option value={n}>{n}泊</option>{/each}
            </select>
          </label>
          <label class="block">
            <span class={label}>室数</span>
            <select bind:value={roomCount} class={input}>
              {#each range(1, data.settings.maxRooms) as n}<option value={n}>{n}室</option>{/each}
            </select>
          </label>
        </div>
        <div class="mt-4 grid gap-3 sm:grid-cols-3">
          {#each adults as _, i}
            <label class="block">
              <span class={label}>{roomCount > 1 ? `${i + 1}室目の人数` : '1室の人数'}</span>
              <select name={`adults_${i}`} bind:value={adults[i]} class={input}>
                {#each range(data.capacity.min, data.capacity.max) as g}<option value={g}>大人 {g}名</option>{/each}
              </select>
            </label>
          {/each}
        </div>
        {#if data.settings.askGender || roomQuestions.length}
          <!-- 部屋ごとに聞く項目: 男女の内訳（必須・合計＝その部屋の人数。PMS の部屋別の男女に入る）とプラン・取引先の「部屋ごと」の項目 -->
          <div class="mt-4 grid gap-3">
            {#each adults as a, i (i)}
              <div class="rounded-lg border border-stone-200 p-3">
                {#if roomCount > 1}<p class="mb-2 text-sm font-medium">{i + 1}室目（大人{a}名）</p>{/if}
                <div class="grid gap-3 sm:grid-cols-2">
                  {#if data.settings.askGender}
                    <label class="block">
                      <span class={label}>男女の内訳 <em class="req">必須</em></span>
                      <select name={`male_${i}`} bind:value={males[i]} required class={input}>
                        <option value="">選択してください</option>
                        {#each range(0, a) as m (m)}<option value={String(m)}>男性{m}名・女性{a - m}名</option>{/each}
                      </select>
                      <input type="hidden" name={`female_${i}`} value={males[i] === '' || males[i] == null ? '' : String(a - Number(males[i]))} />
                    </label>
                  {/if}
                  {#each roomQuestions as o (o.id)}
                    {@render questionField(o, `${o.id}@${i}`)}
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>

      <!-- ご予約者（取引先のご担当者）。確認メールの宛先。マイページの設定が既定で入り、この予約の分だけ変えられる -->
      <section class={`card ${step === 'confirm' ? 'hidden' : ''}`}>
        <h3 class="card-title">ご予約者（ご担当者）</h3>
        <p class="-mt-2 mb-4 text-sm leading-6 text-stone-500">予約確認・取消・お支払いに関するメールは、ここに入力したメールアドレスへお送りします。</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block"><span class={label}>お名前 <em class="req">必須</em></span><input name="booker_name" value={init.booker.name} required maxlength="60" autocomplete="name" class={input} /></label>
          <label class="block"><span class={label}>フリガナ</span><input name="booker_kana" value={init.booker.kana} maxlength="60" class={input} /></label>
          <label class="block"><span class={label}>部署</span><input name="booker_department" value={init.booker.department} maxlength="60" autocomplete="organization-title" class={input} /></label>
          <label class="block"><span class={label}>電話番号</span><input name="booker_phone" type="tel" value={init.booker.phone} minlength="8" maxlength="20" placeholder="03-1234-5678" autocomplete="tel" class={input} /></label>
          <label class="block sm:col-span-2"><span class={label}>メールアドレス <em class="req">必須</em></span><input name="booker_email" type="email" value={init.booker.email} required maxlength="254" autocomplete="email" class={input} /></label>
        </div>
        <label class="mt-4 flex items-center gap-2.5 text-sm">
          <input type="checkbox" name="save_booker" class="h-5 w-5 accent-[var(--pt-accent)]" />
          <span>この内容をアカウントの担当者情報に保存する（次回から自動で入ります）</span>
        </label>
        {#if !data.bookerSaved}
          <p class="mt-2 text-sm text-stone-500"><a href={`/p/${token}/account`} class="underline hover:text-brand-900">アカウント（担当者情報）</a>で設定しておくと次回から自動で入ります。</p>
        {/if}
      </section>

      <!-- ご宿泊者 -->
      <section class={`card ${step === 'confirm' ? 'hidden' : ''}`}>
        <h3 class="card-title">ご宿泊者（代表者）</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block"><span class={label}>姓 <em class="req">必須</em></span><input name="family_name" required maxlength="40" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>名</span><input name="given_name" maxlength="40" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>セイ</span><input name="family_name_kana" maxlength="40" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>メイ</span><input name="given_name_kana" maxlength="40" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>電話番号 <em class="req">必須</em></span><input name="phone" type="tel" required minlength="8" maxlength="20" placeholder="090-1234-5678" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>メールアドレス</span><input name="email" type="email" autocomplete="off" aria-describedby="guest-email-note" class={input} /></label>
          <label class="block"><span class={label}>郵便番号</span><input name="zip_code" maxlength="10" placeholder="010-0531" autocomplete="off" class={input} /></label>
          <label class="block sm:col-span-2"><span class={label}>住所</span><input name="address" maxlength="200" autocomplete="off" class={input} /></label>
        </div>
        <p id="guest-email-note" class="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-sm leading-6 text-stone-600">
          ご宿泊者様のメールアドレスへは、予約確認メールやお支払いに関するご連絡は一切お送りしません。予約確認は上のご予約者（ご担当者）様へお送りします。
        </p>
        <!-- 交通手段（任意）。その他は自由入力 -->
        <fieldset class="mt-4">
          <legend class={label}>交通手段</legend>
          <div class="flex flex-wrap gap-2">
            <label class={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${transport === '' ? 'border-[var(--pt-accent)] bg-[var(--pt-accent-soft)]' : 'border-stone-300'}`}>
              <input type="radio" name="transport" value="" bind:group={transport} class="accent-[var(--pt-accent)]" />未定
            </label>
            {#each data.transportOptions as t (t.id)}
              <label class={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition ${transport === t.id ? 'border-[var(--pt-accent)] bg-[var(--pt-accent-soft)]' : 'border-stone-300'}`}>
                <input type="radio" name="transport" value={t.id} bind:group={transport} class="accent-[var(--pt-accent)]" />{t.label}
              </label>
            {/each}
          </div>
          {#if transport === 'jr' && data.standardFields.pickup.choices.length}
            <!-- JR のときのお迎え（西和賀＝乗合タクシー・男鹿＝迎えの車。文言・時間は管理画面「予約時に聞く項目」の毎回聞く項目） -->
            <label class="mt-3 block sm:max-w-sm">
              <span class={label}>{data.standardFields.pickup.label} <em class="req">必須</em></span>
              {#if data.standardFields.pickup.help}<span class="mb-1.5 block whitespace-pre-line text-sm leading-6 text-stone-500">{data.standardFields.pickup.help}</span>{/if}
              <select name="pickup_time" required class={input}>
                <option value="">選択してください</option>
                {#each data.standardFields.pickup.choices as c (c)}<option value={c}>{c}</option>{/each}
              </select>
            </label>
          {/if}
          {#if transport === 'other'}
            <input name="transport_other" required maxlength="60" placeholder="例: 高速バス・タクシー" aria-label="交通手段（その他）" class={`${input} mt-2 sm:max-w-sm`} />
          {/if}
        </fieldset>
      </section>

      <!-- 食事・ご要望 -->
      <section class={`card ${step === 'confirm' ? 'hidden' : ''}`}>
        <h3 class="card-title">お食事・ご要望</h3>
        <div class="grid gap-4">
          <label class="block">
            <span class={label}>{data.standardFields.allergies.label}</span>
            {#if data.standardFields.allergies.help}<span class="mb-1.5 block whitespace-pre-line text-sm leading-6 text-stone-500">{data.standardFields.allergies.help}</span>{/if}
            <textarea name="allergies" rows="2" maxlength="500" placeholder={data.standardFields.allergies.placeholder} class={input}></textarea>
          </label>
          <label class="block sm:max-w-xs">
            <span class={label}>到着予定時刻</span>
            <select name="arrival" class={input}>
              <option value="">未定</option>
              {#each ARRIVALS as t}<option value={t}>{t}</option>{/each}
            </select>
          </label>
          {#each bookingQuestions as o (o.id)}
            {@render questionField(o, o.id)}
          {/each}
          <label class="block">
            <span class={label}>{data.standardFields.notes.label}</span>
            {#if data.standardFields.notes.help}<span class="mb-1.5 block whitespace-pre-line text-sm leading-6 text-stone-500">{data.standardFields.notes.help}</span>{/if}
            <textarea name="notes" rows="3" maxlength="1000" placeholder={data.standardFields.notes.placeholder} class={input}></textarea>
          </label>
        </div>
      </section>

      {#if data.attachments}
        <!-- 添付ファイル（任意・2026-10-07）: 名簿・行程表など。1件ずつ仮置きし、予約の確定で予約に結ぶ。宿（PMS）の予約詳細にも出る -->
        <section class={`card ${step === 'confirm' ? 'hidden' : ''}`}>
          <h3 class="card-title">添付ファイル（任意）</h3>
          <p class="-mt-2 mb-3 text-sm leading-6 text-stone-500">名簿・行程表・配車表などをお付けください。宿の予約管理（PMS）にも同じファイルが届きます。予約の後でも予約一覧から追加・削除できます。</p>
          {#if attachmentsReset}<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{attachmentsReset}</p>{/if}
          <PartnerAttachments
            bind:items={attachments}
            uploadUrl={data.portal.preview ? null : `/p/${token}/book/attachments?facility_id=${encodeURIComponent(data.portal.facilityId)}`}
            accept={data.attachments.accept}
            hint={data.attachments.hint}
            note={data.portal.preview ? '管理者の確認モードのため、添付ファイルは追加できません。' : null}
            showUploader={false}
            onchange={() => (attachmentsReset = '')}
          />
        </section>
      {/if}

      <!-- 確認 -->
      {#if step === 'confirm'}
        <section class="card">
          <h3 class="card-title">この内容で予約します</h3>
          <dl class="confirm">
            <dt>宿泊日</dt><dd>{fmt(checkIn)} から {nights}泊</dd>
            {#if quote.ok}<dt>お部屋</dt><dd>{quote.roomName} × {roomCount}室</dd>
              <dt>プラン</dt><dd>{data.target.displayName}{quote.mealType ? `（${mealLabel(quote.mealType)}）` : ''}</dd>{/if}
            <dt>人数</dt><dd>{adults.map((a, i) => (roomCount > 1 ? `${i + 1}室目 大人${a}名` : `大人${a}名`)).join(' / ')}</dd>
            <dt>ご予約者</dt><dd>{values.booker_name}{values.booker_kana ? `（${values.booker_kana}）` : ''}{values.booker_department ? ` ${values.booker_department}` : ''}<span class="block text-sm text-stone-500">{[values.booker_phone, values.booker_email].filter(Boolean).join(' / ')}</span>{#if values.save_booker}<span class="block text-xs text-stone-500">この内容をアカウントの担当者情報に保存します</span>{/if}</dd>
            <!-- 旅行会社名義（Phase 2）: PMS の代表者は御社（紐づけ先）、ご宿泊者様のお名前はお部屋の宿泊者名として入る -->
            {#if data.nameHolder}<dt>ご予約名義</dt><dd>{bookingNameHolderText(data.nameHolder, `${values.family_name ?? ''} ${values.given_name ?? ''}`)}</dd>{/if}
            <dt>代表者</dt><dd>{values.family_name} {values.given_name}{values.family_name_kana || values.given_name_kana ? `（${values.family_name_kana} ${values.given_name_kana}）` : ''}</dd>
            <dt>電話番号</dt><dd>{values.phone}</dd>
            {#if values.email}<dt>メール</dt><dd>{values.email}</dd>{/if}
            {#if values.zip_code || values.address}<dt>住所</dt><dd>{values.zip_code} {values.address}</dd>{/if}
            {#if values.allergies}<dt>{data.standardFields.allergies.label}</dt><dd class="whitespace-pre-wrap">{values.allergies}</dd>{/if}
            <dt>到着予定</dt><dd>{values.arrival || '未定'}</dd>
            {#if values.transport}<dt>交通手段</dt><dd>{transportLabel(values.transport, values.transport_other ?? '')}</dd>{/if}
            {#if values.transport === 'jr' && values.pickup_time}<dt>{data.standardFields.pickup.label}</dt><dd>{values.pickup_time}</dd>{/if}
            {#if data.perks.length}<dt>専用特典</dt><dd>{data.perks.map((p) => p.title).join('／')}</dd>{/if}
            {#if data.settings.askGender}
              {#each adults as a, i (i)}
                {@const m = values[`male_${i}`]}
                {#if m !== undefined && m !== ''}<dt>{roomCount > 1 ? `${i + 1}室目 男女` : '男女の内訳'}</dt><dd>男性{m}名・女性{a - Number(m)}名</dd>{/if}
              {/each}
            {/if}
            {#each expandQuestions(data.settings.options, roomCount) as o (o.key)}
              {@const v = values[`opt_${o.key}`]}
              {#if v}<dt>{o.fullLabel}</dt><dd>{o.type === 'check' ? 'あり' : v}</dd>{/if}
            {/each}
            {#if values.notes}<dt>{data.standardFields.notes.label}</dt><dd class="whitespace-pre-wrap">{values.notes}</dd>{/if}
            {#if attachments.length}<dt>添付ファイル</dt><dd>{attachments.map((a) => `${a.fileName}（${a.size}）`).join('、')}</dd>{/if}
            {#if paymentLabel}<dt>お支払</dt><dd>{paymentLabel}{discounted && prepay ? `（${prepay.label}）` : ''}{#if billedToPartner}<span class="block text-sm font-medium text-[var(--pt-accent)]">{BILLED_NOTE}</span>{/if}{#if isDeposit && deposit}<span class="block text-sm font-medium text-[var(--pt-accent)]">デポジット {yen(deposit.amount)} を予約時にお支払い・残額 {yen(deposit.remainder)} は{deposit.remainderText}</span>{/if}</dd>{/if}
          </dl>
          {#if quote.ok}
            <!-- 料金の明細（表）。宿泊料金は割引前（キャンセル料の基準・入湯税を含まない） -->
            <div class="mt-4 max-w-md">
              <PartnerPriceTable
                lodging={quote.total}
                guests={quote.rooms.reduce((s, r) => s + r.adults, 0)}
                nights={quote.nights}
                discount={discounted && prepay ? prepay.discount : 0}
                discountLabel={discounted && prepay ? prepay.label : ''}
                bathTax={quote.bathTax}
                total={payTotal}
              />
            </div>
            {#if quote.credit}<div class="max-w-md">{@render creditBox(quote.credit)}</div>{/if}
          {/if}
        </section>
      {/if}

      <!-- お支払い（入力・確認のどちらにも出す。カードを選んだ時点で入力欄が出る） -->
      <section class="card">
        <h3 class="card-title">お支払い</h3>
        <div class="grid gap-4">
          {#if noPayChoice}
            <p class="rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2.5 text-sm text-rose-700">御社の受付枠を超えるため、このご予約はオンライン決済（全額またはデポジット）でのお受けになりますが、現在オンライン決済をご利用いただけません。宿へお問い合わせください。</p>
          {/if}
          {#if payChoices.length > 1}
            <fieldset disabled={!!pending}>
              <legend class={label}>お支払方法 <em class="req">必須</em></legend>
              <div class="grid gap-2 sm:grid-cols-2">
                {#each payChoices as o (o.id)}
                  <label class={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${paymentOption === o.id ? 'border-[var(--pt-accent)] bg-[var(--pt-accent-soft)]' : 'border-stone-300'}`}>
                    <input type="radio" name="payment_option" value={o.id} bind:group={paymentOption} required class="mt-1 accent-[var(--pt-accent)]" />
                    <span>
                      <span class="font-medium">{o.label}</span>
                      {#if o.id === 'online' && prepay}<span class="ml-1.5 rounded bg-[var(--pt-accent)] px-1.5 py-0.5 text-xs font-bold text-white">{prepay.label}</span>{/if}
                      <span class="block text-sm text-stone-500">{o.note}</span>
                      {#if o.id === 'online' && prepay}<span class="block text-sm font-medium text-[var(--pt-accent)]">合計 {yen(prepay.total + (quote.ok ? quote.bathTax : 0))}（{yen(prepay.discount)} お得）</span>{/if}
                      {#if o.id === 'deposit_online' && deposit}<span class="block text-sm font-medium text-[var(--pt-accent)]">デポジット {yen(deposit.amount)}（{deposit.basis}）・残額 {yen(deposit.remainder)} は{deposit.remainderText}</span>{/if}
                    </span>
                  </label>
                {/each}
              </div>
            </fieldset>
          {:else}
            <input type="hidden" name="payment_option" value={paymentOption} />
          {/if}
          {#if pending}
            <div class="rounded-lg border border-amber-700/30 bg-amber-50 px-3 py-2.5 text-sm">
              <p class="font-medium text-amber-800">予約番号 {pending.bookingCode} のお部屋を{pending.expiresAt ? ` ${hm(pending.expiresAt)} まで` : ''}確保しています。</p>
              <p class="mt-0.5 text-stone-600">{pending.mode === 'setup' ? 'カードを登録' : 'お支払いを完了'}するとご予約が確定します。別のカードでもお試しいただけます。</p>
            </div>
          {/if}
          {#if isStripe}
            {#key payMode}
              <StripePayment
                bind:this={payRef}
                publishableKey={data.stripeKey}
                mode={payMode}
                amount={payNowAmount}
                theme={{ accent: accent.accent, accentSoft: accent.accentSoft }}
                consentText={pending?.mode === 'setup' ? pending.consentText : consentPreview}
                disabled={!ready && !pending}
                validate={validatePay}
                prepare={preparePay}
                onconfirmed={onPayConfirmed}
                onerror={(m) => (payError = m)}
                onbusychange={(b) => (paying = b)}
                customerSession={loadSavedSession}
                onsavedcardchange={(c) => (savedSel = c)}
              />
            {/key}
            {#if savedTooSoon}
              <p class="rounded-lg border border-rose-700/30 bg-rose-700/5 px-3 py-2 text-sm text-rose-700" role="alert">{SAVED_CARD_EXPIRY_WARNING}</p>
            {/if}
            {#if (paymentOption === 'online' || isDeposit) && data.adminFeePercent}
              <!-- 予約時決済の事務手数料（取消時に返金しない率・2026-10-07）: 選んだ時点で、予約前に知らせる -->
              <p class="rounded-lg border border-amber-700/30 bg-amber-50 px-3 py-2 text-sm text-amber-900">{adminFeeNotice(data.adminFeePercent, 'partner')}{isDeposit ? '（デポジットのご予約は、デポジットの額に対して）' : ''}</p>
            {/if}
            {#if isDeposit && deposit}
              <p class="text-sm text-stone-500">予約とデポジット（{yen(deposit.amount)}）のお支払いを同時に行います。お支払いが完了した時点でご予約が確定します。残額 {yen(deposit.remainder)} は{deposit.remainderText}します（予約時決済の割引は付きません）。</p>
            {:else if paymentOption === 'online'}
              <p class="text-sm text-stone-500">予約とお支払いを同時に行います。お支払いが完了した時点でご予約が確定します。</p>
            {:else}
              <p class="text-sm text-stone-500">この時点では請求されません。カードを登録した時点でご予約が確定し、チェックアウト日に登録カードへ自動でご請求します。有効期限がチェックアウト日の月の2か月後以降のカードをご登録ください（カードの更新の時期と重なるため、それより前に有効期限を迎えるカードは登録できません）。</p>
            {/if}
          {:else if paymentLabel}
            {@const note = payChoices.find((o) => o.id === paymentOption)?.note ?? ''}
            <p class="text-sm text-stone-500">{paymentLabel}{note ? `（${note}）` : ''}</p>
            {#if billedToPartner}
              <!-- 請求書払いの説明（右欄のツールチップをやめてここに出す・2026-10-06 指示） -->
              <div class="rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3.5 py-3 text-sm leading-6">
                <p class="font-medium text-[var(--pt-accent)]">ご宿泊者様へのご請求はありません。宿泊料金・入湯税は貴社へご請求します。</p>
                <p class="mt-1 text-stone-600">館内でのご飲食・売店など、現地でのご利用分は、チェックアウト時にご宿泊者様へ別途ご請求します。</p>
              </div>
            {/if}
          {/if}
        </div>
      </section>

      <!-- キャンセルポリシー・お子様について・注意事項（入力・確認のどちらでも出す・2026-10-06 指示） -->
      <section id="cancel-policy" class="card">
        <h3 class="card-title">キャンセルポリシー</h3>
        {#if data.terms && (data.terms.cancellation.length || data.terms.cancellationNote)}
          <PartnerTermsTable title="" rows={data.terms.cancellation} note={data.terms.cancellationNote} />
        {:else}
          <p class="text-[15px] leading-7 text-stone-700">キャンセル料の規定は宿へお問い合わせください。</p>
        {/if}
        <p class="mt-3 text-[15px] leading-7 text-stone-700">{data.cancelText ? `取消は宿泊日の${data.cancelText}、予約一覧からできます。それより後は宿へご連絡ください。` : '取消は宿へご連絡ください。'}</p>
        {#if data.terms?.cancellation.length}
          <p class="mt-1 text-[15px] leading-7 text-stone-700">キャンセル料は、税込の予約金額（割引前・入湯税を除く）に上の料率を掛けた額です。予約一覧から取り消すときも、規定の日からはかかります（消費税の対象外）。</p>
        {/if}
        {#if data.adminFeePercent && payChoices.some((o) => o.id === 'online' || o.id === 'deposit_online')}
          <p class="mt-1 text-[15px] leading-7 text-stone-700">{adminFeeNotice(data.adminFeePercent, 'partner')}キャンセル料の期間に関係なくかかります。</p>
        {/if}
      </section>
      <section class="card">
        <h3 class="card-title">お子様について</h3>
        {#if data.terms && (data.terms.children.length || data.terms.childrenNote)}
          <PartnerTermsTable title="" rows={data.terms.children} note={data.terms.childrenNote} />
        {:else}
          <p class="text-[15px] leading-7 text-stone-700">お子様のご宿泊・料金については宿へお問い合わせください。</p>
        {/if}
      </section>
      <!-- 注意事項は管理画面「予約時の注意事項」の文面（と取引先ごとの予約画面の案内）だけ。どちらも空ならセクションごと出さない（2026-10-06 指示） -->
      {#if data.bookingNote?.trim() || data.settings.notice?.trim()}
        <section class="card">
          <h3 class="card-title">注意事項</h3>
          {#if data.bookingNote?.trim()}<div class="text-[15px]"><MarkdownView source={data.bookingNote} /></div>{/if}
          {#if data.settings.notice}<p class="mt-3 whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm leading-6">{data.settings.notice}</p>{/if}
        </section>
      {/if}
    </div>

    <!-- 料金（一休の右欄の形: 写真・施設名・所在地 → 日程・人数・お部屋・プラン → 宿泊料金 → お支払い金額合計 → 取消の案内 → ボタン・2026-10-06） -->
    <!-- 追従はヘッダー（高さは --portal-header-h・レイアウトで測る）の下から -->
    <aside class="card lg:sticky lg:top-[calc(var(--portal-header-h,6rem)+1rem)]">
      <div class="flex items-start gap-3">
        {#if data.summary.photo}<img src={data.summary.photo} alt="" class="h-[72px] w-[72px] shrink-0 rounded-lg object-cover" />{/if}
        <div class="min-w-0">
          <p class="text-lg font-bold leading-snug">{data.summary.facilityName}</p>
          {#if data.summary.area}<p class="mt-0.5 text-sm text-stone-500">{data.summary.area}</p>{/if}
        </div>
      </div>
      <ul class="mt-4 space-y-2.5 text-[15px] leading-6">
        <li class="flex gap-2.5">
          <svg viewBox="0 0 20 20" class="mt-0.5 h-5 w-5 shrink-0 text-stone-500" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M3 8.5h14M7 3v3M13 3v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
          <span>{fmt(checkIn)} 〜 {nights}泊{#if quote.ok && quote.mealType}<span class="ml-1.5">{mealLabel(quote.mealType)}</span>{/if}</span>
        </li>
        <li class="flex gap-2.5">
          <svg viewBox="0 0 20 20" class="mt-0.5 h-5 w-5 shrink-0 text-stone-500" aria-hidden="true"><circle cx="10" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M4 17c.8-3.2 3.2-4.8 6-4.8s5.2 1.6 6 4.8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" /></svg>
          <span>
            大人{adults.reduce((t, a) => t + a, 0)}名{#if roomCount > 1}<span class="text-sm text-stone-500">（{adults.map((a) => `${a}名`).join('・')}）</span>{/if} {roomCount}室
            {#if step === 'input'}<button type="button" onclick={() => document.getElementById('stay-conditions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} class="ml-1.5 text-sm text-sky-700 hover:underline">変更</button>{/if}
          </span>
        </li>
        {#if quote.ok}
          <li class="flex gap-2.5">
            <svg viewBox="0 0 20 20" class="mt-0.5 h-5 w-5 shrink-0 text-stone-500" aria-hidden="true"><path d="M2.5 15V6.5M2.5 11.5h15V15M17.5 11.5V10a2 2 0 0 0-2-2H9.5v3.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /><circle cx="6" cy="9" r="1.6" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
            <span>{quote.roomName}</span>
          </li>
        {/if}
        <li class="pl-[1.875rem] text-stone-700">{data.target.displayName}</li>
      </ul>
      {#if data.perks.length}
        <!-- このプランに付く専用特典（予約の要望・確認メールにも載り、宿が当日ご用意します）。ボタンを押すとモーダルで中身を見せる。
             「（取引先名）様専用特典」と出す（2026-10-09 指示） -->
        {@const perkLabel = data.portal.partnerName ? `${data.portal.partnerName}様専用特典` : '取引先専用特典'}
        <div class="mt-4">
          <PerkBanners items={[{ key: 'partner', label: perkLabel, kind: 'partner' }]} onopen={() => (perkContent = { label: perkLabel, perks: data.perks, note: 'このページからご予約いただいた場合に付きます。' })} />
        </div>
      {/if}

      <div class={`mt-4 border-t border-stone-200 pt-4 transition-opacity ${quoting ? 'opacity-50' : ''}`}>
        {#if !quote.ok}
          <p class="rounded-lg bg-rose-700/5 px-3 py-2 text-sm text-rose-700">{quote.message}</p>
        {:else}
          <div class="flex items-start justify-between gap-3">
            <span class="font-bold">宿泊料金合計</span>
            <div class="text-right">
              <p class="text-lg font-bold tabular-nums">{num(quote.rooms.reduce((t, r) => t + r.subtotal, 0))}<span class="text-sm">円</span></p>
              <!-- 1名料金は常に併記する（2026-10-09 指示）。全室・全泊の合計 ÷（大人の合計 × 泊数） -->
              <p class="text-sm font-semibold text-brand-900">1名1泊{quote.nights > 1 ? '（平均）' : ''} <span class="tabular-nums">{num(Math.round(quote.rooms.reduce((t, r) => t + r.subtotal, 0) / Math.max(quote.rooms.reduce((t, r) => t + r.adults, 0) * quote.nights, 1)))}</span>円</p>
              <button type="button" aria-expanded={showBreakdown} onclick={() => (showBreakdown = !showBreakdown)} class="text-xs text-stone-500 hover:text-brand-900">料金明細を{showBreakdown ? '閉じる' : '表示'} <span aria-hidden="true" class={`inline-block transition ${showBreakdown ? 'rotate-180' : ''}`}>⌄</span></button>
            </div>
          </div>
          {#if showBreakdown}
            <ul class="mt-2 space-y-1 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-600">
              {#each quote.rooms as r, i}
                <li class="flex justify-between gap-2">
                  <span>{quote.rooms.length > 1 ? `${i + 1}室目 ` : ''}大人{r.adults}名 × {quote.nights}泊<span class="ml-1 text-xs">（1名1泊{quote.nights > 1 ? '平均' : ''} {num(Math.round(r.subtotal / Math.max(r.adults * quote.nights, 1)))}円）</span></span>
                  <span class="tabular-nums">{num(r.subtotal)}円</span>
                </li>
              {/each}
            </ul>
          {/if}
          {#if quote.bathTax > 0}
            <div class="mt-2.5 flex justify-between gap-2">
              <span class="font-bold">入湯税</span>
              <span class="tabular-nums">{num(quote.bathTax)}円</span>
            </div>
          {/if}
          {#if discounted && prepay}
            <div class="mt-2.5 flex justify-between gap-2">
              <span class="font-bold">予約時決済割引<span class="ml-1 text-xs font-normal text-stone-500">（{prepay.label}）</span></span>
              <span class="font-bold tabular-nums text-rose-600">-{num(prepay.discount)}円</span>
            </div>
          {/if}
          <div class="mt-4 flex items-end justify-between gap-3 border-t border-stone-200 pt-4">
            <span class="whitespace-nowrap font-bold">お支払い金額合計</span>
            <span class="whitespace-nowrap"><span class="mr-1 text-sm">税込</span><span class="text-2xl font-bold tabular-nums leading-none">{num(payTotal)}</span><span class="font-bold">円</span></span>
          </div>
          {#if isDeposit && deposit}
            <!-- デポジット（Phase 3b）: 予約時に払うのはデポジットだけ。残額は請求書／現地 -->
            <div class="mt-2.5 flex justify-between gap-2 text-[var(--pt-accent)]">
              <span class="font-bold">予約時のお支払い（デポジット）</span>
              <span class="font-bold tabular-nums">{num(deposit.amount)}円</span>
            </div>
            <div class="mt-1 flex justify-between gap-2 text-sm text-stone-600">
              <span>残額（{deposit.remainderBilled ? '請求書' : '現地'}）</span>
              <span class="tabular-nums">{num(deposit.remainder)}円</span>
            </div>
          {/if}
          {#if prepay && !discounted && payChoices.some((o) => o.id === 'online')}
            <p class="mt-2 text-right text-xs text-[var(--pt-accent)]">予約時にお支払いいただくと {num(prepay.total + quote.bathTax)}円（{prepay.label}）</p>
          {/if}
          {#if paymentLabel}<p class="mt-2 text-right text-sm text-stone-500">{paymentLabel}</p>{/if}
          {#if soldShort}
            <!-- 残室は出さず、希望の室数に足りないときだけ知らせる -->
            <p class="mt-2 text-sm font-medium text-rose-700">ご希望の室数を確保できません（残り{quote.remaining}室）</p>
          {/if}
          {#if quote.credit}{@render creditBox(quote.credit)}{/if}
        {/if}
        {#if !canBook}
          <p class="mt-2 text-sm font-medium text-rose-700">この宿泊日のご予約は締め切りました（宿泊日の{data.deadlineText}）。</p>
        {/if}
      </div>

      <!-- 取消の案内（一休の帯と同じく「◯年◯月◯日までキャンセル料無料」を主に。ⓘでキャンセルポリシーへ・2026-10-06） -->
      <div class="mt-4 rounded-lg bg-sky-50 px-3 py-3 text-center text-sky-700">
        <!-- 文言の最後の語とⓘは同じ行に（ⓘだけが次の行に落ちないように）。取消の方法・期限はⓘのツールチップに（2026-10-06 指示: 帯には出さない） -->
        <p class="text-sm font-bold leading-6">
          {band.head}<span class="whitespace-nowrap">{band.tail}<span class="group relative inline-block align-baseline"><button type="button" aria-label="キャンセルについて" aria-describedby="cancel-tip" onclick={() => document.getElementById('cancel-policy')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} class="ml-0.5 inline-flex h-5 w-5 translate-y-[3px] items-center justify-center rounded-full text-sky-700 hover:bg-sky-100"><svg viewBox="0 0 20 20" class="h-4 w-4" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.5" /><path d="M10 9v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /><circle cx="10" cy="6.3" r="1" fill="currentColor" /></svg></button><span id="cancel-tip" role="tooltip" class="pointer-events-none invisible absolute bottom-full right-0 z-20 mb-2 w-64 whitespace-normal rounded-lg bg-stone-800 px-3 py-2 text-left text-xs font-normal leading-5 text-white opacity-0 shadow-lg transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">{data.cancelText ? `取消は宿泊日の${data.cancelText}、予約一覧からできます。それより後は宿へご連絡ください。` : '取消は宿へご連絡ください。'}{#if freeUntil !== null}<span class="mt-1 block">{ymdJa(freeUntil)}より後の取消は、キャンセルポリシーの料率でキャンセル料がかかります。</span>{/if}<span class="mt-1 block text-stone-300">押すとキャンセルポリシーへ移ります</span></span></span></span>
        </p>
      </div>

      {#if clientError}<p class="mt-3 text-sm text-rose-700">{clientError}</p>{/if}
      {#if step === 'input'}
        <button type="button" onclick={() => { snapshot(); toConfirm(); }} disabled={!ready} class="primary mt-4 w-full">内容を確認する</button>
      {:else if data.portal.preview}
        <!-- 管理画面からの確認モード: 最終確認までは見せ、確定（予約の作成・決済）はさせない。サーバ側でも GET 以外は断る -->
        <button type="button" disabled class="primary mt-4 w-full">{submitLabel}</button>
        <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">管理者の確認モードのため、予約は確定できません。</p>
        <button type="button" onclick={() => (step = 'input')} class="mt-2 w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50">入力に戻る</button>
      {:else if isStripe}
        <!-- エラーは決済部品（入力欄の下）にも出る。PC では明細カードが離れているのでボタンの上にも出す -->
        {#if payError}<p class="mt-3 hidden text-sm text-rose-700 lg:block">{payError}</p>{/if}
        <button type="button" onclick={payNow} disabled={paying || releasing || !data.stripeKey || (!ready && !pending) || savedTooSoon} class="primary mt-4 w-full">
          {paying ? (paymentOption === 'online' || paymentOption === 'deposit_online' ? 'お支払いを確認しています…' : 'カードを確認しています…') : submitLabel}
        </button>
        {#if pending}
          <button type="button" onclick={() => releasePending()} disabled={paying || releasing} class="mt-2 w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50">{releasing ? '確保を解除しています…' : 'この予約をやめて入力に戻る'}</button>
        {:else}
          <button type="button" onclick={() => (step = 'input')} disabled={paying} class="mt-2 w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50">入力に戻る</button>
        {/if}
      {:else}
        <button type="submit" disabled={submitting || !ready} class="primary mt-4 w-full">{submitting ? '予約しています…' : submitLabel}</button>
        <button type="button" onclick={() => (step = 'input')} disabled={submitting} class="mt-2 w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50">入力に戻る</button>
      {/if}
    </aside>
  </form>
</main>

<style>
  /* Book の公開予約フロー（/booking）のカードと同じ: rounded-xl・stone-200 の枠・影なし */
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
  .card-title {
    margin-bottom: 1rem;
    font-size: 1.125rem;
    font-weight: 700;
  }
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
  .confirm {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.6rem 1rem;
  }
  .confirm dt {
    color: var(--color-stone-500, #78716c);
  }
</style>

<PerkModal bind:content={perkContent} />
