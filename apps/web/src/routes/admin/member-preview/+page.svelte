<script lang="ts">
	import { previewRankName } from '$lib/rank-name';
	let { data } = $props();
</script>

<svelte:head><title>会員ランクのプレビュー｜Book管理画面</title></svelte:head>

<h1 class="text-xl font-bold text-stone-900">会員ランクのプレビュー</h1>
<p class="mt-2 max-w-2xl text-sm leading-6 text-stone-600">ランクを選ぶと、検証用の会員としてBookが別タブに開きます。マイページ、会員特典、空室検索から予約までの流れを確認できます。検証用の操作は実際の予約や会員情報に反映されません。</p>

{#if data.options.length}
	<div class="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
		{#each data.options as { rank, token } (rank)}
			{@const label = previewRankName(rank)}
			<form method="POST" action={data.destination} target="_blank" rel="noopener" class="rounded-xl border border-stone-200 bg-white p-4">
				<input type="hidden" name="token" value={token} />
				<h2 class="text-base font-semibold text-stone-900">{label}</h2>
				<button aria-label={`${label}でプレビュー`} class="mt-3 min-h-11 w-full rounded-lg border border-stone-300 px-3 text-sm font-medium hover:bg-stone-50">プレビューを開く</button>
			</form>
		{/each}
	</div>
{:else}
	<p class="mt-5 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">この環境では会員ランクのプレビューが未設定です。</p>
{/if}
