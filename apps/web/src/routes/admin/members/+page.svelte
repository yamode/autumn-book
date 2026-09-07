<script lang="ts">
	import RankBadge from '$lib/components/RankBadge.svelte';

	let { data } = $props();
</script>

<svelte:head><title>会員管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">会員管理</h1>
<p class="mb-4 text-xs text-stone-400">
	{#if data.live}
		アプリ・Web 共通の会員（book.members）です。
	{:else}
		デモデータを表示しています（本番接続時は実会員が表示されます）。
	{/if}
</p>

{#if data.error}
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
		{data.error}
	</div>
{/if}

<form method="GET" class="mb-4 flex gap-2">
	<input
		name="q"
		value={data.q}
		placeholder={data.live ? '氏名・フリガナ・会員番号で検索' : '氏名・メール・会員番号で検索'}
		class="w-72 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm"
	/>
	<button type="submit" class="bg-brand-800 rounded-md px-4 py-1.5 text-sm text-white">検索</button>
</form>

<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
	<table class="w-full min-w-[720px] text-sm">
		<thead>
			<tr class="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
				<th class="px-3 py-2">会員番号</th>
				<th>氏名</th>
				<th>ランク</th>
				{#if data.live}
					<th class="text-right">push</th>
					<th>最終宿泊</th>
				{:else}
					<th class="text-right">ポイント残高</th>
				{/if}
				<th>登録日</th>
				{#if !data.live}<th>メルマガ</th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each data.members as m}
				<tr class="border-b border-stone-100 hover:bg-stone-50">
					<td class="px-3 py-2">
						<a href="/admin/members/{m.id}" class="text-accent-600 font-medium hover:underline">
							{m.memberCode}
						</a>
					</td>
					<td>
						{m.name}
						<span class="block text-xs text-stone-400">{m.email}</span>
					</td>
					<td><RankBadge rank={m.rank} /></td>
					{#if data.live}
						<td class="text-right text-xs">
							{#if m.deviceCount && m.deviceCount > 0}
								{m.deviceCount} 台{m.pushOptIn ? '' : '（受信オフ）'}
							{:else}
								<span class="text-stone-400">—</span>
							{/if}
						</td>
						<td class="text-xs">{m.lastStay ?? '—'}</td>
					{:else}
						<td class="text-right">{(m.balance ?? 0).toLocaleString()} pt</td>
					{/if}
					<td class="text-xs">{m.joinedAt}</td>
					{#if !data.live}<td class="text-xs">{m.mailOptIn ? '✔ 受信' : '—'}</td>{/if}
				</tr>
			{:else}
				<tr>
					<td colspan="7" class="px-3 py-8 text-center text-stone-400">該当する会員がいません</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
