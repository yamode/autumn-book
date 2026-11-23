<script lang="ts">
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { CHEF_AREA_LABEL, CHEF_PAYMENT_LABEL, CHEF_STALE_DAYS, CHEF_STATUS_LABEL, CHEF_STYLE_LABEL, chefDateLabel, chefIsStale, chefTimeLabel, yen, type ChefStatus } from '$lib/chef';

	let { data } = $props();

	const tabs: [string, string][] = [
		['active', '仮予約・確定'],
		['requested', '仮予約'],
		['confirmed', '確定'],
		['paid', '支払い済み'],
		['declined', 'お断り'],
		['cancelled', '取消'],
		['all', 'すべて']
	];
	const badge: Record<string, string> = {
		requested: 'bg-amber-100 text-amber-800',
		confirmed: 'bg-sky-100 text-sky-800',
		paid: 'bg-emerald-100 text-emerald-800',
		declined: 'bg-stone-100 text-stone-500',
		cancelled: 'bg-stone-100 text-stone-500'
	};
	const received = (s: string) => new Date(s).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	const staleCount = $derived(data.items.filter((r) => chefIsStale(r.status, r.created_at)).length);
</script>

<svelte:head><title>出張シェフ・予約一覧 ｜ 山人管理</title></svelte:head>

<PageHeader title="出張シェフ・予約一覧" facility="山人-yamado-（西和賀）" description="仮予約を開いて、設備・アレルギー・住所を確かめてから確定してください。仮予約のまま{CHEF_STALE_DAYS}日以上たったものは赤く表示します。">
	{#snippet actions()}
		<a href="/admin/chef" class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">← 受付枠</a>
	{/snippet}
</PageHeader>

<nav class="mb-3 flex flex-wrap gap-1 text-sm" aria-label="状態で絞り込む">
	{#each tabs as [key, label] (key)}
		<a href="?status={key}" class="rounded-md px-3 py-1.5 {data.status === key ? 'bg-brand-800 text-white' : 'bg-white text-stone-600 hover:bg-stone-100'}">{label}</a>
	{/each}
</nav>

{#if data.unavailable}
	<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{data.unavailable}</p>
{:else if data.items.length === 0}
	<p class="rounded-lg border border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-500">該当する予約はありません。</p>
{:else}
	{#if staleCount}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">仮予約のまま{CHEF_STALE_DAYS}日以上たっている予約が {staleCount}件あります。</p>{/if}
	<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full min-w-[760px] text-sm">
			<thead class="bg-stone-50 text-xs text-stone-500">
				<tr>
					<th class="px-3 py-2 text-left font-normal">ご利用日時</th>
					<th class="px-3 py-2 text-left font-normal">状態</th>
					<th class="px-3 py-2 text-left font-normal">お名前</th>
					<th class="px-3 py-2 text-left font-normal">内容</th>
					<th class="px-3 py-2 text-right font-normal">税込</th>
					<th class="px-3 py-2 text-left font-normal">シェフ</th>
					<th class="px-3 py-2 text-left font-normal">受付</th>
				</tr>
			</thead>
			<tbody>
				{#each data.items as r (r.id)}
					{@const stale = chefIsStale(r.status, r.created_at)}
					<tr class="border-t border-stone-100 hover:bg-stone-50 {stale ? 'bg-red-50/70' : ''}">
						<td class="px-3 py-2 whitespace-nowrap"><a href="/admin/chef/reservations/{r.id}" class="text-brand-800 underline">{chefDateLabel(r.date)} {chefTimeLabel(r.start_time)}</a></td>
						<td class="px-3 py-2 whitespace-nowrap">
							<span class="rounded px-1.5 py-0.5 text-xs {badge[r.status] ?? ''}">{CHEF_STATUS_LABEL[r.status as ChefStatus] ?? r.status}</span>
							{#if stale}<span class="ml-1 text-xs font-medium text-red-700">{CHEF_STALE_DAYS}日以上未対応</span>{/if}
						</td>
						<td class="px-3 py-2">{r.name} 様</td>
						<td class="px-3 py-2 text-xs text-stone-600">
							{CHEF_STYLE_LABEL[r.style] ?? r.style}・{r.adults + r.children + r.infants}名・{CHEF_AREA_LABEL[r.area] ?? r.area}・{CHEF_PAYMENT_LABEL[r.payment_method] ?? r.payment_method}
						</td>
						<td class="px-3 py-2 text-right whitespace-nowrap">{yen(r.amount_total)}</td>
						<td class="px-3 py-2 text-xs text-stone-600">{r.chef_name}</td>
						<td class="px-3 py-2 text-xs whitespace-nowrap text-stone-500">{received(r.created_at)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
