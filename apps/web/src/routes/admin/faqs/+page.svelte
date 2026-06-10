<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();
</script>

<svelte:head><title>FAQ管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">FAQ管理 — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">公開中の FAQ は施設ページに表示され、チャットボット（P9）の知識源にもなります。回答は Markdown 可。</p>

{#if form?.added}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">追加しました（下書き状態）。</p>{/if}
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

<div class="space-y-3">
	{#each data.faqs as q}
		<form method="POST" action="?/save" use:enhance class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<input type="hidden" name="faqId" value={q.id} />
			<div class="flex flex-wrap items-center gap-2">
				<input name="category" value={q.category} class="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
				<input name="question" value={q.question} class="min-w-48 flex-1 rounded-md border border-stone-300 px-3 py-1.5 font-medium" />
				<label class="flex items-center gap-1.5 text-xs">
					<input type="checkbox" name="isPublished" checked={q.isPublished} class="h-4 w-4" /> 公開
				</label>
				{#if form?.saved === q.id}<span class="text-xs text-emerald-600">✔</span>{/if}
			</div>
			<textarea name="answer" rows="2" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm">{q.answer}</textarea>
			<button type="submit" class="mt-2 rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
		</form>
	{/each}
</div>

<form method="POST" action="?/add" use:enhance class="mt-6 rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm">
	<input type="hidden" name="facilityId" value={data.currentFacility.id} />
	<h2 class="font-medium text-stone-700">＋ 新しい FAQ を追加</h2>
	<div class="mt-2 flex flex-wrap gap-2">
		<input name="category" placeholder="カテゴリ" class="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
		<input name="question" placeholder="質問" class="min-w-48 flex-1 rounded-md border border-stone-300 px-3 py-1.5" />
	</div>
	<textarea name="answer" rows="2" placeholder="回答（Markdown 可）" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5"></textarea>
	<button type="submit" class="mt-2 rounded-md bg-accent-600 px-4 py-1.5 text-xs text-white hover:bg-accent-500">追加（下書きで作成）</button>
</form>
