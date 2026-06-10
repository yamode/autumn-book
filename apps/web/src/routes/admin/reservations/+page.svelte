<script lang="ts">
	import { formatYen, formatDateJa } from '$lib/format';

	let { data } = $props();

	const statusLabel = { reserved: '予約済', cancelled: 'キャンセル', stayed: '宿泊済' } as const;
</script>

<svelte:head><title>予約管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-4 text-lg font-bold text-stone-800">予約管理 — {data.currentFacility.name}</h1>

<form method="GET" class="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm">
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		ステータス
		<select name="status" class="rounded-md border border-stone-300 px-2 py-1.5">
			<option value="" selected={data.filters.status === ''}>すべて</option>
			<option value="reserved" selected={data.filters.status === 'reserved'}>予約済</option>
			<option value="cancelled" selected={data.filters.status === 'cancelled'}>キャンセル</option>
			<option value="stayed" selected={data.filters.status === 'stayed'}>宿泊済</option>
		</select>
	</label>
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		チャネル
		<select name="channel" class="rounded-md border border-stone-300 px-2 py-1.5">
			<option value="autumn_booking" selected={data.filters.channel === 'autumn_booking'}>直販のみ</option>
			<option value="" selected={data.filters.channel === ''}>すべて（OTA含む・閲覧）</option>
		</select>
	</label>
	<label class="flex flex-col gap-1 text-xs text-stone-500">
		検索
		<input name="q" value={data.filters.q} placeholder="予約番号・氏名" class="rounded-md border border-stone-300 px-2 py-1.5" />
	</label>
	<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-white">絞り込む</button>
</form>

<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
	<table class="w-full min-w-[720px] text-sm">
		<thead>
			<tr class="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
				<th class="px-3 py-2">予約番号</th><th>ゲスト</th><th>チェックイン</th><th>泊数</th><th>部屋</th><th class="text-right">金額 / 支払</th><th>ステータス</th>
			</tr>
		</thead>
		<tbody>
			{#each data.list as b}
				<tr class="border-b border-stone-100 hover:bg-stone-50">
					<td class="px-3 py-2">
						<a href="/admin/reservations/{b.code}" class="font-medium text-accent-600 hover:underline">{b.code}</a>
						{#if b.channel === 'ota'}<span class="ml-1 rounded bg-stone-100 px-1 text-[10px] text-stone-500">OTA</span>{/if}
					</td>
					<td>{b.guest.name}</td>
					<td>{formatDateJa(b.checkin)}</td>
					<td>{b.nights}泊</td>
					<td class="max-w-[160px] truncate">{b.roomName}</td>
					<td class="text-right">
						{formatYen(b.total)}
						<span class="text-xs {b.paymentStatus === 'paid' ? 'text-emerald-600' : 'text-stone-400'}">
							{b.payment === 'onsite' ? '現地' : (b.paymentStatus === 'paid' ? (b.payment === 'paypay' ? 'PayPay済' : 'カード済') : b.paymentStatus)}
						</span>
					</td>
					<td>
						<span class="rounded-full px-2 py-0.5 text-xs {b.status === 'reserved' ? 'bg-emerald-50 text-emerald-700' : b.status === 'cancelled' ? 'bg-stone-100 text-stone-500' : 'bg-blue-50 text-blue-600'}">
							{statusLabel[b.status]}
						</span>
					</td>
				</tr>
			{:else}
				<tr><td colspan="7" class="px-3 py-8 text-center text-stone-400">該当する予約がありません</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<p class="mt-3 text-xs text-stone-400">※ 部屋割り・チェックイン操作・現場帳票は PMS で行います。本画面は直販予約の確認と例外対応用です。</p>
