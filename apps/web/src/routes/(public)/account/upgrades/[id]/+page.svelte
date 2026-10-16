<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { invalidateAll } from '$app/navigation';
	import StripePayment from '$lib/components/payment/StripePayment.svelte';
	import { UPGRADE_STATUS } from '$lib/room-upgrades';
	let { data, form } = $props();
	let busy = $state(false);
	let agreed = $state(false);
	let paymentUi: { submit: () => Promise<boolean> } | undefined = $state();
	let paymentError = $state('');
	const offer = $derived(data.offer);
	const canAccept = $derived(offer.status === 'offered' && offer.eligible && (offer.remaining > 0 || offer.has_payment_hold));
	const paymentLabel = $derived(offer.payment_mode === 'online' ? 'オンライン決済' : '現地精算');
	const deadline = $derived(new Date(offer.expires_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }));
	async function payRequest(action: string, intentId?: string) {
		const fd = new FormData(); fd.set('action', action); fd.set('total', String(offer.total)); fd.set('consent', agreed ? 'yes' : 'no'); if (intentId) fd.set('intentId', intentId);
		const response = await fetch(`/account/upgrades/${offer.id}/pay`, { method: 'POST', body: fd });
		const result = await response.json(); if (!response.ok || !result.ok) throw new Error(result.message || 'お支払いを確認できませんでした。'); return result;
	}
</script>
<svelte:head><title>{offer.title} | お部屋のアップグレード</title></svelte:head>
<a href="/account/upgrades" class="text-sm text-brand-800 hover:underline">← ご提案一覧</a>
<p class="mt-5 text-sm text-stone-500">{offer.facility_name} · ご予約 {offer.booking_code} · {offer.room_index}室目</p>
<h2 class="mt-2 text-2xl text-brand-900">{offer.title}</h2>
{#if form?.message}<p role="status" class="mt-4 rounded-lg p-4 {form.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}">{form.message}</p>{/if}
{#if paymentError}<p role="alert" class="mt-4 rounded-lg bg-red-50 p-4 text-red-700">{paymentError}</p>{/if}
{#if data.paymentResult === 'refunded'}<p role="status" class="mt-4 rounded-lg bg-amber-50 p-4">受付期限などにより確定できず、追加料金の全額返金手続きを行いました。</p>{/if}
{#if data.paymentResult === 'pending' && offer.status !== 'accepted'}<p role="status" class="mt-4 rounded-lg bg-amber-50 p-4">お支払い・確定状況を確認中です。再度お支払いをせず、少し時間をおいて画面を更新してください。</p>{/if}
<div class="mt-5 rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
	<p class="text-sm">ご宿泊：{offer.checkin}〜{offer.checkout} ／ 大人{offer.adults}名</p>
	<div class="mt-4 grid gap-3 sm:grid-cols-2">
		<div class="rounded-xl bg-stone-50 p-4"><p class="text-xs text-stone-500">現在のお部屋</p><p class="mt-1 font-semibold">{offer.source_name}</p></div>
		<div class="rounded-xl bg-amber-50 p-4"><p class="text-xs text-stone-500">アップグレード後</p><p class="mt-1 font-semibold text-brand-900">{offer.target_name ?? '受付終了のお部屋'}</p>{#if offer.target_area}<p class="mt-1 text-sm">{offer.target_area}㎡</p>{/if}</div>
	</div>
	{#if offer.target_photos?.length}<div class="mt-4 grid gap-3 sm:grid-cols-2">{#each offer.target_photos.slice(0, 4) as photo}<img src={photo.url} alt={photo.caption ?? offer.target_name} class="aspect-[4/3] w-full rounded-xl object-cover" loading="lazy" />{/each}</div>{/if}
	{#if offer.description}<p class="mt-5 whitespace-pre-line leading-7 text-stone-700">{offer.description}</p>{/if}
	{#if offer.target_description}<p class="mt-4 whitespace-pre-line text-sm leading-7 text-stone-600">{offer.target_description}</p>{/if}
	{#if offer.target_amenities?.length}<p class="mt-3 text-sm text-stone-500">{offer.target_amenities.join(' ／ ')}</p>{/if}
	<div class="mt-6 rounded-xl bg-stone-50 p-4">
		<p class="text-sm">{offer.price_basis === 'night' ? '1室1泊あたり' : '1室の滞在全体'} {offer.unit_amount.toLocaleString()}円</p>
		<p class="mt-1 text-xl font-semibold text-brand-900">追加料金合計 {offer.total.toLocaleString()}円<span class="ml-1 text-sm font-normal">（税込・{paymentLabel}）</span></p>
		<p class="mt-2 text-sm text-stone-600">宿泊日・人数・プラン・元の宿泊料金とキャンセル規定はそのままです。追加料金はクーポン・ポイント割引の対象外です。</p>
		<p class="mt-2 text-sm text-stone-600">このお部屋の元の宿泊料金 {offer.base_total.toLocaleString()}円（割引前）＋追加 {offer.total.toLocaleString()}円。お支払いは予約時の方法を引き継ぎ、オンライン決済の予約は追加分もオンライン決済します。対象のお部屋のご予約を取り消した場合、決済済みの追加分は全額返金します。</p>
	</div>
	{#if offer.status === 'accepted'}
		<p class="mt-5 rounded-xl bg-emerald-50 p-4 text-emerald-800">アップグレードは確定しています。{offer.payment_mode === 'online' ? '追加料金はオンライン決済済みです。' : '追加料金はご滞在時にお支払いください。'}確定後のお部屋・日程の変更は施設へお問い合わせください。</p>
	{:else if canAccept}
		<p class="mt-5 text-sm text-stone-600">受付期限：{deadline}（日本時間）</p>
		<p class="mt-2 text-sm text-stone-500">お部屋はまだ確保されていません。お申し込み時に空室を再確認し、確保できた場合に確定します。</p>
		{#if offer.payment_mode === 'online'}
			<div class="mt-5"><StripePayment bind:this={paymentUi} publishableKey={data.stripeKey} mode="payment" amount={offer.total} express={false}
				validate={() => agreed ? null : '追加料金と条件への同意が必要です。'} prepare={() => payRequest('prepare')}
				onconfirmed={async (r) => { await payRequest('confirm', r.intentId); await invalidateAll(); }} onerror={(message) => paymentError = message} onbusychange={(value) => busy = value} /></div>
			<label class="mt-4 flex items-start gap-3 text-sm leading-6"><input type="checkbox" required bind:checked={agreed} disabled={busy} class="mt-1" /><span>追加料金合計 {offer.total.toLocaleString()}円（税込・オンライン決済）と上記の条件に同意します。</span></label>
			<button disabled={!agreed || busy || !data.stripeKey} onclick={() => paymentUi?.submit()} class="mt-4 w-full rounded-lg bg-brand-800 px-5 py-3 text-white disabled:opacity-40">{busy ? 'お支払いと空室を確認中…' : '同意して追加料金を支払い、申し込む'}</button>
		{:else}
		<form method="POST" action="?/accept" class="mt-5" use:enhance={() => { busy = true; return async ({ update }) => { try { await update(); } finally { busy = false; } }; }}>
			<input type="hidden" name="total" value={offer.total} />
			<label class="flex items-start gap-3 text-sm leading-6"><input type="checkbox" name="consent" value="yes" required bind:checked={agreed} disabled={busy} class="mt-1" /><span>追加料金合計 {offer.total.toLocaleString()}円（税込・現地精算）と上記の条件に同意して、お部屋のアップグレードを申し込みます。</span></label>
			<button disabled={!agreed || busy} class="mt-4 w-full rounded-lg bg-brand-800 px-5 py-3 text-white disabled:opacity-40">{busy ? '空室を確認しています…' : '同意してアップグレードを申し込む'}</button>
		</form>
		{/if}
		<form method="POST" action="?/decline" use:enhance class="mt-3"><button disabled={busy} class="rounded-lg border border-stone-300 px-4 py-2 text-sm text-stone-600">今回は見送る</button></form>
	{:else}
		<p class="mt-5 rounded-xl bg-stone-100 p-4 text-stone-600">{offer.status === 'offered' ? offer.eligible && offer.remaining === 0 ? 'ご提案のお部屋は現在満室です。元のご予約はそのままです。' : 'この提案は受付終了、または予約内容が変更されています。' : UPGRADE_STATUS[offer.status]}</p>
	{/if}
</div>
