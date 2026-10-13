<script lang="ts">
	import { UPGRADE_STATUS } from '$lib/room-upgrades';
	let { data } = $props();
</script>
<svelte:head><title>お部屋のアップグレード | マイページ</title></svelte:head>
<h2 class="text-xl text-brand-900">お部屋のアップグレード</h2>
<p class="mt-2 text-sm text-stone-600">ご宿泊に合わせた施設からのご提案をご確認いただけます。</p>
{#if !data.enabled}<p class="mt-5 text-stone-500">本番の会員ログインでご利用いただけます。</p>{/if}
{#if data.offers.length === 0}<p class="mt-6 rounded-xl bg-stone-50 p-5 text-stone-600">現在、ご案内している提案はありません。</p>{/if}
<div class="mt-6 space-y-4">
	{#each data.offers as o (o.id)}
		<a href="/account/upgrades/{o.id}" class="block rounded-xl border border-stone-200 bg-white p-5 hover:border-brand-800">
			<p class="text-xs text-stone-500">{o.facility_name} · ご予約 {o.booking_code} · {o.room_index}室目</p>
			<h3 class="mt-2 font-semibold text-brand-900">{o.title}</h3>
			<p class="mt-2 text-sm">{o.checkin}〜{o.checkout} ／ {o.source_name} → {o.target_name ?? '受付終了のお部屋'}</p>
			<p class="mt-2 text-sm">追加 {o.total.toLocaleString()}円（税込・{o.payment_mode === 'online' ? 'オンライン決済' : '現地精算'}）</p>
			<span class="mt-3 inline-block rounded-full bg-stone-100 px-3 py-1 text-xs">{o.status === 'offered' && !o.eligible ? '受付終了または予約内容変更' : UPGRADE_STATUS[o.status]}</span>
		</a>
	{/each}
</div>
