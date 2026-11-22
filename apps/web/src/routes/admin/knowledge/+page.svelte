<script lang="ts">
	// 施設ナレッジ（docs/facility-knowledge.md 段階2）。事実・魅力の説明・承認できる人の3タブ。
	// 承認済みで期間内のものだけが AI に渡る。内容を直すと承認が外れる（DB のトリガー）。
	import { enhance } from '$lib/enhance';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import {
		FACT_KEYS,
		SEASON_LABEL,
		STATUS_LABEL,
		TOPIC_LABEL,
		VISIBILITY_HINT,
		VISIBILITY_LABEL,
		factLabel,
		knowledgeStatus,
		tokyoToday,
		type KnowledgeStatus,
		type Season,
		type StoryTopic,
		type Visibility
	} from '$lib/facility-knowledge';

	let { data, form } = $props();

	type Tab = 'facts' | 'stories' | 'approvers';
	const initialTab = page.url.searchParams.get('tab');
	let tab = $state<Tab>(initialTab === 'stories' || initialTab === 'approvers' ? initialTab : 'facts');
	let filter = $state<'all' | KnowledgeStatus>('all');
	let addingFact = $state(false);
	let addingStory = $state(false);

	const today = tokyoToday();
	const visibilities = Object.keys(VISIBILITY_LABEL) as Visibility[];
	const seasons = Object.keys(SEASON_LABEL) as Season[];
	const topics = Object.keys(TOPIC_LABEL) as StoryTopic[];
	const factGroups = [...new Set(FACT_KEYS.map((k) => k.group))];

	const facts = $derived(data.facts.map((f) => ({ ...f, status: knowledgeStatus(f, today) })));
	const stories = $derived(data.stories.map((s) => ({ ...s, status: knowledgeStatus(s, today) })));
	const shownFacts = $derived(filter === 'all' ? facts : facts.filter((f) => f.status === filter));
	const shownStories = $derived(filter === 'all' ? stories : stories.filter((s) => s.status === filter));
	const unverifiedCount = $derived([...facts, ...stories].filter((i) => i.status === 'unverified').length);

	const statusClass: Record<KnowledgeStatus, string> = {
		verified: 'bg-emerald-50 text-emerald-800 border-emerald-200',
		unverified: 'bg-amber-50 text-amber-900 border-amber-200',
		expired: 'bg-stone-100 text-stone-500 border-stone-200',
		upcoming: 'bg-sky-50 text-sky-800 border-sky-200'
	};
	const visClass: Record<Visibility, string> = {
		public: 'text-emerald-700',
		press: 'text-indigo-700',
		internal: 'text-stone-500'
	};
	function fmtDate(iso: string | null) {
		if (!iso) return '';
		const d = new Date(iso);
		return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
	}
	function periodText(from: string | null, until: string | null) {
		if (!from && !until) return '';
		return `${from ?? ''}〜${until ?? ''}`;
	}
	function confirmRemove(e: SubmitEvent) {
		if (!confirm('削除します。元に戻せません。よろしいですか？')) e.preventDefault();
	}
</script>

<svelte:head><title>施設ナレッジ ｜ 山人管理</title></svelte:head>

<PageHeader
	title="施設ナレッジ"
	facility={data.currentFacility.name}
	description="取材の回答・プレスリリース・お問い合わせの AI 下書きが使う「確かめ済みの施設情報」です。承認済みで期間内のものだけを AI が使います。内容を直すと承認は外れます。料金・空室・客室数はプランと PMS から引くので、ここには登録しません。"
>
	{#snippet actions()}<a href="/admin/knowledge/photos" class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">写真の権利 →</a>{/snippet}
</PageHeader>

{#if data.unavailable}
	<p class="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">{data.unavailable}</p>
{:else}
	{#if form?.done}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{form.done}</p>{/if}
	{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}
	{#if data.loadError}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.loadError}</p>{/if}

	{#if !data.canApprove}
		<p class="mb-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">
			入力はできますが、承認できるのは施設の管理者と、「承認できる人」に登録された人だけです。
		</p>
	{/if}

	{#if data.seeds.length > 0}
		<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
			<p class="font-medium text-amber-900">初期データの取り込み</p>
			<p class="mb-2 text-xs text-amber-800">取材の回答などから取り出した内容を<b>未承認</b>で登録します。同じ項目・同じ見出しがすでにあるものは飛ばします。</p>
			{#each data.seeds as s (s.index)}
				<form method="POST" action="?/importSeed" use:enhance class="inline">
					<input type="hidden" name="facilityId" value={data.currentFacility.id} />
					<input type="hidden" name="index" value={s.index} />
					<button type="submit" class="mr-2 mt-1 rounded-md border border-amber-300 bg-white px-3 py-2 text-xs text-amber-900 hover:bg-amber-100">
						{s.label}（{s.count}件）を取り込む
					</button>
				</form>
			{/each}
		</div>
	{/if}

	<div class="mb-4 flex gap-2 overflow-x-auto border-b border-stone-200">
		{#each [['facts', `事実（${facts.length}）`], ['stories', `魅力の説明（${stories.length}）`], ['approvers', `承認できる人（${data.approvers.length}）`]] as [key, label] (key)}
			<button
				type="button"
				onclick={() => (tab = key as Tab)}
				class="-mb-px shrink-0 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap {tab === key ? 'border-brand-800 font-bold text-brand-800' : 'border-transparent text-stone-500'}"
			>{label}</button>
		{/each}
	</div>

	{#if tab !== 'approvers'}
		<div class="mb-3 flex flex-wrap items-center gap-2 text-xs">
			<span class="text-stone-500">表示：</span>
			{#each [['all', 'すべて'], ['unverified', '未承認'], ['verified', '承認済み'], ['upcoming', '期間前'], ['expired', '期限切れ']] as [key, label] (key)}
				<button
					type="button"
					onclick={() => (filter = key as typeof filter)}
					class="rounded-full border px-2.5 py-1 {filter === key ? 'border-brand-800 bg-brand-800 text-white' : 'border-stone-300 text-stone-600 hover:bg-stone-50'}"
				>{label}</button>
			{/each}
			{#if unverifiedCount}<span class="ml-auto text-amber-800">未承認 {unverifiedCount}件</span>{/if}
		</div>
	{/if}

	<!-- 公開範囲・期間・出所（事実・説明で共通の入力欄） -->
	{#snippet commonFields(v: { visibility: Visibility; validFrom: string | null; validUntil: string | null; sourceNote: string })}
		<div class="grid gap-2 sm:grid-cols-3">
			<label class="block text-xs text-stone-500">公開範囲
				<select name="visibility" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900">
					{#each visibilities as vis (vis)}<option value={vis} selected={v.visibility === vis}>{VISIBILITY_LABEL[vis]}</option>{/each}
				</select>
			</label>
			<label class="block text-xs text-stone-500">期間の開始（空なら通年）
				<input type="date" name="validFrom" value={v.validFrom ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900" />
			</label>
			<label class="block text-xs text-stone-500">期間の終了
				<input type="date" name="validUntil" value={v.validUntil ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900" />
			</label>
		</div>
		<p class="text-[11px] text-stone-400">お客様向け：{VISIBILITY_HINT.public}／取材・広報まで：{VISIBILITY_HINT.press}／社内のみ：{VISIBILITY_HINT.internal}</p>
		<label class="block text-xs text-stone-500">出所・メモ（どこで確かめたか）
			<input name="sourceNote" value={v.sourceNote} maxlength="500" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900" />
		</label>
	{/snippet}

	<!-- 状態・承認・削除（事実・説明で共通） -->
	{#snippet itemActions(kind: 'fact' | 'story', item: { id: string; status: KnowledgeStatus; verifiedAt: string | null; verifiedBy: string | null })}
		<div class="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2 text-xs">
			{#if item.verifiedAt}
				<span class="text-stone-500">承認：{data.names[item.verifiedBy ?? ''] ?? '—'}（{fmtDate(item.verifiedAt)}）</span>
			{/if}
			{#if data.canApprove}
				<form method="POST" action={item.verifiedAt ? '?/unverify' : '?/verify'} use:enhance class="ml-auto">
					<input type="hidden" name="facilityId" value={data.currentFacility.id} />
					<input type="hidden" name="kind" value={kind} />
					<input type="hidden" name="id" value={item.id} />
					{#if item.verifiedAt}
						<button type="submit" class="rounded-md border border-stone-300 px-3 py-1.5 text-stone-600 hover:bg-stone-50">承認を外す</button>
					{:else}
						<button type="submit" class="rounded-md bg-emerald-700 px-3 py-1.5 font-medium text-white hover:bg-emerald-800">内容を確かめて承認</button>
					{/if}
				</form>
				<form method="POST" action="?/remove" use:enhance onsubmit={confirmRemove}>
					<input type="hidden" name="facilityId" value={data.currentFacility.id} />
					<input type="hidden" name="kind" value={kind} />
					<input type="hidden" name="id" value={item.id} />
					<button type="submit" class="rounded-md px-2 py-1.5 text-red-600 hover:bg-red-50">削除</button>
				</form>
			{/if}
		</div>
	{/snippet}

	{#snippet badges(status: KnowledgeStatus, visibility: Visibility, period: string)}
		<span class="shrink-0 rounded-full border px-2 py-0.5 text-[11px] {statusClass[status]}">{STATUS_LABEL[status]}</span>
		<span class="shrink-0 text-[11px] {visClass[visibility]}">{VISIBILITY_LABEL[visibility]}</span>
		{#if period}<span class="shrink-0 text-[11px] text-stone-400">{period}</span>{/if}
	{/snippet}

	{#if tab === 'facts'}
		<datalist id="fact-keys">
			{#each FACT_KEYS as k (k.key)}<option value={k.key}>{k.group}：{k.label}</option>{/each}
		</datalist>

		{#if addingFact}
			<form method="POST" action="?/addFact" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') addingFact = false; }} class="mb-4 space-y-3 rounded-xl border border-brand-200 bg-white p-4 text-sm">
				<input type="hidden" name="facilityId" value={data.currentFacility.id} />
				<p class="font-medium">事実を追加</p>
				<label class="block text-xs text-stone-500">項目（一覧から選ぶか、英小文字のキーを入力）
					<select name="keyPreset" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900">
						<option value="">（一覧に無い項目を入力する）</option>
						{#each factGroups as g (g)}
							<optgroup label={g}>
								{#each FACT_KEYS.filter((k) => k.group === g) as k (k.key)}<option value={k.key}>{k.label}</option>{/each}
							</optgroup>
						{/each}
					</select>
				</label>
				<input name="keyCustom" placeholder="一覧に無いときだけ入力（例: access.bus）" class="w-full rounded-md border border-stone-300 px-2 py-1.5 font-mono text-xs" />
				<label class="block text-xs text-stone-500">内容
					<textarea name="value" rows="2" maxlength="2000" required class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900"></textarea>
				</label>
				{@render commonFields({ visibility: 'public', validFrom: null, validUntil: null, sourceNote: '' })}
				<div class="flex gap-2">
					<button type="submit" class="rounded-md bg-brand-800 px-4 py-2 text-xs font-medium text-white">登録（未承認）</button>
					<button type="button" onclick={() => (addingFact = false)} class="rounded-md px-3 py-2 text-xs text-stone-500">やめる</button>
				</div>
			</form>
		{:else}
			<button type="button" onclick={() => (addingFact = true)} class="mb-4 rounded-md border border-stone-300 bg-white px-3 py-2 text-xs hover:bg-stone-50">＋ 事実を追加</button>
		{/if}

		<div class="space-y-2">
			{#each shownFacts as f (f.id)}
				<details class="rounded-xl border border-stone-200 bg-white">
					<summary class="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
						<span class="w-44 shrink-0 text-xs text-stone-500" title={f.key}>{factLabel(f.key)}</span>
						<span class="min-w-0 flex-1 basis-48">{f.value}</span>
						{@render badges(f.status, f.visibility, periodText(f.validFrom, f.validUntil))}
					</summary>
					<div class="space-y-3 border-t border-stone-100 px-4 py-3 text-sm">
						<form method="POST" action="?/saveFact" use:enhance class="space-y-3">
							<input type="hidden" name="facilityId" value={data.currentFacility.id} />
							<input type="hidden" name="id" value={f.id} />
							<label class="block text-xs text-stone-500">項目のキー
								<input name="key" value={f.key} list="fact-keys" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 font-mono text-xs text-stone-900" />
							</label>
							<label class="block text-xs text-stone-500">内容
								<textarea name="value" rows="2" maxlength="2000" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900">{f.value}</textarea>
							</label>
							{@render commonFields(f)}
							<button type="submit" class="rounded-md bg-brand-800 px-4 py-2 text-xs font-medium text-white">保存</button>
						</form>
						{@render itemActions('fact', f)}
					</div>
				</details>
			{:else}
				<p class="rounded-lg bg-stone-50 px-3 py-6 text-center text-sm text-stone-500">該当する事実はありません。</p>
			{/each}
		</div>
	{:else if tab === 'stories'}
		{#if addingStory}
			<form method="POST" action="?/addStory" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') addingStory = false; }} class="mb-4 space-y-3 rounded-xl border border-brand-200 bg-white p-4 text-sm">
				<input type="hidden" name="facilityId" value={data.currentFacility.id} />
				<p class="font-medium">魅力の説明を追加</p>
				{@render storyFields({ topic: 'bath', title: '', body: '', seasons: [] })}
				{@render commonFields({ visibility: 'public', validFrom: null, validUntil: null, sourceNote: '' })}
				<div class="flex gap-2">
					<button type="submit" class="rounded-md bg-brand-800 px-4 py-2 text-xs font-medium text-white">登録（未承認）</button>
					<button type="button" onclick={() => (addingStory = false)} class="rounded-md px-3 py-2 text-xs text-stone-500">やめる</button>
				</div>
			</form>
		{:else}
			<button type="button" onclick={() => (addingStory = true)} class="mb-4 rounded-md border border-stone-300 bg-white px-3 py-2 text-xs hover:bg-stone-50">＋ 魅力の説明を追加</button>
		{/if}

		<div class="space-y-2">
			{#each shownStories as s (s.id)}
				<details class="rounded-xl border border-stone-200 bg-white">
					<summary class="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3 text-sm">
						<span class="w-20 shrink-0 text-xs text-stone-500">{TOPIC_LABEL[s.topic]}</span>
						<span class="min-w-0 flex-1 basis-48 font-medium">{s.title}</span>
						{#each s.seasons as se (se)}<span class="shrink-0 rounded bg-sky-50 px-1.5 text-[11px] text-sky-800">{SEASON_LABEL[se]}</span>{/each}
						{@render badges(s.status, s.visibility, periodText(s.validFrom, s.validUntil))}
					</summary>
					<div class="space-y-3 border-t border-stone-100 px-4 py-3 text-sm">
						<form method="POST" action="?/saveStory" use:enhance class="space-y-3">
							<input type="hidden" name="facilityId" value={data.currentFacility.id} />
							<input type="hidden" name="id" value={s.id} />
							{@render storyFields(s)}
							{@render commonFields(s)}
							<button type="submit" class="rounded-md bg-brand-800 px-4 py-2 text-xs font-medium text-white">保存</button>
						</form>
						{@render itemActions('story', s)}
					</div>
				</details>
			{:else}
				<p class="rounded-lg bg-stone-50 px-3 py-6 text-center text-sm text-stone-500">該当する説明はありません。</p>
			{/each}
		</div>
	{:else}
		<p class="mb-3 text-sm text-stone-600">
			施設の管理者は登録しなくても承認できます。ここに登録した人（広報担当など）も承認できるようになります。登録・削除は施設の管理者だけができます。
		</p>
		<div class="mb-4 space-y-2">
			{#each data.approvers as a (a.userId)}
				<div class="flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
					<span class="font-medium">{a.name}</span>
					{#if a.note}<span class="text-xs text-stone-500">{a.note}</span>{/if}
					<span class="text-xs text-stone-400">{fmtDate(a.createdAt)} 登録</span>
					{#if data.isAdmin}
						<form method="POST" action="?/removeApprover" use:enhance class="ml-auto">
							<input type="hidden" name="facilityId" value={data.currentFacility.id} />
							<input type="hidden" name="userId" value={a.userId} />
							<button type="submit" class="rounded-md px-2 py-1.5 text-xs text-red-600 hover:bg-red-50">外す</button>
						</form>
					{/if}
				</div>
			{:else}
				<p class="rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-500">登録された人はいません。</p>
			{/each}
		</div>
		{#if data.isAdmin}
			<form method="POST" action="?/addApprover" use:enhance class="flex flex-wrap items-end gap-2 rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<input type="hidden" name="facilityId" value={data.currentFacility.id} />
				<label class="block min-w-48 flex-1 text-xs text-stone-500">スタッフ
					<select name="userId" required class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900">
						<option value="">選んでください</option>
						{#each data.staffOptions as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
					</select>
				</label>
				<label class="block min-w-40 flex-1 text-xs text-stone-500">メモ（役割など）
					<input name="note" placeholder="広報担当" maxlength="200" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900" />
				</label>
				<button type="submit" class="rounded-md bg-brand-800 px-4 py-2 text-xs font-medium text-white">承認できる人に登録</button>
			</form>
		{/if}
	{/if}
{/if}

<!-- 説明の分類・見出し・本文・季節 -->
{#snippet storyFields(v: { topic: StoryTopic; title: string; body: string; seasons: Season[] })}
	<div class="grid gap-2 sm:grid-cols-4">
		<label class="block text-xs text-stone-500">分類
			<select name="topic" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900">
				{#each topics as t (t)}<option value={t} selected={v.topic === t}>{TOPIC_LABEL[t]}</option>{/each}
			</select>
		</label>
		<label class="block text-xs text-stone-500 sm:col-span-3">見出し
			<input name="title" value={v.title} required maxlength="100" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900" />
		</label>
	</div>
	<label class="block text-xs text-stone-500">本文（事実だけを書く。誇張や「日本一」などの比較は書かない）
		<textarea name="body" rows="4" required maxlength="10000" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm text-stone-900">{v.body}</textarea>
	</label>
	<fieldset class="flex flex-wrap items-center gap-3 text-xs text-stone-600">
		<legend class="mb-1 text-stone-500">季節（空なら通年）</legend>
		{#each seasons as se (se)}
			<label class="inline-flex items-center gap-1"><input type="checkbox" name="seasons" value={se} checked={v.seasons.includes(se)} />{SEASON_LABEL[se]}</label>
		{/each}
	</fieldset>
{/snippet}
