<script lang="ts">
	import Unavailable from '$lib/components/admin/Unavailable.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import type { CouponRow } from '$lib/server/admin-app-data';

	let { data } = $props();

	let showInactive = $state(false);

	const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
	const md = (s: string) => {
		const [, m, d] = s.slice(0, 10).split('-');
		return `${Number(m)}/${Number(d)}`;
	};
	const discount = (c: CouponRow) =>
		c.discount_type === 'percent' ? `${c.discount_value}%引き` : `${yen(c.discount_value)}引き`;

	/** 使用率の分母は issued + used（取消・期限切れは除く） */
	const usageRate = (c: CouponRow) =>
		c.issued + c.used === 0 ? null : Math.round((c.used / (c.issued + c.used)) * 100);

	/** 期限が近く未使用が残っているものを目立たせる */
	function daysLeft(c: CouponRow): number {
		const until = new Date(`${c.valid_until.slice(0, 10)}T00:00:00`);
		return Math.ceil((until.getTime() - Date.now()) / 86_400_000);
	}

	const visible = $derived(
		(data.coupons ?? []).filter((c: CouponRow) => showInactive || c.is_active)
	);

	const facilityName = (id: string | null) =>
		id ? (data.facilities?.find((f) => f.id === id)?.name ?? '（施設指定）') : '全施設';
</script>

<svelte:head><title>クーポン ｜ 山人管理</title></svelte:head>

<PageHeader title="クーポン" description="アプリの予約確認画面で会員が選べる割引券です。配布はクーポン詳細から行います。">
	{#snippet actions()}
		{#if !data.unavailable && data.user?.role === 'admin'}
			<a
				href="/admin/coupons/new"
				class="inline-flex min-h-10 items-center rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500">＋ 新しいクーポン</a
			>
		{/if}
	{/snippet}
</PageHeader>

{#if data.unavailable}
	<Unavailable authMode={data.authMode} dataSource={data.dataSource} />
{:else}
	{#if data.error}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{data.error}
		</div>
	{/if}

	<label class="mb-3 flex items-center gap-2 text-sm text-stone-600">
		<input type="checkbox" bind:checked={showInactive} class="h-4 w-4" />
		無効なクーポンも表示する
	</label>

	{#if visible.length === 0}
		<p class="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
			{(data.coupons ?? []).length === 0
				? 'まだクーポンがありません。「＋ 新しいクーポン」から作成します。'
				: '有効なクーポンがありません。'}
		</p>
	{:else}
		<!-- スマホ: カード状の並び（md 以上は表） -->
		<ul class="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white md:hidden">
			{#each visible as c (c.id)}
				{@const left = daysLeft(c)}
				{@const soon = c.is_active && left >= 0 && left <= 7 && c.issued > 0}
				<li>
					<a href="/admin/coupons/{c.id}" class="block px-4 py-3 text-sm active:bg-stone-50">
						<div class="flex items-start justify-between gap-2">
							<span class="min-w-0 font-medium text-stone-800">{c.name}</span>
							{#if c.is_active}
								<span class="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">有効</span>
							{:else}
								<span class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">無効</span>
							{/if}
						</div>
						<p class="mt-0.5 text-xs text-stone-500">{discount(c)}・{facilityName(c.facility_id)}</p>
						<p class="mt-0.5 text-xs {soon ? 'text-amber-700' : 'text-stone-500'}">
							{md(c.valid_from)}〜{md(c.valid_until)}{#if soon}（あと {left} 日）{/if}
							・配布 {c.issued + c.used}・使用 {c.used}{usageRate(c) === null ? '' : `（${usageRate(c)}%）`}
						</p>
					</a>
				</li>
			{/each}
		</ul>
		<div class="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white md:block">
			<table class="w-full min-w-[880px] text-sm">
				<thead class="bg-stone-50 text-xs text-stone-500">
					<tr>
						<th class="px-3 py-2 text-left">名前</th>
						<th class="px-3 py-2 text-left">割引</th>
						<th class="px-3 py-2 text-left">施設</th>
						<th class="px-3 py-2 text-left">利用期間</th>
						<th class="px-3 py-2 text-right">配布</th>
						<th class="px-3 py-2 text-right">使用</th>
						<th class="px-3 py-2 text-right">使用率</th>
						<th class="px-3 py-2 text-left">状態</th>
					</tr>
				</thead>
				<tbody>
					{#each visible as c (c.id)}
						{@const left = daysLeft(c)}
						{@const soon = c.is_active && left >= 0 && left <= 7 && c.issued > 0}
						<tr class="border-t border-stone-100 hover:bg-stone-50">
							<td class="px-3 py-2">
								<a href="/admin/coupons/{c.id}" class="font-medium text-stone-800 underline">{c.name}</a>
							</td>
							<td class="px-3 py-2 text-stone-600">{discount(c)}</td>
							<td class="px-3 py-2 text-stone-600">{facilityName(c.facility_id)}</td>
							<td class="px-3 py-2 {soon ? 'text-amber-700' : 'text-stone-600'}">
								{md(c.valid_from)}〜{md(c.valid_until)}
								{#if soon}<span class="ml-1 rounded-full bg-amber-50 px-1.5 py-0.5 text-xs">あと {left} 日</span>{/if}
							</td>
							<td class="px-3 py-2 text-right text-stone-600">{c.issued + c.used}</td>
							<td class="px-3 py-2 text-right text-stone-600">{c.used}</td>
							<td class="px-3 py-2 text-right text-stone-600">
								{usageRate(c) === null ? '—' : `${usageRate(c)}%`}
							</td>
							<td class="px-3 py-2">
								{#if c.is_active}
									<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">有効</span>
								{:else}
									<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">無効</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
{/if}
