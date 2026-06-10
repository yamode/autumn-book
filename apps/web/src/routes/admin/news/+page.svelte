<script lang="ts">
	import { enhance } from '$app/forms';
	import MarkdownView from '$lib/components/MarkdownView.svelte';

	let { data, form } = $props();
</script>

<svelte:head><title>お知らせ管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">お知らせ — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">施設HPの「お知らせ」に表示されます（WP のニュース機能の置き換え）。本文は Markdown 可。</p>

{#if form?.added}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">追加しました（下書き状態。公開チェックを入れて保存すると表示されます）。</p>{/if}
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

<!-- 新規作成 -->
<form method="POST" action="?/add" use:enhance class="mb-6 rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm">
	<input type="hidden" name="facilityId" value={data.currentFacility.id} />
	<h2 class="font-medium text-stone-700">＋ 新しいお知らせ</h2>
	<div class="mt-2 flex flex-wrap gap-2">
		<input type="date" name="publishedAt" class="rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
		<input name="title" placeholder="タイトル" class="min-w-64 flex-1 rounded-md border border-stone-300 px-3 py-1.5" />
	</div>
	<textarea name="body" rows="3" placeholder="本文（Markdown 可）" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5"></textarea>
	<button type="submit" class="mt-2 rounded-md bg-accent-600 px-4 py-1.5 text-xs text-white hover:bg-accent-500">追加（下書きで作成）</button>
</form>

<!-- 一覧・編集 -->
<div class="space-y-3">
	{#each data.posts as post}
		<details class="rounded-xl border border-stone-200 bg-white">
			<summary class="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-sm">
				<span class="rounded-full px-2 py-0.5 text-xs font-medium {post.isPublished ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}">
					{post.isPublished ? '公開中' : '下書き'}
				</span>
				<time class="tabular-nums text-stone-400">{post.publishedAt}</time>
				<span class="font-medium">{post.title}</span>
				{#if form?.saved === post.id}<span class="text-xs text-emerald-600">✔ 保存済み</span>{/if}
			</summary>
			<form method="POST" action="?/save" use:enhance class="space-y-2 border-t border-stone-100 p-4 text-sm">
				<input type="hidden" name="postId" value={post.id} />
				<div class="flex flex-wrap gap-2">
					<input type="date" name="publishedAt" value={post.publishedAt} class="rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
					<input name="title" value={post.title} class="min-w-64 flex-1 rounded-md border border-stone-300 px-3 py-1.5" />
					<label class="flex items-center gap-1.5 text-xs">
						<input type="checkbox" name="isPublished" checked={post.isPublished} class="h-4 w-4" /> 公開
					</label>
				</div>
				<div class="grid gap-3 lg:grid-cols-2">
					<textarea name="body" rows="6" class="w-full rounded-md border border-stone-300 px-3 py-1.5 font-mono text-xs">{post.body}</textarea>
					<div class="rounded-md bg-stone-50 p-3 text-sm">
						<MarkdownView source={post.body} />
					</div>
				</div>
				<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
			</form>
		</details>
	{:else}
		<p class="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-400">お知らせはまだありません</p>
	{/each}
</div>
