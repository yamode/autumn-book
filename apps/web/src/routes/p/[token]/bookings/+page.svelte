<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/stores';
  import StripePayment from '$lib/components/payment/StripePayment.svelte';
  import type { PaymentConfirmed, PaymentPrepareResult } from '$lib/components/payment/types';
  import { partnerAccent } from '$lib/partner-theme';
  import type { PageData } from './$types';

  let { data, form }: { data: PageData; form?: { message?: string; cancelled?: string } } = $props();

  const token = $derived($page.params.token);
  let filter = $state<'upcoming' | 'past' | 'cancelled'>('upcoming');
  let open = $state<string | null>(null);
  let cancelling = $state<string | null>(null);
  let confirmId = $state<string | null>(null);
  let reason = $state('');

  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
  const isActive = (s: string) => s === 'confirmed' || s === 'pending_payment';
  const shown = $derived(
    data.bookings
      .filter((b) =>
        filter === 'cancelled' ? !isActive(b.status) : isActive(b.status) && (filter === 'upcoming' ? b.checkOut > today : b.checkOut <= today)
      )
      .sort((a, b) => (filter === 'upcoming' ? a.checkIn.localeCompare(b.checkIn) : b.checkIn.localeCompare(a.checkIn)))
  );
  const counts = $derived({
    upcoming: data.bookings.filter((b) => isActive(b.status) && b.checkOut > today).length,
    past: data.bookings.filter((b) => isActive(b.status) && b.checkOut <= today).length,
    cancelled: data.bookings.filter((b) => !isActive(b.status)).length
  });

  const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日（${WEEK[d.getUTCDay()]}）`;
  };
  const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' }) : '');
  const PAY_STATUS: Record<string, string> = {
    paid: 'お支払い済み',
    refunded: '全額返金済み',
    refund_failed: '返金できませんでした（宿で対応します）',
    unpaid: 'お支払い待ち',
    scheduled: 'チェックイン日に請求予定',
    charge_failed: 'カードへの請求ができませんでした'
  };
  // ---- 支払の再開・カードの登録（し直し）: 同じ画面のモーダルで払う（lib/components/payment/StripePayment.svelte）----
  type Row = PageData['bookings'][number];
  const accent = $derived(partnerAccent(data.portal.facilitySlug));
  let payTarget = $state<Row | null>(null);
  let payRef: { submit: () => Promise<boolean> } | undefined = $state();
  let payBusy = $state(false);
  const payLabel = (b: Row) =>
    b.status === 'pending_payment' ? (b.payMode === 'setup' ? 'カードを登録して予約を確定する' : `${yen(b.total)} を支払って予約を確定する`) : 'このカードに登録し直す';

  function openPay(b: Row) {
    payTarget = b;
  }
  function closePay() {
    if (payBusy) return;
    payTarget = null;
  }

  async function preparePay(): Promise<PaymentPrepareResult> {
    if (!payTarget) throw new Error('予約が選ばれていません。');
    const res = await fetch(`/p/${token}/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'prepare', bookingId: payTarget.id })
    });
    if (res.status === 401) {
      location.href = `/p/${token}`;
      throw new Error('ログインの有効期限が切れました。');
    }
    const j = (await res.json().catch(() => null)) as { ok?: boolean; message?: string; returnUrl?: string; payment?: { clientSecret: string } } | null;
    if (!res.ok || !j?.ok || !j.payment || !j.returnUrl) throw new Error(j?.message || 'お支払いの準備ができませんでした。時間をおいてお試しください。');
    return { clientSecret: j.payment.clientSecret, returnUrl: j.returnUrl };
  }

  async function onPayConfirmed(r: PaymentConfirmed) {
    const code = payTarget?.code ?? '';
    let status = 'unpaid';
    let charge = '';
    try {
      const res = await fetch(`/p/${token}/payment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'confirm', intentId: r.intentId })
      });
      const j = (await res.json().catch(() => null)) as { result?: { status?: string; charge?: { status?: string } } } | null;
      status = j?.result?.status ?? 'unpaid';
      charge = j?.result?.charge?.status ?? '';
    } catch {
      // 連絡が届かなくても Webhook が確定する
    }
    location.href = `/p/${token}/bookings?code=${encodeURIComponent(code)}&result=${encodeURIComponent(status)}${charge ? `&charge=${charge}` : ''}`;
  }
  const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }) : '');
  const mealLabel = (m: string | null) => (m === '2食' ? '夕朝食付き' : m === '朝食' ? '朝食付き' : m === '素泊' ? '素泊まり' : (m ?? ''));
  const displayPlanName = (name: string) => {
    const last = name.split('■').map((s) => s.trim()).filter(Boolean).pop() ?? name;
    return last.replace(/[（(][^()（）]*(?:円|%|％)[)）]\s*$/, '').trim() || last;
  };
</script>

<svelte:head>
  <title>予約一覧 | {data.portal.facilityName}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<main class="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
  <div class="flex flex-wrap items-end justify-between gap-3">
    <h2 class="text-2xl font-bold">予約一覧</h2>
    <a href={`/p/${token}/calendar`} class="rounded-lg bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700">料金カレンダーから予約する</a>
  </div>

  {#if data.done}
    <div class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3">
      <p class="font-bold text-[var(--pt-accent)]">✓ ご予約を承りました（予約番号 {data.done}）</p>
      <p class="mt-1 text-sm text-stone-500">確認メールをお送りしました（メールアドレスの登録がある場合）。内容は下の一覧からご確認いただけます。</p>
    </div>
  {/if}
  {#if data.payment?.status === 'paid' || data.payment?.status === 'already'}
    <div class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3">
      <p class="font-bold text-[var(--pt-accent)]">✓ お支払いが完了し、ご予約が確定しました（予約番号 {data.payment.bookingCode}）</p>
      <p class="mt-1 text-sm text-stone-500">確認メールをお送りしました（メールアドレスの登録がある場合）。</p>
    </div>
  {:else if data.payment?.status === 'card_saved'}
    <div class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3">
      <p class="font-bold text-[var(--pt-accent)]">✓ カードを登録し、ご予約が確定しました（予約番号 {data.payment.bookingCode}）</p>
      <p class="mt-1 text-sm text-stone-500">チェックイン日に登録カードへ自動でご請求します。それまではご請求はありません。</p>
    </div>
  {:else if data.payment?.status === 'card_updated'}
    <p class="mt-4 rounded-xl border border-[var(--pt-accent)]/30 bg-[var(--pt-accent-soft)] px-4 py-3 font-medium text-[var(--pt-accent)]">
      ✓ カードを登録し直しました（予約番号 {data.payment.bookingCode}）。{data.payment.charge?.status === 'paid'
        ? 'ご請求が完了しました。'
        : data.payment.charge?.status === 'failed'
          ? `ただし、このカードでもご請求できませんでした${data.payment.charge.message ? `（${data.payment.charge.message}）` : ''}。別のカードでお試しいただくか、宿へご連絡ください。`
          : 'チェックイン日にこのカードへご請求します。'}
    </p>
  {:else if data.payment?.status === 'card_late'}
    <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">
      カードの登録の期限（30分）を過ぎていたため、お部屋の確保ができませんでした。ご請求はしていません。お手数ですが、もう一度ご予約ください。
    </p>
  {:else if data.payment?.status === 'refunded_late'}
    <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">
      お支払いの期限（30分）を過ぎていたため、お部屋の確保ができませんでした。お支払いは全額返金しました。お手数ですが、もう一度ご予約ください。
    </p>
  {:else if data.payment?.status === 'unpaid'}
    <p class="mt-4 rounded-xl border border-amber-700/30 bg-amber-700/5 px-4 py-3 text-amber-700">
      お支払いの確認が取れていません{data.payment.bookingCode ? `（予約番号 ${data.payment.bookingCode}）` : ''}。少し時間をおいてこの画面を開き直してください（カード会社の確認が済むと自動で確定します）。
    </p>
  {:else if data.payment?.status === 'error'}
    <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">お支払いの確認でエラーが起きました。宿へお問い合わせください。</p>
  {/if}
  {#if form?.cancelled}
    <p class="mt-4 rounded-xl border border-stone-300 bg-white px-4 py-3">予約 {form.cancelled} を取り消しました。</p>
  {/if}
  {#if form?.message}
    <p class="mt-4 rounded-xl border border-rose-700/30 bg-rose-700/5 px-4 py-3 text-rose-700">{form.message}</p>
  {/if}

  <div class="mt-5 flex gap-1 rounded-full bg-white p-1 text-sm sm:inline-flex">
    {#each [['upcoming', 'これからのご予約'], ['past', 'ご宿泊済み'], ['cancelled', '取消済み']] as [key, lbl]}
      <button
        type="button"
        onclick={() => (filter = key as typeof filter)}
        class={`flex-1 rounded-full px-4 py-1.5 transition sm:flex-none ${filter === key ? 'bg-brand-900 font-medium text-white' : 'text-stone-500 hover:text-brand-900'}`}
      >{lbl}<span class="ml-1 tabular-nums opacity-70">{counts[key as keyof typeof counts]}</span></button>
    {/each}
  </div>

  {#if shown.length === 0}
    <p class="mt-6 rounded-xl border border-dashed border-stone-300 px-6 py-10 text-center text-stone-500">該当するご予約はありません。</p>
  {:else}
    <ul class="mt-4 grid gap-3">
      {#each shown as b (b.id)}
        <li class="rounded-xl border border-stone-200 bg-white">
          <button type="button" class="flex w-full flex-wrap items-start justify-between gap-3 p-4 text-left sm:p-5" onclick={() => (open = open === b.id ? null : b.id)}>
            <div class="min-w-0">
              <p class="text-sm text-stone-500">予約番号 {b.code}{#if b.status === 'pending_payment'}<span class="ml-2 rounded bg-amber-700/10 px-1.5 text-xs font-medium text-amber-700">お支払い待ち（{hm(b.paymentExpiresAt)} まで）</span>{:else if b.status === 'expired'}<span class="ml-2 rounded bg-stone-200 px-1.5 text-xs">お支払い期限切れ</span>{:else if b.status === 'cancelled'}<span class="ml-2 rounded bg-stone-200 px-1.5 text-xs">取消済み</span>{:else if b.checkedIn}<span class="ml-2 rounded bg-[var(--pt-accent-soft)] px-1.5 text-xs text-[var(--pt-accent)]">チェックイン済み</span>{/if}</p>
              <p class="mt-0.5 text-lg font-bold">{fmt(b.checkIn)} から {b.nights}泊 ・ {b.guestName} 様</p>
              <p class="mt-0.5 text-sm text-stone-500">{b.roomName} × {b.roomCount}室 ・ 大人{b.adultTotal}名 ・ {displayPlanName(b.planName)}</p>
            </div>
            <div class="text-right">
              <p class="text-lg font-bold tabular-nums text-accent-600">{yen(b.total)}</p>
              <p class="text-xs text-stone-500">{open === b.id ? '閉じる ▲' : '詳細 ▼'}</p>
            </div>
          </button>
          {#if open === b.id}
            <div class="border-t border-stone-200 px-4 pb-4 pt-3 sm:px-5">
              <dl class="detail">
                <dt>宿泊日</dt><dd>{fmt(b.checkIn)} 〜 {fmt(b.checkOut)}（{b.nights}泊）</dd>
                <dt>お部屋</dt><dd>{b.roomName} × {b.roomCount}室（{b.rooms.map((a, i) => (b.rooms.length > 1 ? `${i + 1}室目 ${a}名` : `${a}名`)).join(' / ')}）</dd>
                <dt>プラン</dt><dd>{displayPlanName(b.planName)}{b.mealType ? `（${mealLabel(b.mealType)}）` : ''}</dd>
                <dt>代表者</dt><dd>{b.guestName}{b.guestKana ? `（${b.guestKana}）` : ''}</dd>
                <dt>電話番号</dt><dd>{b.phone ?? ''}</dd>
                {#if b.email}<dt>メール</dt><dd>{b.email}</dd>{/if}
                {#if b.address}<dt>住所</dt><dd>{b.address}</dd>{/if}
                {#if b.allergies}<dt>アレルギー</dt><dd class="whitespace-pre-wrap">{b.allergies}</dd>{/if}
                {#if b.arrival}<dt>到着予定</dt><dd>{b.arrival}</dd>{/if}
                {#each b.options as o}<dt>{o.label}</dt><dd>{o.value}</dd>{/each}
                {#if b.notes}<dt>備考</dt><dd class="whitespace-pre-wrap">{b.notes}</dd>{/if}
                <!-- 料金の明細（宿泊料金はキャンセル料の基準。入湯税は別に請求） -->
                <dt>宿泊料金</dt><dd class="tabular-nums">{yen(b.total - b.bathTax)}<span class="ml-1 text-xs text-stone-500">（税込）</span></dd>
                {#if b.bathTax > 0}<dt>入湯税</dt><dd class="tabular-nums">{yen(b.bathTax)}</dd>{/if}
                <dt>合計</dt><dd class="font-bold tabular-nums">{yen(b.total)}</dd>
                {#if b.paymentMethodName}<dt>お支払</dt><dd>{b.paymentMethodName}{#if PAY_STATUS[b.paymentStatus]}（{PAY_STATUS[b.paymentStatus]}{b.cardLabel && (b.paymentStatus === 'scheduled' || b.paymentStatus === 'charge_failed') ? `・${b.cardLabel}` : ''}）{/if}{#if b.paymentStatus === 'charge_failed' && b.chargeError}<span class="block text-sm text-rose-700">{b.chargeError}</span>{/if}</dd>{/if}
                <dt>予約日時</dt><dd>{dt(b.createdAt)}{b.bookedBy ? `（${b.bookedBy}）` : ''}</dd>
                {#if b.cancelledAt}<dt>取消日時</dt><dd>{dt(b.cancelledAt)}（{b.cancelledBy === 'staff' ? '宿で取消' : '取引先で取消'}）</dd>{/if}
              </dl>

              {#if b.canUpdateCard && b.payMode}
                <div class="mt-4 border-t border-stone-200 pt-3">
                  <button type="button" onclick={() => openPay(b)} disabled={!data.stripeKey} class={`rounded-lg px-5 py-2 text-sm font-medium disabled:opacity-50 ${b.paymentStatus === 'charge_failed' ? 'bg-brand-800 text-white hover:bg-brand-700' : 'border border-stone-300 hover:border-brand-900'}`}>カードを登録し直す</button>
                  {#if b.paymentStatus === 'charge_failed'}<span class="ml-2 text-xs text-rose-700">別のカードをご登録いただくと、その場でご請求します</span>{/if}
                </div>
              {/if}
              {#if b.status === 'pending_payment' && b.payMode}
                <div class="mt-4 border-t border-stone-200 pt-3">
                  <button type="button" onclick={() => openPay(b)} disabled={!data.stripeKey} class="rounded-lg bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50">{b.payMode === 'setup' ? 'カードの登録へ進む' : 'お支払いへ進む'}</button>
                  <span class="ml-2 text-xs text-stone-500">{hm(b.paymentExpiresAt)} までに{b.payMode === 'setup' ? 'ご登録' : 'お支払い'}ください</span>
                </div>
              {/if}
              {#if b.status === 'confirmed' || b.status === 'pending_payment'}
                <div class="mt-4 border-t border-stone-200 pt-3">
                  {#if b.canCancel}
                    {#if confirmId === b.id}
                      <form
                        method="POST"
                        action="?/cancel"
                        use:enhance={() => {
                          cancelling = b.id;
                          return async ({ update }) => {
                            cancelling = null;
                            confirmId = null;
                            reason = '';
                            await update();
                          };
                        }}
                        class="grid gap-2 rounded-xl bg-rose-700/5 p-3"
                      >
                        <input type="hidden" name="id" value={b.id} />
                        <p class="text-sm font-medium text-rose-700">
                          {b.status === 'pending_payment' ? 'このご予約をやめます（お部屋の確保を解除します）。' : 'このご予約を取り消します。取り消すと元に戻せません。'}
                          {#if b.paymentStatus === 'paid'}お支払い済みの金額は全額返金します。{/if}
                        </p>
                        <input name="reason" bind:value={reason} maxlength="500" placeholder="取消の理由（任意）" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" />
                        <div class="flex flex-wrap gap-2">
                          <button type="submit" disabled={cancelling === b.id} class="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{cancelling === b.id ? '取り消しています…' : '取り消す'}</button>
                          <button type="button" onclick={() => (confirmId = null)} class="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50">やめる</button>
                        </div>
                      </form>
                    {:else}
                      <button type="button" onclick={() => (confirmId = b.id)} class="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600 hover:bg-rose-50 hover:text-rose-700">{b.status === 'pending_payment' ? 'この予約をやめる' : 'この予約を取り消す'}</button>
                      {#if data.cancelText && b.status === 'confirmed'}<span class="ml-2 text-xs text-stone-500">宿泊日の{data.cancelText}まで取り消せます</span>{/if}
                    {/if}
                  {:else}
                    <p class="text-sm text-stone-500">{b.checkedIn ? 'チェックイン済みです。' : data.cancelText ? `取消の期限（宿泊日の${data.cancelText}）を過ぎています。` : 'この画面からは取り消せません。'}変更・取消は宿へご連絡ください。</p>
                  {/if}
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</main>

{#if payTarget && payTarget.payMode}
  {@const b = payTarget}
  <!-- 支払の再開・カードの登録（し直し）。同じ画面で払う（別ページへ移動しない） -->
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="presentation" onclick={(e) => e.target === e.currentTarget && closePay()} onkeydown={(e) => e.key === 'Escape' && closePay()}>
    <div class="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6" role="dialog" aria-modal="true" aria-labelledby="pay-title">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-sm text-stone-500">予約番号 {b.code}</p>
          <h3 id="pay-title" class="text-lg font-bold">{b.status === 'pending_payment' ? (b.payMode === 'setup' ? 'カードの登録' : 'お支払い') : 'カードの登録し直し'}</h3>
        </div>
        <button type="button" onclick={closePay} disabled={payBusy} class="rounded-md px-2 py-1 text-stone-500 hover:bg-stone-100" aria-label="閉じる">✕</button>
      </div>
      <dl class="mt-3 grid gap-1 rounded-lg bg-stone-50 px-3 py-2.5 text-sm">
        <div class="flex justify-between gap-2"><dt class="text-stone-500">宿泊日</dt><dd>{fmt(b.checkIn)} から {b.nights}泊</dd></div>
        <div class="flex justify-between gap-2"><dt class="text-stone-500">宿泊者</dt><dd>{b.guestName} 様</dd></div>
        <div class="flex justify-between gap-2"><dt class="text-stone-500">{b.payMode === 'setup' ? 'チェックイン日の請求額' : 'お支払い額'}</dt><dd class="font-bold tabular-nums">{yen(b.total)}</dd></div>
        {#if b.status === 'pending_payment' && b.paymentExpiresAt}<div class="flex justify-between gap-2"><dt class="text-stone-500">期限</dt><dd>{hm(b.paymentExpiresAt)} まで</dd></div>{/if}
      </dl>
      <div class="mt-4">
        <StripePayment
          bind:this={payRef}
          publishableKey={data.stripeKey}
          mode={b.payMode ?? 'payment'}
          amount={b.total}
          theme={{ accent: accent.accent, accentSoft: accent.accentSoft }}
          consentText={b.consentText}
          prepare={preparePay}
          onconfirmed={onPayConfirmed}
          onbusychange={(v) => (payBusy = v)}
        />
      </div>
      <button type="button" onclick={() => void payRef?.submit()} disabled={payBusy || !data.stripeKey} class="mt-4 w-full rounded-lg bg-accent-600 px-4 py-3 font-medium text-white transition hover:bg-accent-500 disabled:opacity-40">
        {payBusy ? '確認しています…' : payLabel(b)}
      </button>
      <button type="button" onclick={closePay} disabled={payBusy} class="mt-2 w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm hover:bg-stone-50">閉じる</button>
    </div>
  </div>
{/if}

<style>
  .detail {
    display: grid;
    grid-template-columns: 6.5rem 1fr;
    gap: 0.45rem 1rem;
    font-size: 0.95rem;
  }
  .detail dt {
    color: var(--color-stone-500, #78716c);
  }
</style>
