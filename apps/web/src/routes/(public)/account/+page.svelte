<script lang="ts">
	import { page } from '$app/state';
	import { formatYen, formatDateLongJa } from '$lib/format';

	let { data } = $props();

	const statusLabel = { reserved: '予約済', cancelled: 'キャンセル済', stayed: '宿泊済' } as const;
	const statusCls = {
		reserved: 'bg-emerald-50 text-emerald-700',
		cancelled: 'bg-stone-100 text-stone-500',
		stayed: 'bg-blue-50 text-blue-600'
	} as const;
</script>

<svelte:head><title>マイページ ｜ 山人</title></svelte:head>

{#if page.url.searchParams.get('welcome')}
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
		ご入会ありがとうございます！入会ボーナス <strong>500pt</strong> を付与しました。次のご予約からすぐお使いいただけます。
	</p>
{/if}

{#if data.expiring > 0}
	<p class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
		⚠ 30日以内に失効するポイントが <strong>{data.expiring.toLocaleString()}pt</strong> あります。<a href="/search" class="underline">次のご予約で利用する</a>
	</p>
{/if}

<section>
	<h2 class="mb-3 font-medium text-brand-900">次のご宿泊</h2>
	{#each data.upcoming as b}
		<a href="/account/reservations/{b.code}" class="mb-3 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-4 transition hover:shadow-md sm:flex-row">
			<img src={b.photo} alt="" class="h-32 w-full rounded-xl object-cover sm:w-48" />
			<div class="flex-1">
				<div class="flex items-center gap-2">
					<span class="rounded-full px-2 py-0.5 text-xs {statusCls[b.status]}">{statusLabel[b.status]}</span>
					<span class="text-xs text-stone-400">{b.code}</span>
					{#if b.channel === 'ota'}<span class="rounded bg-stone-100 px-1.5 text-xs text-stone-500">OTA予約</span>{/if}
				</div>
				<h3 class="font-display mt-1 text-lg text-brand-900">{b.facilityName}</h3>
				<p class="text-sm text-stone-600">{formatDateLongJa(b.checkin)} から {b.nights}泊 ・ {b.roomName} ・ 大人{b.adults}名</p>
				<p class="mt-1 text-sm font-medium">{formatYen(b.total - b.pointsUsed)} <span class="text-xs font-normal text-stone-400">{b.payment === 'card' ? '支払済' : '現地払い'}</span></p>
			</div>
			<span class="self-center text-stone-300">→</span>
		</a>
	{:else}
		<div class="rounded-2xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
			ご予約はありません。<a href="/search" class="text-accent-600 underline">宿を探す</a>
		</div>
	{/each}
</section>

{#if data.past.length > 0}
	<section class="mt-8">
		<h2 class="mb-3 font-medium text-brand-900">過去のご利用・キャンセル</h2>
		<div class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
			{#each data.past as b}
				<a href="/account/reservations/{b.code}" class="flex items-center gap-3 px-4 py-3 text-sm hover:bg-stone-50">
					<span class="rounded-full px-2 py-0.5 text-xs {statusCls[b.status]}">{statusLabel[b.status]}</span>
					<span class="flex-1">{b.facilityName} ／ {formatDateLongJa(b.checkin)}〜</span>
					<span class="text-stone-400">{b.code}</span>
				</a>
			{/each}
		</div>
	</section>
{/if}
