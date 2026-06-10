<script lang="ts">
	let { data } = $props();

	const statusLabel = { draft: '下書き', scheduled: '予約済', sending: '配信中', sent: '配信済' } as const;
	const statusCls = {
		draft: 'bg-stone-100 text-stone-500',
		scheduled: 'bg-amber-50 text-amber-700',
		sending: 'bg-blue-50 text-blue-600',
		sent: 'bg-emerald-50 text-emerald-700'
	} as const;
</script>

<svelte:head><title>メルマガ ｜ 山人管理</title></svelte:head>

<div class="mb-4 flex items-center justify-between">
	<h1 class="text-lg font-bold text-stone-800">メルマガ配信</h1>
	<a href="/admin/mail/new" class="rounded-lg bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700">＋ 新規作成</a>
</div>

<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
	<table class="w-full min-w-[640px] text-sm">
		<thead>
			<tr class="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
				<th class="px-3 py-2">タイトル</th><th>セグメント</th><th>状態</th><th>配信日時</th><th class="text-right">送信 / 開封</th>
			</tr>
		</thead>
		<tbody>
			{#each data.campaigns as c}
				<tr class="border-b border-stone-100">
					<td class="px-3 py-2.5">
						<p class="font-medium text-stone-800">{c.title}</p>
						<p class="text-xs text-stone-400">{c.subject}</p>
					</td>
					<td class="text-xs text-stone-500">
						{c.segment.ranks.length === 0 ? '全会員' : c.segment.ranks.join(' / ')}
					</td>
					<td><span class="rounded-full px-2 py-0.5 text-xs {statusCls[c.status]}">{statusLabel[c.status]}</span></td>
					<td class="text-xs">{c.scheduledAt ?? '—'}</td>
					<td class="text-right text-xs">
						{#if c.stats}
							{c.stats.sent}通 ／ 開封率 {Math.round((c.stats.opened / c.stats.sent) * 100)}%
							{#if c.stats.failed > 0}<span class="text-red-500">（失敗{c.stats.failed}）</span>{/if}
						{:else}
							—
						{/if}
					</td>
				</tr>
			{:else}
				<tr><td colspan="5" class="px-3 py-8 text-center text-stone-400">配信履歴はありません</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<p class="mt-3 text-xs text-stone-400">配信基盤：Resend（予定）。メルマガ受信 ON（オプトイン）の会員のみが対象になります。配信停止リンクは全メールに自動付与されます。</p>
