<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	// FAQ ごとの翻訳展開状態と選択ロケール
	let expandedTrFaq = $state<string | null>(null);
	let trLocaleByFaq = $state<Record<string, 'en' | 'zh-TW'>>({});
	function trLocale(faqId: string): 'en' | 'zh-TW' {
		return trLocaleByFaq[faqId] ?? 'en';
	}
</script>

<svelte:head><title>FAQ管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">FAQ管理 — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">公開中の FAQ は施設ページに表示され、チャットボット（P9）の知識源にもなります。回答は Markdown 可。</p>

{#if form?.added}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">追加しました（下書き状態）。</p>{/if}
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

<div class="space-y-3">
	{#each data.faqs as q}
		<div class="rounded-xl border border-stone-200 bg-white">
			<form method="POST" action="?/save" use:enhance class="p-4 text-sm">
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
				<div class="mt-2 flex items-center gap-2">
					<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
					<button
						type="button"
						onclick={() => { expandedTrFaq = expandedTrFaq === q.id ? null : q.id; }}
						class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-500 hover:bg-stone-50"
					>{expandedTrFaq === q.id ? '翻訳を閉じる ▲' : '翻訳 ▼'}</button>
				</div>
			</form>

			{#if expandedTrFaq === q.id}
				<div class="border-t border-stone-100 px-4 pb-4 pt-3">
					<div class="mb-3 flex gap-2">
						{#each (['en', 'zh-TW'] as const) as loc}
							<button
								type="button"
								onclick={() => { trLocaleByFaq = { ...trLocaleByFaq, [q.id]: loc }; }}
								class="rounded-md px-3 py-1 text-xs font-medium transition-colors {trLocale(q.id) === loc ? 'bg-brand-800 text-white' : 'border border-stone-300 bg-white text-stone-500 hover:bg-stone-50'}"
							>{loc === 'en' ? 'English (en)' : '繁體中文 (zh-TW)'}</button>
						{/each}
					</div>

					{#if form?.translationSaved === q.id}<p class="mb-2 rounded bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">翻訳を保存しました。</p>{/if}

					<form method="POST" action="?/saveTranslation" use:enhance class="grid gap-3 lg:grid-cols-2">
						<input type="hidden" name="faqId" value={q.id} />
						<input type="hidden" name="locale" value={trLocale(q.id)} />

						<div class="space-y-2 text-xs text-stone-500">
							<p class="font-medium">日本語（参照）</p>
							<p><span class="text-stone-400">カテゴリ：</span>{q.category}</p>
							<p><span class="text-stone-400">質問：</span>{q.question}</p>
							<p><span class="text-stone-400">回答：</span>{q.answer}</p>
						</div>
						<div class="space-y-2 text-xs">
							<p class="font-medium text-stone-500">{trLocale(q.id) === 'en' ? 'English' : '繁體中文'}（翻訳入力）</p>
							<input
								name="category"
								value={data.faqTranslations[q.id]?.[trLocale(q.id)]?.fields?.category ?? ''}
								placeholder="Category"
								class="w-full rounded-md border border-stone-300 px-2 py-1.5"
							/>
							<input
								name="question"
								value={data.faqTranslations[q.id]?.[trLocale(q.id)]?.fields?.question ?? ''}
								placeholder="Question"
								class="w-full rounded-md border border-stone-300 px-2 py-1.5"
							/>
							<textarea
								name="answer"
								rows="3"
								class="w-full rounded-md border border-stone-300 px-2 py-1.5"
								placeholder="Answer (Markdown OK)"
							>{data.faqTranslations[q.id]?.[trLocale(q.id)]?.fields?.answer ?? ''}</textarea>
							<div class="flex items-center gap-3">
								<label class="flex items-center gap-1.5">
									<input type="checkbox" name="isPublished" checked={data.faqTranslations[q.id]?.[trLocale(q.id)]?.isPublished ?? false} class="h-4 w-4" />
									<span>公開</span>
								</label>
								<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-white hover:bg-brand-700">翻訳を保存</button>
							</div>
						</div>
					</form>
				</div>
			{/if}
		</div>
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
