<script lang="ts">
	// 写真の権利・原本の場所（docs/facility-knowledge.md 段階6）。写真を選んでまとめて入れるか、1枚ずつ開いて入れる。
	// 「取材に出せる」は DB の book.photo_press_ok と同じ条件（権利が分かる・取材広報を許す・人の写り込みを確かめて許可あり）。
	import { enhance } from '$lib/enhance';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import {
		PHOTO_PEOPLE_LABEL,
		PHOTO_RIGHTS,
		PHOTO_RIGHTS_LABEL,
		PHOTO_STATUS_LABEL,
		PHOTO_USAGES,
		PHOTO_USAGE_LABEL,
		SEASON_LABEL,
		photoStatus,
		type PhotoPeople,
		type PhotoStatus,
		type Season
	} from '$lib/facility-knowledge';

	let { data, form } = $props();

	type Filter = 'all' | PhotoStatus;
	let filter = $state<Filter>('unchecked');
	let query = $state('');
	let selected = $state<string[]>([]);
	let editing = $state<string | null>(null);
	let dialog = $state<HTMLDialogElement>();

	const seasons = Object.keys(SEASON_LABEL) as Season[];
	const peopleKeys = Object.keys(PHOTO_PEOPLE_LABEL) as PhotoPeople[];
	const photos = $derived(data.photos.map((p) => ({ ...p, status: photoStatus(p) })));
	const counts = $derived({
		all: photos.length,
		unchecked: photos.filter((p) => p.status === 'unchecked').length,
		checked: photos.filter((p) => p.status === 'checked').length,
		press_ok: photos.filter((p) => p.status === 'press_ok').length
	});
	const shown = $derived(
		photos.filter(
			(p) =>
				(filter === 'all' || p.status === filter) &&
				(!query.trim() || [p.caption, p.photographer, p.originalPath, ...p.usedIn].some((t) => t.includes(query.trim())))
		)
	);
	const current = $derived(photos.find((p) => p.url === editing) ?? null);
	const allShownSelected = $derived(shown.length > 0 && shown.every((p) => selected.includes(p.url)));

	const statusClass: Record<PhotoStatus, string> = {
		press_ok: 'bg-emerald-50 text-emerald-800 border-emerald-200',
		checked: 'bg-sky-50 text-sky-800 border-sky-200',
		unchecked: 'bg-amber-50 text-amber-900 border-amber-200'
	};

	function toggle(url: string) {
		selected = selected.includes(url) ? selected.filter((u) => u !== url) : [...selected, url];
	}
	function toggleShown() {
		const urls = shown.map((p) => p.url);
		selected = allShownSelected ? selected.filter((u) => !urls.includes(u)) : [...new Set([...selected, ...urls])];
	}
	function open(url: string) {
		editing = url;
		dialog?.showModal();
	}
	function peopleOf(p: { hasPeople: boolean | null; peopleConsent: boolean | null }): PhotoPeople {
		if (p.hasPeople === null) return 'unchecked';
		if (p.hasPeople === false) return 'none';
		return p.peopleConsent ? 'consented' : 'no_consent';
	}
	const afterSave = (close: () => void) => () => async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
		await update();
		if (result.type === 'success') close();
	};
</script>

<PageHeader
	title="写真の権利"
	facility={data.currentFacility.name}
	description="プラン・部屋・お知らせで使っている写真ごとに、撮影者・使える範囲・人の写り込み・Dropbox の原本の場所を記録します。取材の回答に出す写真は「取材に出せる」になったものだけです。"
>
	{#snippet actions()}<a href="/admin/knowledge" class="rounded-lg border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">← 施設ナレッジ</a>{/snippet}
</PageHeader>

{#if data.unavailable}
	<p class="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">{data.unavailable}</p>
{:else if data.loadError}
	<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.loadError}</p>
{:else}
	{#if form?.done}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{form.done}</p>{/if}
	{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

	<div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
		{#each [['unchecked', '未確認'], ['checked', '確認済み（取材は不可）'], ['press_ok', '取材に出せる'], ['all', 'すべて']] as [key, label] (key)}
			<button type="button" onclick={() => (filter = key as Filter)} class="rounded-full border px-3 py-1 {filter === key ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}">
				{label} <span class="opacity-75">{counts[key as Filter]}</span>
			</button>
		{/each}
		<input type="search" bind:value={query} placeholder="使っている場所・撮影者・原本の場所で絞る" class="ml-auto w-full rounded-lg border border-stone-300 px-3 py-1.5 sm:w-72" />
	</div>

	<div class="mb-3 flex flex-wrap items-center gap-3 text-sm text-stone-600">
		<button type="button" onclick={toggleShown} disabled={!shown.length} class="rounded-lg border border-stone-300 bg-white px-3 py-1.5 hover:bg-stone-50 disabled:opacity-50">
			{allShownSelected ? '表示中の選択を外す' : `表示中の${shown.length}枚を選ぶ`}
		</button>
		{#if selected.length}<span>{selected.length}枚を選択中</span><button type="button" class="text-stone-500 underline" onclick={() => (selected = [])}>選択を外す</button>{/if}
	</div>

	{#if selected.length}
		<!-- まとめて入れる。「変えない」の欄は今の値のまま -->
		<form method="POST" action="?/save" use:enhance={afterSave(() => (selected = []))} class="sticky top-2 z-10 mb-4 space-y-3 rounded-xl border border-brand-200 bg-white p-4 text-sm shadow-sm">
			<input type="hidden" name="facilityId" value={data.currentFacility.id} />
			<input type="hidden" name="usageMode" value="each" />
			<input type="hidden" name="photographerKeep" value="1" />
			<input type="hidden" name="noteKeep" value="1" />
			{#each selected as url (url)}<input type="hidden" name="url" value={url} />{/each}
			<p class="font-medium text-stone-800">選んだ{selected.length}枚にまとめて入れる <span class="font-normal text-stone-500">（「変えない」・空欄の項目は今のまま）</span></p>
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<label class="block">権利
					<select name="rights" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5"><option value="keep">変えない</option>{#each PHOTO_RIGHTS as r (r)}<option value={r}>{PHOTO_RIGHTS_LABEL[r]}</option>{/each}</select>
				</label>
				<label class="block">人の写り込み
					<select name="people" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5"><option value="keep">変えない</option>{#each peopleKeys as k (k)}<option value={k}>{PHOTO_PEOPLE_LABEL[k]}</option>{/each}</select>
				</label>
				<label class="block">季節
					<select name="season" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5"><option value="keep">変えない</option><option value="">季節を問わない</option>{#each seasons as s (s)}<option value={s}>{SEASON_LABEL[s]}</option>{/each}</select>
				</label>
				<label class="block">撮影者
					<input name="photographer" maxlength="100" placeholder="空欄なら変えない" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5" />
				</label>
			</div>
			<div class="flex flex-wrap gap-x-5 gap-y-2">
				<span class="text-stone-600">使える範囲</span>
				{#each PHOTO_USAGES as u (u)}
					<label class="flex items-center gap-1">{PHOTO_USAGE_LABEL[u]}
						<select name={`usage_${u}`} class="rounded-lg border border-stone-300 px-1.5 py-1"><option value="keep">変えない</option><option value="allow">使える</option><option value="deny">使えない</option></select>
					</label>
				{/each}
			</div>
			<label class="block">メモ<input name="note" maxlength="500" placeholder="空欄なら変えない" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5" /></label>
			<div class="flex justify-end"><button class="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">{selected.length}枚に保存</button></div>
		</form>
	{/if}

	{#if !shown.length}
		<p class="rounded-lg bg-stone-50 px-3 py-6 text-center text-sm text-stone-500">{photos.length ? 'この条件の写真はありません。' : 'プラン・部屋・お知らせに写真がまだありません。'}</p>
	{:else}
		<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
			{#each shown as p (p.url)}
				<li class="overflow-hidden rounded-xl border bg-white {selected.includes(p.url) ? 'border-brand-500 ring-2 ring-brand-300' : 'border-stone-200'}">
					<div class="relative">
						<button type="button" class="block w-full" onclick={() => open(p.url)} aria-label="この写真の権利を開く">
							<img src={p.url} alt={p.caption} loading="lazy" decoding="async" class="aspect-[4/3] w-full bg-stone-100 object-cover" />
						</button>
						<label class="absolute left-1.5 top-1.5 rounded bg-white/90 p-1 shadow-sm"><input type="checkbox" checked={selected.includes(p.url)} onchange={() => toggle(p.url)} aria-label="選ぶ" /></label>
					</div>
					<div class="space-y-1 p-2 text-xs">
						<span class="inline-block rounded-full border px-2 py-0.5 {statusClass[p.status]}">{PHOTO_STATUS_LABEL[p.status]}</span>
						<p class="line-clamp-2 text-stone-600" title={p.usedIn.join('\n')}>{p.usedIn[0]}{#if p.usedIn.length > 1}<span class="text-stone-400"> ほか{p.usedIn.length - 1}か所</span>{/if}</p>
						{#if !p.unsaved}<p class="text-stone-500">{PHOTO_RIGHTS_LABEL[p.rights]}{#if p.photographer}・{p.photographer}{/if}</p>{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}

	<dialog bind:this={dialog} onclose={() => (editing = null)} class="w-[min(40rem,calc(100vw-2rem))] rounded-2xl p-0 backdrop:bg-black/40">
		{#if current}
			<form method="POST" action="?/save" use:enhance={afterSave(() => dialog?.close())} class="space-y-3 p-5 text-sm">
				<input type="hidden" name="facilityId" value={data.currentFacility.id} />
				<input type="hidden" name="url" value={current.url} />
				<input type="hidden" name="usageMode" value="set" />
				<img src={current.url} alt={current.caption} class="max-h-64 w-full rounded-lg bg-stone-100 object-contain" />
				<details class="text-xs text-stone-500"><summary class="cursor-pointer">使っている場所（{current.usedIn.length}か所）</summary><ul class="mt-1 list-disc pl-5">{#each current.usedIn as w (w)}<li>{w}</li>{/each}</ul></details>
				<div class="grid gap-3 sm:grid-cols-2">
					<label class="block">権利
						<select name="rights" value={current.rights} class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5">{#each PHOTO_RIGHTS as r (r)}<option value={r}>{PHOTO_RIGHTS_LABEL[r]}</option>{/each}</select>
					</label>
					<label class="block">撮影者
						<input name="photographer" value={current.photographer} maxlength="100" placeholder="社内の担当者・外部のカメラマン" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5" />
					</label>
					<label class="block">人の写り込み
						<select name="people" value={peopleOf(current)} class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5">{#each peopleKeys as k (k)}<option value={k}>{PHOTO_PEOPLE_LABEL[k]}</option>{/each}</select>
					</label>
					<label class="block">季節
						<select name="season" value={current.season ?? ''} class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5"><option value="">季節を問わない</option>{#each seasons as s (s)}<option value={s}>{SEASON_LABEL[s]}</option>{/each}</select>
					</label>
				</div>
				<fieldset class="flex flex-wrap gap-x-4 gap-y-1"><legend class="mb-1 text-stone-600">使える範囲</legend>
					{#each PHOTO_USAGES as u (u)}<label class="flex items-center gap-1"><input type="checkbox" name="usage" value={u} checked={current.usageScope.includes(u)} />{PHOTO_USAGE_LABEL[u]}</label>{/each}
				</fieldset>
				<label class="block">原本の場所（Dropbox）
					<input name="originalPath" value={current.originalPath} maxlength="500" placeholder="例：/10_広報/写真/2026冬/半露天_雪.jpg" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5 font-mono text-xs" />
				</label>
				<label class="block">メモ<input name="note" value={current.note} maxlength="500" class="mt-1 w-full rounded-lg border border-stone-300 px-2 py-1.5" /></label>
				<div class="flex justify-end gap-2">
					<button type="button" class="rounded-lg border border-stone-300 px-4 py-2 hover:bg-stone-50" onclick={() => dialog?.close()}>閉じる</button>
					<button class="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">保存</button>
				</div>
			</form>
		{/if}
	</dialog>
{/if}
