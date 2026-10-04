<script lang="ts">
	import { enhance } from '$app/forms';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';
	import type { InroomBanner } from '$lib/server/inroom-banners';

	let { data, form } = $props();

	const langOptions: { value: string; label: string }[] = [
		{ value: '', label: 'すべての言語' },
		{ value: 'ja', label: '日本語のページだけ' },
		{ value: 'en', label: 'English のページだけ' },
		{ value: 'zh-TW', label: '繁體中文のページだけ' }
	];

	function todayJst(): string {
		return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
	}
	// 一覧の状態（掲載中／非公開／掲載前／掲載終了）
	function status(b: InroomBanner): { label: string; cls: string } {
		const today = todayJst();
		if (!b.isPublished) return { label: '非公開', cls: 'bg-stone-100 text-stone-500' };
		if (b.startDate && b.startDate > today) return { label: '掲載前', cls: 'bg-sky-50 text-sky-700' };
		if (b.endDate && b.endDate < today) return { label: '掲載終了', cls: 'bg-amber-50 text-amber-700' };
		return { label: '掲載中', cls: 'bg-emerald-50 text-emerald-700' };
	}

	// 画像を選んだら保存前にその場で見え方を出す（行ごと）
	let previews = $state<Record<string, string>>({});
	function onPick(key: string, e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0];
		if (previews[key]) URL.revokeObjectURL(previews[key]);
		previews = { ...previews, [key]: f ? URL.createObjectURL(f) : '' };
	}

	const nextSort = $derived(data.banners.length ? Math.max(...data.banners.map((b) => b.sortOrder)) + 10 : 10);
	let adding = $state(false);
</script>

<svelte:head><title>サンクスページのバナー ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-xs"><a href="/admin/inroom" class="text-stone-400 hover:text-stone-600">← 客室案内</a></p>
<h1 class="mb-1 text-lg font-bold text-stone-800">サンクスページのバナー — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">
	チェックアウト後にお客様が客室案内のQRを読んだときの「ご利用ありがとうございました」のページに、販促バナーを並べて出します。
	公開中で掲載期間内のものだけ、並び順の小さい順に表示されます。
</p>

{#if data.loadError}
	<div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">⚠ {data.loadError}</div>
{/if}
{#if !data.live}
	<div class="mb-4 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
		この環境は管理画面が実データに繋がっていません。ここで保存した内容はサーバーを再起動すると消え、画像のアップロードもできません（画像のURLは使えます）。
	</div>
{/if}
{#if form?.message}
	<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}
{#if form?.saved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">バナーを保存しました。</p>{/if}
{#if form?.deleted}<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">削除しました。</p>{/if}

{#snippet fields(b: InroomBanner | null, key: string)}
	<input type="hidden" name="bannerId" value={b?.id ?? ''} />
	<div class="grid gap-4 sm:grid-cols-[220px_1fr]">
		<!-- 画像 -->
		<div>
			{#if previews[key] || b?.imageUrl}
				<img src={previews[key] || b?.imageUrl} alt="" class="w-full rounded-md border border-stone-200 object-cover" />
			{:else}
				<div class="flex aspect-[16/9] w-full items-center justify-center rounded-md border border-dashed border-stone-300 text-xs text-stone-400">画像なし</div>
			{/if}
			<label class="mt-2 block text-xs text-stone-600">
				画像を選ぶ（JPEG・PNG・WebP・AVIF／10MBまで）
				<input type="file" name="photo" accept="image/jpeg,image/png,image/webp,image/avif" onchange={(e) => onPick(key, e)} class="mt-1 block w-full text-xs" />
			</label>
			<label class="mt-2 block text-xs text-stone-600">
				または画像のURL
				<input name="imageUrl" value={b?.imageUrl ?? ''} placeholder="https://" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
			</label>
		</div>

		<!-- 内容 -->
		<div class="space-y-3">
			<label class="block">
				<span class="text-xs text-stone-600">名前（社内用。画像の代替テキストにもなります）</span>
				<input name="title" value={b?.title ?? ''} maxlength="80" required class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
			<label class="block">
				<span class="text-xs text-stone-600">リンク先（任意・https://…。押すと新しいタブで開きます）</span>
				<input type="url" name="linkUrl" value={b?.linkUrl ?? ''} placeholder="https://" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
			<label class="block">
				<span class="text-xs text-stone-600">画像の下に出す一言（任意・200文字まで）</span>
				<textarea name="body" maxlength="200" rows="2" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">{b?.body ?? ''}</textarea>
			</label>
			<div class="flex flex-wrap items-end gap-3">
				<label class="block">
					<span class="text-xs text-stone-600">表示する言語</span>
					<select name="lang" value={b?.lang ?? ''} class="mt-1 block rounded-md border border-stone-300 px-2 py-2">
						{#each langOptions as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</label>
				<label class="block">
					<span class="text-xs text-stone-600">掲載開始日</span>
					<input type="date" name="startDate" value={b?.startDate ?? ''} class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5" />
				</label>
				<label class="block">
					<span class="text-xs text-stone-600">掲載終了日</span>
					<input type="date" name="endDate" value={b?.endDate ?? ''} class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5" />
				</label>
				<label class="block">
					<span class="text-xs text-stone-600">並び順</span>
					<input type="number" name="sortOrder" value={b?.sortOrder ?? nextSort} class="mt-1 block w-20 rounded-md border border-stone-300 px-2 py-1.5" />
				</label>
				<label class="flex items-center gap-2 pb-2">
					<input type="checkbox" name="isPublished" checked={b?.isPublished ?? false} />
					<span class="text-sm text-stone-700">公開する</span>
				</label>
			</div>
			<p class="text-xs text-stone-400">掲載期間は空欄なら無期限です（日付は両端を含みます）。</p>
		</div>
	</div>
{/snippet}

<div class="space-y-4">
	{#each data.banners as b (b.id)}
		{@const st = status(b)}
		<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<div class="mb-3 flex items-center gap-2">
				<span class="rounded px-2 py-0.5 text-xs {st.cls}">{st.label}</span>
				<span class="font-medium text-stone-700">{b.title}</span>
			</div>
			<form method="POST" action="?/save" enctype="multipart/form-data" use:enhance={() => async ({ update }) => { await update({ reset: false }); previews = { ...previews, [b.id]: '' }; }}>
				{@render fields(b, b.id)}
				<button type="submit" class="mt-3 rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">保存する</button>
			</form>
			<form method="POST" action="?/delete" use:enhance class="mt-2 border-t border-stone-100 pt-2">
				<input type="hidden" name="bannerId" value={b.id} />
				<button
					type="submit"
					class="text-xs text-stone-400 hover:text-red-600"
					onclick={confirmSubmit({ message: 'このバナーを削除します。', confirmLabel: '削除する' })}
				>削除</button>
			</form>
		</div>
	{:else}
		<p class="rounded-xl border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-400">まだバナーがありません。</p>
	{/each}

	{#if adding || (form?.bannerId === 'new' && form?.message)}
		<div class="rounded-xl border border-brand-200 bg-white p-4 text-sm">
			<h2 class="mb-3 font-medium text-stone-700">＋ 新しいバナー</h2>
			<form
				method="POST"
				action="?/save"
				enctype="multipart/form-data"
				use:enhance={() => async ({ result, update }) => {
					await update();
					if (result.type === 'success') { adding = false; previews = { ...previews, new: '' }; }
				}}
			>
				{@render fields(null, 'new')}
				<div class="mt-3 flex gap-2">
					<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">追加する</button>
					<button type="button" onclick={() => (adding = false)} class="rounded-lg px-4 py-2 text-sm text-stone-500 hover:bg-stone-100">やめる</button>
				</div>
			</form>
		</div>
	{:else}
		<button type="button" onclick={() => (adding = true)} class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">＋ バナーを追加</button>
	{/if}
</div>
