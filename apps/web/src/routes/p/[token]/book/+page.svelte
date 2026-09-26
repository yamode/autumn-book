<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string } } = $props();

  type Quote = PageData['quote'];
  const init = untrack(() => data);
  const token = $derived($page.params.token);

  // ---- 宿泊条件 ----
  let checkIn = $state(init.target.checkIn);
  let nights = $state(1);
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

  // ---- 入力 → 確認 ----
  let step = $state<'input' | 'confirm'>('input');
  // お支払方法（1つだけならそれに決まる）
  let paymentOption = $state(init.paymentOptions[0]?.id ?? '');
  const paymentLabel = $derived(data.paymentOptions.find((o) => o.id === paymentOption)?.label ?? '');
  // 予約時決済の割引（選んだときだけ合計に効く）
  const prepay = $derived(quote.ok ? quote.prepay : null);
  const discounted = $derived(paymentOption === 'online' && !!prepay);
  // お支払い合計＝宿泊料金（割引後）＋入湯税
  const lodgingTotal = $derived(quote.ok ? (discounted && prepay ? prepay.total : quote.total) : 0);
  const payTotal = $derived(quote.ok ? lodgingTotal + quote.bathTax : 0);
  const submitLabel = $derived(
    paymentOption === 'online' ? 'この内容で予約し、お支払いへ進む' : paymentOption === 'online_checkin' ? 'この内容で予約し、カードの登録へ進む' : 'この内容で予約を確定する'
  );
  let submitting = $state(false);
  let clientError = $state('');
  let formEl: HTMLFormElement | undefined = $state();
  const soldShort = $derived(quote.ok && quote.remaining != null && quote.remaining < roomCount);
  const ready = $derived(quote.ok && canBook && !soldShort && !quoting);

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

  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
  };
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));
  const displayPlanName = (name: string) => {
    const last = name.split('■').map((s) => s.trim()).filter(Boolean).pop() ?? name;
    return last.replace(/[（(][^()（）]*(?:円|%|％)[)）]\s*$/, '').trim() || last;
  };
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
  <a href={`/p/${token}/calendar`} class="text-sm text-stone-500 hover:text-brand-900">← 料金カレンダーへ戻る</a>
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
    use:enhance={() => {
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

      <!-- 宿泊者 -->
      <section class={`card ${step === 'confirm' ? 'hidden' : ''}`}>
        <h3 class="card-title">宿泊される方（代表者）</h3>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block"><span class={label}>姓 <em class="req">必須</em></span><input name="family_name" required maxlength="40" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>名</span><input name="given_name" maxlength="40" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>セイ</span><input name="family_name_kana" maxlength="40" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>メイ</span><input name="given_name_kana" maxlength="40" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>電話番号 <em class="req">必須</em></span><input name="phone" type="tel" required minlength="8" maxlength="20" placeholder="090-1234-5678" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>メールアドレス</span><input name="email" type="email" autocomplete="off" class={input} /></label>
          <label class="block"><span class={label}>郵便番号</span><input name="zip_code" maxlength="10" placeholder="010-0531" autocomplete="off" class={input} /></label>
          <label class="block sm:col-span-2"><span class={label}>住所</span><input name="address" maxlength="200" autocomplete="off" class={input} /></label>
        </div>
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
          {#if data.paymentOptions.length > 1}
            <fieldset>
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
              <dt>プラン</dt><dd>{displayPlanName(quote.planName)}{quote.mealType ? `（${mealLabel(quote.mealType)}）` : ''}</dd>{/if}
            <dt>人数</dt><dd>{adults.map((a, i) => (roomCount > 1 ? `${i + 1}室目 大人${a}名` : `大人${a}名`)).join(' / ')}</dd>
            <dt>代表者</dt><dd>{values.family_name} {values.given_name}{values.family_name_kana || values.given_name_kana ? `（${values.family_name_kana} ${values.given_name_kana}）` : ''}</dd>
            <dt>電話番号</dt><dd>{values.phone}</dd>
            {#if values.email}<dt>メール</dt><dd>{values.email}</dd>{/if}
            {#if values.zip_code || values.address}<dt>住所</dt><dd>{values.zip_code} {values.address}</dd>{/if}
            {#if values.allergies}<dt>アレルギー</dt><dd class="whitespace-pre-wrap">{values.allergies}</dd>{/if}
            <dt>到着予定</dt><dd>{values.arrival || '未定'}</dd>
            {#each data.settings.options as o (o.id)}
              {@const v = values[`opt_${o.id}`]}
              {#if v}<dt>{o.label}</dt><dd>{o.type === 'check' ? 'あり' : v}</dd>{/if}
            {/each}
            {#if values.notes}<dt>備考</dt><dd class="whitespace-pre-wrap">{values.notes}</dd>{/if}
            {#if paymentLabel}<dt>お支払</dt><dd>{paymentLabel}{discounted && prepay ? `（${prepay.label}）` : ''}</dd>{/if}
            {#if quote.ok}
              <!-- 料金の明細（宿泊料金・予約時決済割引・入湯税）。キャンセル料は入湯税を除いた宿泊料金が基準 -->
              <dt>宿泊料金</dt><dd class="tabular-nums">{yen(quote.total)}<span class="ml-1 text-xs text-stone-500">（税込・大人{quote.rooms.reduce((s, r) => s + r.adults, 0)}名 × {quote.nights}泊）</span></dd>
              {#if discounted && prepay}<dt>予約時決済割引</dt><dd class="tabular-nums text-[var(--pt-accent)]">-{yen(prepay.discount)}<span class="ml-1 text-xs">（{prepay.label}）</span></dd>{/if}
              {#if quote.bathTax > 0}<dt>入湯税</dt><dd class="tabular-nums">{yen(quote.bathTax)}<span class="ml-1 text-xs text-stone-500">（大人{quote.rooms.reduce((s, r) => s + r.adults, 0)}名 × {quote.nights}泊）</span></dd>{/if}
              <dt>合計</dt><dd class="font-bold tabular-nums">{yen(payTotal)}</dd>
            {/if}
          </dl>
          {#if paymentOption === 'online'}
            <p class="mt-3 text-sm text-stone-500">確定するとお支払い画面（Stripe）へ進みます。30分以内にお支払いいただくと予約が確定します。</p>
          {:else if paymentOption === 'online_checkin'}
            <p class="mt-3 text-sm text-stone-500">確定するとカードの登録画面（Stripe）へ進みます。登録した時点で予約が確定し、チェックイン日に登録カードへ自動で請求します（この時点では請求されません）。</p>
          {/if}
        </section>
      {/if}
    </div>

    <!-- 料金 -->
    <aside class="card lg:sticky lg:top-4">
      <p class="text-sm text-stone-500">{quote.ok ? quote.roomName : ''}</p>
      <h3 class="text-lg font-bold leading-snug">{displayPlanName(data.target.planName)}</h3>
      {#if quote.ok && quote.mealType}<p class="mt-1 text-sm text-stone-500">{mealLabel(quote.mealType)}</p>{/if}

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
        <div class="flex justify-between gap-2"><dt class="text-stone-500">予約の締切</dt><dd>宿泊日の{data.deadlineText}</dd></div>
        <div class="flex justify-between gap-2"><dt class="text-stone-500">取消</dt><dd>{data.cancelText ? `宿泊日の${data.cancelText}（この画面から）` : '宿へご連絡ください'}</dd></div>
      </dl>
      {#if data.settings.notice}<p class="mt-3 whitespace-pre-wrap rounded-lg bg-stone-50 px-3 py-2 text-sm leading-6">{data.settings.notice}</p>{/if}

      {#if clientError}<p class="mt-3 text-sm text-rose-700">{clientError}</p>{/if}
      {#if step === 'input'}
        <button type="button" onclick={() => { snapshot(); toConfirm(); }} disabled={!ready} class="primary mt-4 w-full">内容を確認する</button>
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
