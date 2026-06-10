<script lang="ts">
	import RankBadge from '$lib/components/RankBadge.svelte';

	let { data } = $props();
</script>

<svelte:head><title>会員管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-4 text-lg font-bold text-stone-800">会員管理</h1>

<form method="GET" class="mb-4 flex gap-2">
	<input name="q" value={data.q} placeholder="氏名・メール・会員番号で検索" class="w-72 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm" />
	<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-sm text-white">検索</button>
</form>

<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
	<table class="w-full min-w-[640px] text-sm">
		<thead>
			<tr class="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
				<th class="px-3 py-2">会員番号</th><th>氏名</th><th>ランク</th><th class="text-right">ポイント残高</th><th>登録日</th><th>メルマガ</th>
			</tr>
		</thead>
		<tbody>
			{#each data.members as m}
				<tr class="border-b border-stone-100 hover:bg-stone-50">
					<td class="px-3 py-2"><a href="/admin/members/{m.id}" class="font-medium text-accent-600 hover:underline">{m.memberCode}</a></td>
					<td>{m.name}<span class="block text-xs text-stone-400">{m.email}</span></td>
					<td><RankBadge rank={m.rank} /></td>
					<td class="text-right">{m.balance.toLocaleString()} pt</td>
					<td class="text-xs">{m.joinedAt}</td>
					<td class="text-xs">{m.mailOptIn ? '✔ 受信' : '—'}</td>
				</tr>
			{:else}
				<tr><td colspan="6" class="px-3 py-8 text-center text-stone-400">該当する会員がいません</td></tr>
			{/each}
		</tbody>
	</table>
</div>
