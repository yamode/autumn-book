<script lang="ts">
  import { untrack } from 'svelte';
  import PartnerPerkList from '$lib/components/PartnerPerkList.svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import PartnerPriceTable from '$lib/components/PartnerPriceTable.svelte';
  import StripePayment from '$lib/components/payment/StripePayment.svelte';
  import type { PaymentConfirmed, PaymentPrepareResult } from '$lib/components/payment/types';
  import { partnerAccent } from '$lib/partner-theme';
  import { quoteChargeOf } from '$lib/partner-booking';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string } } = $props();

  type Quote = PageData['quote'];

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
  let nights = $state(init.target.nights ?? 1);
  let roomCount = $state(1);
  let adults = $state<number[]>([Math.min(init.capacity.max, Math.max(init.capacity.min, init.target.guests))]);
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
  let seq = 0;
  $effect(() => {
    const body = { roomCode: init.target.roomCode, planCode: init.target.planCode, planName: init.target.planName, checkIn, nights, rooms: adults.map((a) => ({ adults: a })) };
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
  // お支払方法（1つだけならそれに決まる）
  let paymentOption = $state(init.paymentOptions[0]?.id ?? '');
  const paymentLabel = $derived(data.paymentOptions.find((o) => o.id === paymentOption)?.label ?? '');
  // 請求書払い（取引先払い）: ご宿泊者様には請求しないことを支払方法の近くに出す（2026-10-02 指示）
  const billedToPartner = $derived(data.paymentOptions.find((o) => o.id === paymentOption)?.billable ?? false);
  const BILLED_NOTE = 'ご宿泊者様へのご請求はありません（宿泊料金・入湯税は貴社へご請求します）';
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
  const ready = $derived(quote.ok && canBook && !soldShort && !quoting);

  // ---- オンライン決済（同じ画面で払う・lib/components/payment/StripePayment.svelte）----
  // 確定ボタン（または Apple Pay / Google Pay）で ① 予約を仮押さえ＋Intent（/book/reserve）② Stripe で確定
  // ③ 確定の連絡（/payment confirm）→ 予約一覧へ。カードが断られたら、仮押さえはそのままで別のカードを試せる。
  const isStripe = $derived(paymentOption === 'online' || paymentOption === 'online_checkin');
  const payMode = $derived<'payment' | 'setup'>(paymentOption === 'online_checkin' ? 'setup' : 'payment');
  const accent = $derived(partnerAccent(data.portal.facilitySlug));
  const submitLabel = $derived(
    paymentOption === 'online' ? `予約して ${yen(payTotal)} を支払う` : paymentOption === 'online_checkin' ? '予約してカードを登録する' : 'この内容で予約を確定する'
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
  // カード登録の同意文（確定前の見本。予約を作った後はサーバが作った文面＝記録に残る文面を出す）
  const consentPreview = $derived(
    quote.ok && paymentOption === 'online_checkin'
      ? `${data.portal.facilityName}のご宿泊について、チェックイン日の ${fmt(quote.checkIn)} に、このカードへ ${yen(payTotal)}（宿泊料金 ${yen(lodgingTotal)}${quote.bathTax > 0 ? `・入湯税 ${yen(quote.bathTax)}` : ''}）を請求することに同意します。取消の期限内に予約を取り消した場合は請求しません。`
      : null
  );

  function validatePay(): string | null {
    if (!formEl) return '画面の準備ができていません。';
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
    if (pending) await releasePending(false);
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
</script>

<svelte:head>
  <title>ご予約 | {data.portal.facilityName}</title>
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
        // 満室・締切などで確定できなかったときは、条件を直せるよう入力に戻す
        step = 'input';
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    }}
    class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start"
  >
    <input type="hidden" name="room_code" value={data.target.roomCode} />
    <input type="hidden" name="plan_code" value={data.target.planCode} />
    <input type="hidden" name="plan_name" value={data.target.planName} />
    <input type="hidden" name="room_count" value={roomCount} />

    <div class="grid gap-5">
      <!-- 宿泊条件 -->
      <section class={`card ${step === 'confirm' ? 'hidden' : ''}`}>
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
            <span class={label}>食物アレルギー・苦手な食材</span>
            <textarea name="allergies" rows="2" maxlength="500" placeholder="例: えび・かに（2名）" class={input}></textarea>
          </label>
          <label class="block sm:max-w-xs">
            <span class={label}>到着予定時刻</span>
            <select name="arrival" class={input}>
              <option value="">未定</option>
              {#each ARRIVALS as t}<option value={t}>{t}</option>{/each}
            </select>
          </label>
          {#each data.settings.options as o (o.id)}
            {#if o.type === 'check'}
              <label class="flex items-center gap-2.5">
                <input type="checkbox" name={`opt_${o.id}`} required={o.required} class="h-5 w-5 accent-[var(--pt-accent)]" />
                <span>{o.label}{#if o.required} <em class="req">必須</em>{/if}</span>
              </label>
            {:else if o.type === 'select'}
              <label class="block sm:max-w-sm">
                <span class={label}>{o.label}{#if o.required} <em class="req">必須</em>{/if}</span>
                <select name={`opt_${o.id}`} required={o.required} class={input}>
                  <option value="">選択してください</option>
                  {#each o.choices as c}<option value={c}>{c}</option>{/each}
                </select>
              </label>
            {:else}
              <label class="block">
                <span class={label}>{o.label}{#if o.required} <em class="req">必須</em>{/if}</span>
                <input name={`opt_${o.id}`} required={o.required} maxlength="500" class={input} />
              </label>
            {/if}
          {/each}
          <label class="block">
            <span class={label}>その他ご要望・備考</span>
            <textarea name="notes" rows="3" maxlength="1000" class={input}></textarea>
          </label>
        </div>
      </section>

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
            <dt>代表者</dt><dd>{values.family_name} {values.given_name}{values.family_name_kana || values.given_name_kana ? `（${values.family_name_kana} ${values.given_name_kana}）` : ''}</dd>
            <dt>電話番号</dt><dd>{values.phone}</dd>
            {#if values.email}<dt>メール</dt><dd>{values.email}</dd>{/if}
            {#if values.zip_code || values.address}<dt>住所</dt><dd>{values.zip_code} {values.address}</dd>{/if}
            {#if values.allergies}<dt>アレルギー</dt><dd class="whitespace-pre-wrap">{values.allergies}</dd>{/if}
            <dt>到着予定</dt><dd>{values.arrival || '未定'}</dd>
            {#if values.transport}<dt>交通手段</dt><dd>{transportLabel(values.transport, values.transport_other ?? '')}</dd>{/if}
            {#if data.perks.length}<dt>専用特典</dt><dd>{data.perks.map((p) => p.title).join('／')}</dd>{/if}
            {#each data.settings.options as o (o.id)}
              {@const v = values[`opt_${o.id}`]}
              {#if v}<dt>{o.label}</dt><dd>{o.type === 'check' ? 'あり' : v}</dd>{/if}
            {/each}
            {#if values.notes}<dt>備考</dt><dd class="whitespace-pre-wrap">{values.notes}</dd>{/if}
            {#if paymentLabel}<dt>お支払</dt><dd>{paymentLabel}{discounted && prepay ? `（${prepay.label}）` : ''}{#if billedToPartner}<span class="block text-sm font-medium text-[var(--pt-accent)]">{BILLED_NOTE}</span>{/if}</dd>{/if}
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
          {/if}
        </section>
      {/if}

      <!-- お支払い（入力・確認のどちらにも出す。カードを選んだ時点で入力欄が出る） -->
      <section class="card">
        <h3 class="card-title">お支払い</h3>
        <div class="grid gap-4">
          {#if data.paymentOptions.length > 1}
            <fieldset disabled={!!pending}>
              <legend class={label}>お支払方法 <em class="req">必須</em></legend>
              <div class="grid gap-2 sm:grid-cols-2">
                {#each data.paymentOptions as o (o.id)}
                  <label class={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition ${paymentOption === o.id ? 'border-[var(--pt-accent)] bg-[var(--pt-accent-soft)]' : 'border-stone-300'}`}>
                    <input type="radio" name="payment_option" value={o.id} bind:group={paymentOption} required class="mt-1 accent-[var(--pt-accent)]" />
                    <span>
                      <span class="font-medium">{o.label}</span>
                      {#if o.id === 'online' && prepay}<span class="ml-1.5 rounded bg-[var(--pt-accent)] px-1.5 py-0.5 text-xs font-bold text-white">{prepay.label}</span>{/if}
                      <span class="block text-sm text-stone-500">{o.note}</span>
                      {#if o.id === 'online' && prepay}<span class="block text-sm font-medium text-[var(--pt-accent)]">合計 {yen(prepay.total + (quote.ok ? quote.bathTax : 0))}（{yen(prepay.discount)} お得）</span>{/if}
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
                amount={payTotal}
                theme={{ accent: accent.accent, accentSoft: accent.accentSoft }}
                consentText={pending?.mode === 'setup' ? pending.consentText : consentPreview}
                disabled={!ready && !pending}
                validate={validatePay}
                prepare={preparePay}
                onconfirmed={onPayConfirmed}
                onerror={(m) => (payError = m)}
                onbusychange={(b) => (paying = b)}
              />
            {/key}
            {#if paymentOption === 'online'}
              <p class="text-sm text-stone-500">予約とお支払いを同時に行います。お支払いが完了した時点でご予約が確定します。</p>
            {:else}
              <p class="text-sm text-stone-500">この時点では請求されません。カードを登録した時点でご予約が確定し、チェックイン日に登録カードへ自動でご請求します。</p>
            {/if}
          {:else if paymentLabel}
            {@const note = data.paymentOptions.find((o) => o.id === paymentOption)?.note ?? ''}
            <p class="text-sm text-stone-500">{paymentLabel}{note ? `（${note}）` : ''}</p>
            {#if billedToPartner}
              <p class="rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2 text-sm font-medium text-[var(--pt-accent)]">{BILLED_NOTE}</p>
            {/if}
          {/if}
        </div>
      </section>
    </div>

    <!-- 料金 -->
    <aside class="card lg:sticky lg:top-4">
      <p class="text-sm text-stone-500">{quote.ok ? quote.roomName : ''}</p>
      <h3 class="text-lg font-bold leading-snug">{data.target.displayName}</h3>
      {#if quote.ok && quote.mealType}<p class="mt-1 text-sm text-stone-500">{mealLabel(quote.mealType)}</p>{/if}
      {#if data.perks.length}
        <!-- このプランに付く専用特典（予約の要望・確認メールにも載り、宿が当日ご用意します） -->
        <div class="mt-3 rounded-lg border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-3 py-2.5">
          <p class="text-xs font-bold text-[var(--pt-accent)]">専用特典</p>
          <div class="mt-2"><PartnerPerkList perks={data.perks} variant="compact" /></div>
        </div>
      {/if}

      <div class={`mt-4 border-t border-stone-200 pt-4 transition-opacity ${quoting ? 'opacity-50' : ''}`}>
        {#if !quote.ok}
          <p class="rounded-lg bg-rose-700/5 px-3 py-2 text-sm text-rose-700">{quote.message}</p>
        {:else}
          <p class="text-sm text-stone-500">{fmt(quote.checkIn)} から {quote.nights}泊</p>
          <ul class="mt-2 grid gap-1.5 text-sm">
            {#each quote.rooms as r, i}
              <li class="flex justify-between gap-2">
                <span>{quote.rooms.length > 1 ? `${i + 1}室目 ` : ''}大人{r.adults}名 × {quote.nights}泊</span>
                <span class="tabular-nums">{yen(r.subtotal)}</span>
              </li>
            {/each}
          </ul>
          {#if quote.bathTax > 0}
            <div class="mt-1.5 flex justify-between gap-2 text-sm">
              <span>入湯税（大人 {quote.rooms.reduce((s, r) => s + r.adults, 0)}名 × {quote.nights}泊）</span>
              <span class="tabular-nums">{yen(quote.bathTax)}</span>
            </div>
          {/if}
          {#if discounted && prepay}
            <div class="mt-2 flex justify-between gap-2 text-sm text-[var(--pt-accent)]">
              <span>予約時決済割引（{prepay.label}）</span>
              <span class="tabular-nums">-{yen(prepay.discount)}</span>
            </div>
          {/if}
          <div class="mt-3 flex items-end justify-between border-t border-stone-200 pt-3">
            <span class="font-medium">合計</span>
            <span class="text-2xl font-bold tabular-nums text-accent-600">{yen(payTotal)}</span>
          </div>
          {#if prepay && !discounted && data.paymentOptions.some((o) => o.id === 'online')}
            <p class="mt-1 text-right text-xs text-[var(--pt-accent)]">予約時にお支払いいただくと {yen(prepay.total + quote.bathTax)}（{prepay.label}）</p>
          {/if}
          <p class="mt-1 text-right text-xs text-stone-500">税込{quote.bathTax > 0 ? '・入湯税を含む' : ''}</p>
          {#if quote.remaining != null}
            <p class={`mt-2 text-sm ${soldShort ? 'font-medium text-rose-700' : 'text-stone-500'}`}>
              {soldShort ? `ご希望の室数を確保できません（残り${quote.remaining}室）` : `このお部屋の残り: ${quote.remaining}室`}
            </p>
          {/if}
        {/if}
        {#if !canBook}
          <p class="mt-2 text-sm font-medium text-rose-700">この宿泊日のご予約は締め切りました（宿泊日の{data.deadlineText}）。</p>
        {/if}
      </div>

      <dl class="mt-4 grid gap-1 border-t border-stone-200 pt-4 text-sm">
        {#if paymentLabel}<div class="flex justify-between gap-2"><dt class="text-stone-500">お支払</dt><dd>{paymentLabel}</dd></div>{/if}
        {#if billedToPartner}<p class="text-xs text-[var(--pt-accent)]">{BILLED_NOTE}</p>{/if}
        <div class="flex justify-between gap-2"><dt class="text-stone-500">予約の締切</dt><dd>宿泊日の{data.deadlineText}</dd></div>
        <div class="flex justify-between gap-2"><dt class="text-stone-500">取消</dt><dd>{data.cancelText ? `宿泊日の${data.cancelText}（この画面から）` : '宿へご連絡ください'}</dd></div>
      </dl>
      {#if data.settings.notice}<p class="mt-3 whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm leading-6">{data.settings.notice}</p>{/if}

      {#if clientError}<p class="mt-3 text-sm text-rose-700">{clientError}</p>{/if}
      {#if step === 'input'}
        <button type="button" onclick={() => { snapshot(); toConfirm(); }} disabled={!ready} class="primary mt-4 w-full">内容を確認する</button>
      {:else if isStripe}
        <!-- エラーは決済部品（入力欄の下）にも出る。PC では明細カードが離れているのでボタンの上にも出す -->
        {#if payError}<p class="mt-3 hidden text-sm text-rose-700 lg:block">{payError}</p>{/if}
        <button type="button" onclick={payNow} disabled={paying || releasing || !data.stripeKey || (!ready && !pending)} class="primary mt-4 w-full">
          {paying ? (paymentOption === 'online' ? 'お支払いを確認しています…' : 'カードを確認しています…') : submitLabel}
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
    background: var(--color-accent-600, #95742c);
    padding: 0.75rem 1rem;
    font-weight: 500;
    color: #fff;
    transition: background-color 0.15s;
  }
  .primary:hover:not(:disabled) {
    background: var(--color-accent-500, #b08d3e);
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
