<script lang="ts">
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data } = $props();
	const dateTime = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Asia/Tokyo' });
	const formatTime = (value: string) => dateTime.format(new Date(value));
</script>

<svelte:head><title>削除済み投稿 ｜ 山人管理</title></svelte:head>
<PageHeader title="削除済み投稿" description="削除前の本文と、削除者・削除日時を確認できます。" />
<a href="/admin/community" class="mb-4 inline-flex min-h-11 items-center text-sm text-brand-800 underline">コミュニティ管理へ戻る</a>

{#if data.loadError}
	<p class="rounded-lg bg-red-50 p-4 text-sm text-red-800" role="alert">削除済み投稿を読み込めませんでした。運営権限や接続をご確認ください。</p>
{:else if data.posts.length === 0}
	<p class="rounded-xl border border-dashed p-5 text-sm text-stone-600">このページに削除済み投稿はありません。</p>
{:else}
	<ul class="space-y-3">
		{#each data.posts as post (post.id)}
			<li class="min-w-0 rounded-xl border border-stone-200 bg-white p-4 [overflow-wrap:anywhere]">
				<p class="text-xs text-stone-600">{post.board_title}</p>
				<h2 class="mt-1 font-medium text-brand-900">{post.thread_title} #{post.post_no}</h2>
				<dl class="mt-2 grid gap-2 text-sm sm:grid-cols-2">
					<div>
						<dt class="text-xs text-stone-600">削除者</dt>
						<dd>{post.deleted_by_name ?? post.deleted_by ?? (post.deleted_at ? 'アカウント記録なし' : '記録なし')}</dd>
					</div>
					<div>
						<dt class="text-xs text-stone-600">削除日時（日本時間）</dt>
						<dd>{#if post.deleted_at}<time datetime={post.deleted_at}>{formatTime(post.deleted_at)}</time>{:else}記録なし{/if}</dd>
					</div>
				</dl>
				<details class="mt-3">
					<summary class="cursor-pointer py-2 text-sm font-medium text-brand-800">削除前の本文を表示</summary>
					<p class="mt-1 whitespace-pre-wrap rounded-lg bg-stone-50 p-3 text-sm">{post.body}</p>
					{#if post.deleted_by_name && post.deleted_by}
						<p class="mt-2 text-xs text-stone-600">削除者のアカウントID {post.deleted_by}</p>
					{/if}
				</details>
			</li>
		{/each}
	</ul>
{/if}

{#if data.page > 1 || data.hasNext}
	<nav class="mt-4 flex flex-wrap gap-3 text-sm" aria-label="削除済み投稿のページ">
		{#if data.page > 1}<a class="px-3 py-2 underline" href="?page={data.page - 1}">前のページ</a>{/if}
		{#if data.hasNext}<a class="px-3 py-2 underline" href="?page={data.page + 1}">次のページ</a>{/if}
	</nav>
{/if}
