<script lang="ts">
	import { formatYen, formatDateJa } from '$lib/format';

	let { data } = $props();
</script>

<svelte:head><title>ダッシュボード ｜ 山人管理</title></svelte:head>

<h1 class="mb-4 text-lg font-bold text-stone-800">ダッシュボード — {data.currentFacility.name}</h1>

<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
	{#each [{ label: '本日のチェックイン', value: `${data.todayCheckins} 件`, sub: '' }, { label: '本日の新規直販予約', value: `${data.newToday} 件`, sub: '' }, { label: 'キャンセル（累計）', value: `${data.cancelledToday} 件`, sub: '' }, { label: '仮押さえ中（hold）', value: `${data.activeHolds} 件`, sub: 'いま予約操作中のお客様' }] as card}
		<div class="rounded-xl border border-stone-200 bg-white p-4">
			<p class="text-xs text-stone-500">{card.label}</p>
			<p class="mt-1 text-2xl font-bold text-brand-900">{card.value}</p>
			{#if card.sub}<p class="text-[11px] text-stone-400">{card.sub}</p>{/if}
		</div>
	{/each}
</div>

<div class="mt-4 grid gap-4 lg:grid-cols-2">
	<div class="rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="text-sm font-medium text-stone-700">直近30日の直販</h2>
		<div class="mt-3 flex items-end gap-6">
			<div>
				<p class="text-3xl font-bold text-brand-900">{data.recentCount}<span class="text-sm font-normal text-stone-500"> 件</span></p>
				<p class="text-xs text-stone-400">予約件数</p>
			</div>
			<div>
				<p class="text-3xl font-bold text-brand-900">{formatYen(data.recentTotal)}</p>
				<p class="text-xs text-stone-400">予約金額（キャンセル除く）</p>
			</div>
		</div>
	</div>

	<div class="rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="text-sm font-medium text-stone-700">アラート</h2>
		{#if data.alerts.length === 0}
			<p class="mt-3 text-sm text-stone-400">未処理のアラートはありません（SC在庫通知・決済不一致・メール送信失敗をここに表示）</p>
		{:else}
			<ul class="mt-2 space-y-1.5 text-sm">
				{#each data.alerts as a}
					<li class="rounded bg-amber-50 px-2 py-1.5 text-amber-800">{a.text}</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<div class="mt-4 rounded-xl border border-stone-200 bg-white p-4">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-medium text-stone-700">直近のチェックイン予定</h2>
		<a href="/admin/reservations" class="text-xs text-accent-600 hover:underline">予約管理へ →</a>
	</div>
	<table class="mt-2 w-full text-sm">
		<thead>
			<tr class="border-b border-stone-200 text-left text-xs text-stone-400">
				<th class="py-1.5">チェックイン</th><th>予約番号</th><th>ゲスト</th><th class="text-right">金額</th>
			</tr>
		</thead>
		<tbody>
			{#each data.upcoming as b}
				<tr class="border-b border-stone-100">
					<td class="py-2">{formatDateJa(b.checkin)}</td>
					<td><a href="/admin/reservations/{b.code}" class="text-accent-600 hover:underline">{b.code}</a></td>
					<td>{b.guest.name}</td>
					<td class="text-right">{formatYen(b.total)}</td>
				</tr>
			{:else}
				<tr><td colspan="4" class="py-4 text-center text-stone-400">予定はありません</td></tr>
			{/each}
		</tbody>
	</table>
</div>
