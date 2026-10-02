<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	let { data, form } = $props();

	// タブ（FAQ / 未回答の質問）。URL の ?tab=queries で開ける
	let tab = $state<'faqs' | 'queries'>(page.url.searchParams.get('tab') === 'queries' ? 'queries' : 'faqs');

	// FAQ ごとの翻訳展開状態と選択ロケール
	let expandedTrFaq = $state<string | null>(null);
	let trLocaleByFaq = $state<Record<string, 'en' | 'zh-TW'>>({});
	function trLocale(faqId: string): 'en' | 'zh-TW' {
		return trLocaleByFaq[faqId] ?? 'en';
	}

	// 未回答の質問: 「回答を作成」で開くフォームと、「既存FAQに紐付け」の選択
	let creatingFor = $state<string | null>(null);
	let linkFaqId = $state<Record<string, string>>({});

	const sourceLabel: Record<string, string> = {
		manual: '手動',
		seed_talkappi: 'talkappi',
		seed_tripla: 'tripla',
		seed_hp: '旧HP',
		from_query: '未回答から'
	};
	function fmt(iso: string) {
		const d = new Date(iso);
		return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}
</script>

<svelte:head><title>FAQ ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">FAQ — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">
	公開中の FAQ は施設HPの「よくある質問」ボタン（FAQ ボット）と施設ページに表示されます。回答は Markdown 可。
	言い換え（別の聞き方）を登録すると、検索で当たりやすくなります。
</p>

{#if form?.added}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">追加しました。</p>{/if}
{#if form?.linked}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">既存の FAQ に紐付けました（質問文を言い換えに追加）。</p>{/if}
{#if form?.ignored}<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">対象外にしました。</p>{/if}
{#if form?.imported}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">初期データを取り込みました（下書き {form.imported.added} 件・重複のため {form.imported.skipped} 件はスキップ）。内容を確認して公開してください。</p>{/if}
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

{#if data.real && data.stats}
	<div class="mb-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
		<div class="rounded-lg border border-stone-200 bg-white p-2"><div class="text-xs text-stone-400">質問数（30日）</div><div class="text-lg font-bold">{data.stats.total}</div></div>
		<div class="rounded-lg border border-stone-200 bg-white p-2"><div class="text-xs text-stone-400">回答率</div><div class="text-lg font-bold">{data.stats.answeredRate ?? '—'}{data.stats.answeredRate !== null ? '%' : ''}</div></div>
		<div class="rounded-lg border border-stone-200 bg-white p-2"><div class="text-xs text-stone-400">「解決した」率</div><div class="text-lg font-bold">{data.stats.helpfulRate ?? '—'}{data.stats.helpfulRate !== null ? '%' : ''}</div></div>
		<div class="rounded-lg border border-stone-200 bg-white p-2"><div class="text-xs text-stone-400">未対応</div><div class="text-lg font-bold {data.stats.open ? 'text-accent-600' : ''}">{data.stats.open}</div></div>
	</div>
{/if}

<div class="mb-4 flex gap-2 border-b border-stone-200">
	<button type="button" onclick={() => (tab = 'faqs')} class="-mb-px border-b-2 px-3 py-2 text-sm {tab === 'faqs' ? 'border-brand-800 font-bold text-brand-800' : 'border-transparent text-stone-500'}">FAQ（{data.faqs.length}）</button>
	{#if data.real}
		<button type="button" onclick={() => (tab = 'queries')} class="-mb-px border-b-2 px-3 py-2 text-sm {tab === 'queries' ? 'border-brand-800 font-bold text-brand-800' : 'border-transparent text-stone-500'}">未回答の質問（{data.groups.length}）</button>
	{/if}
</div>

{#if tab === 'faqs'}
	{#if data.real && data.seeds.length > 0}
		<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
			<p class="font-medium text-amber-900">初期データの取り込み</p>
			<p class="mb-2 text-xs text-amber-800">現行サイト・旧ボットから取り出した Q&A を<b>下書き</b>で登録します。同じ質問が既にあるものは飛ばします。</p>
			{#each data.seeds as s}
				<form method="POST" action="?/importSeed" use:enhance class="inline">
					<input type="hidden" name="facilityId" value={data.currentFacility.id} />
					<input type="hidden" name="index" value={s.index} />
					<button type="submit" class="mr-2 mt-1 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-900 hover:bg-amber-100">{s.label} を取り込む</button>
				</form>
			{/each}
		</div>
	{/if}

	{#if data.real}
		<form method="GET" class="mb-4 flex gap-2 text-sm">
			<input name="test" value={data.testQuery} placeholder="検索テスト（例: 駐車場ある？）" class="flex-1 rounded-md border border-stone-300 px-3 py-1.5" />
			<button type="submit" class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50">この質問で検索テスト</button>
		</form>
		{#if data.testQuery}
			<div class="mb-4 rounded-lg border border-stone-200 bg-white p-3 text-xs">
				<p class="mb-1 text-stone-500">「{data.testQuery}」の結果（下書きを含む・0.30 以上で回答あり）</p>
				{#each data.testResults as r}
					<p><span class="inline-block w-12 font-mono {r.score >= 0.3 ? 'text-emerald-700' : 'text-stone-400'}">{r.score.toFixed(2)}</span>{r.question}</p>
				{:else}
					<p class="text-stone-400">該当なし（回答なしとして記録される質問です）</p>
				{/each}
			</div>
		{/if}
	{/if}

	<div class="space-y-3">
		{#each data.faqs as q (q.id)}
			<div class="rounded-xl border border-stone-200 bg-white">
				<form method="POST" action="?/save" use:enhance class="p-4 text-sm">
					<input type="hidden" name="facilityId" value={data.currentFacility.id} />
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
					{#if data.real}
						<textarea name="keywords" rows="1" placeholder="言い換え（改行・読点区切り。例: 何時から入れますか、到着時間）" class="mt-1 w-full rounded-md border border-stone-200 px-3 py-1.5 text-xs">{q.keywords.join('、')}</textarea>
					{/if}
					<div class="mt-2 flex flex-wrap items-center gap-2">
						<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
						<button
							type="button"
							onclick={() => { expandedTrFaq = expandedTrFaq === q.id ? null : q.id; }}
							class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-500 hover:bg-stone-50"
						>{expandedTrFaq === q.id ? '翻訳を閉じる ▲' : '翻訳 ▼'}</button>
						{#if data.real}
							<label class="ml-auto flex items-center gap-1 text-xs text-stone-400">並び順 <input name="sortOrder" type="number" value={q.sortOrder} class="w-16 rounded border border-stone-200 px-1 py-0.5" /></label>
							<span class="text-xs text-stone-400">{sourceLabel[q.source] ?? q.source}・表示 {q.viewCount} 回</span>
						{/if}
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
							<input type="hidden" name="facilityId" value={data.currentFacility.id} />
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
								<input name="category" value={data.faqTranslations[q.id]?.[trLocale(q.id)]?.fields?.category ?? ''} placeholder="Category" class="w-full rounded-md border border-stone-300 px-2 py-1.5" />
								<input name="question" value={data.faqTranslations[q.id]?.[trLocale(q.id)]?.fields?.question ?? ''} placeholder="Question" class="w-full rounded-md border border-stone-300 px-2 py-1.5" />
								<textarea name="answer" rows="3" class="w-full rounded-md border border-stone-300 px-2 py-1.5" placeholder="Answer (Markdown OK)">{data.faqTranslations[q.id]?.[trLocale(q.id)]?.fields?.answer ?? ''}</textarea>
								{#if data.real}
									<textarea name="keywords" rows="1" class="w-full rounded-md border border-stone-200 px-2 py-1.5" placeholder="Other ways to ask (comma separated)">{((data.faqTranslations[q.id]?.[trLocale(q.id)]?.fields?.keywords ?? []) as string[]).join(', ')}</textarea>
								{/if}
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
		{#if data.real}
			<textarea name="keywords" rows="1" placeholder="言い換え（改行・読点区切り）" class="mt-1 w-full rounded-md border border-stone-200 px-3 py-1.5 text-xs"></textarea>
		{/if}
		<button type="submit" class="mt-2 rounded-md bg-accent-600 px-4 py-1.5 text-xs text-white hover:bg-accent-500">追加（下書きで作成）</button>
	</form>
{:else}
	<p class="mb-3 text-xs text-stone-500">
		FAQ ボットで「回答が見つからなかった」「解決しなかった」質問を、同じ内容ごとにまとめて件数の多い順に表示しています（直近90日・未対応のみ）。
	</p>
	<div class="space-y-3">
		{#each data.groups as g (g.ids[0])}
			<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<div class="flex flex-wrap items-center gap-2">
					<span class="rounded bg-stone-800 px-2 py-0.5 text-xs text-white">{g.count} 件</span>
					<span class="font-medium">{g.sample}</span>
					<span class="rounded px-1.5 py-0.5 text-xs {g.reason === 'unanswered' ? 'bg-amber-100 text-amber-800' : 'bg-red-50 text-red-700'}">{g.reason === 'unanswered' ? '回答なし' : '解決しなかった'}</span>
					{#if g.locale !== 'ja'}<span class="rounded bg-sky-50 px-1.5 py-0.5 text-xs text-sky-700">{g.locale}</span>{/if}
					<span class="ml-auto text-xs text-stone-400">最終 {fmt(g.lastAt)}{g.pages.length ? `・${g.pages.join(' ')}` : ''}</span>
				</div>
				<div class="mt-3 flex flex-wrap items-center gap-2">
					<button type="button" onclick={() => (creatingFor = creatingFor === g.ids[0] ? null : g.ids[0])} class="rounded-md bg-brand-800 px-3 py-1.5 text-xs text-white hover:bg-brand-700">回答を作成</button>

					<form method="POST" action="?/linkQuery" use:enhance class="flex items-center gap-1">
						<input type="hidden" name="facilityId" value={data.currentFacility.id} />
						<input type="hidden" name="queryIds" value={g.ids.join(',')} />
						<input type="hidden" name="phrase" value={g.sample} />
						<select name="faqId" bind:value={linkFaqId[g.ids[0]]} class="max-w-56 rounded-md border border-stone-300 px-2 py-1.5 text-xs">
							<option value="">既存の FAQ を選ぶ…</option>
							{#each data.faqs as f}<option value={f.id}>{f.question}</option>{/each}
						</select>
						<button type="submit" disabled={!linkFaqId[g.ids[0]]} class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-40">に紐付け</button>
					</form>

					<form method="POST" action="?/ignoreQuery" use:enhance>
						<input type="hidden" name="facilityId" value={data.currentFacility.id} />
						<input type="hidden" name="queryIds" value={g.ids.join(',')} />
						<button type="submit" class="rounded-md px-3 py-1.5 text-xs text-stone-400 hover:bg-stone-50">対象外</button>
					</form>
				</div>

				{#if creatingFor === g.ids[0]}
					<form method="POST" action="?/add" use:enhance class="mt-3 rounded-lg border border-dashed border-stone-300 p-3">
						<input type="hidden" name="facilityId" value={data.currentFacility.id} />
						<input type="hidden" name="queryIds" value={g.ids.join(',')} />
						<div class="flex flex-wrap gap-2">
							<input name="category" placeholder="カテゴリ" class="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
							<input name="question" value={g.sample} class="min-w-48 flex-1 rounded-md border border-stone-300 px-3 py-1.5" />
						</div>
						<textarea name="answer" rows="3" placeholder="回答（Markdown 可）" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5"></textarea>
						<label class="mt-1 flex items-center gap-1.5 text-xs"><input type="checkbox" name="isPublished" class="h-4 w-4" /> すぐに公開する</label>
						<button type="submit" class="mt-2 rounded-md bg-accent-600 px-4 py-1.5 text-xs text-white hover:bg-accent-500">FAQ を作成（{g.count} 件の質問を対応済みにする）</button>
					</form>
				{/if}
			</div>
		{:else}
			<p class="rounded-lg bg-stone-50 p-4 text-sm text-stone-500">未対応の質問はありません。</p>
		{/each}
	</div>
{/if}
