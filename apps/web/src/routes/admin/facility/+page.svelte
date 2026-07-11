<script lang="ts">
	import { enhance } from '$app/forms';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';

	let { data, form } = $props();
	let f = $derived(data.facility);
	// 初期値を prop から取り込み、以降は下の $effect で再同期する（意図的な初期化）
	// svelte-ignore state_referenced_locally
	let description = $state(data.facility.description);
	$effect(() => {
		description = data.facility.description;
	});

	const catLabel = { exterior: '外観', room: '客室', bath: '温泉', meal: '食事', view: '景色' } as const;

	// 翻訳タブ
	let translationLocale = $state<'en' | 'zh-TW'>('en');
	let trDescription = $state('');
	$effect(() => {
		const tr = data.translations[translationLocale];
		trDescription = (tr?.fields?.description as string) ?? '';
	});
</script>

<svelte:head><title>施設ページ編集 ｜ 山人管理</title></svelte:head>

<div class="mb-4 flex items-center justify-between">
	<h1 class="text-lg font-bold text-stone-800">施設ページ編集 — {f.name}</h1>
	<a href="/{f.brandSlug}/{f.slug}" target="_blank" class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm hover:bg-stone-50">公開ページを確認 ↗</a>
</div>

{#if form?.saved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">保存しました。</p>{/if}
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

<form method="POST" action="?/save" use:enhance class="space-y-4 rounded-xl border border-stone-200 bg-white p-5">
	<input type="hidden" name="facilityId" value={f.id} />

	<label class="block text-sm">
		<span class="text-stone-600">キャッチコピー</span>
		<input name="catchCopy" value={f.catchCopy} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
	</label>

	<div class="text-sm">
		<span class="text-stone-600">紹介文（Markdown）</span>
		<div class="mt-1">
			<MarkdownEditor bind:value={description} name="description" rows={8} photos={f.photos} />
		</div>
	</div>

	<div class="grid grid-cols-2 gap-3 sm:max-w-sm">
		<label class="block text-sm">
			<span class="text-stone-600">チェックイン</span>
			<input name="checkinTime" value={f.checkinTime} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
		</label>
		<label class="block text-sm">
			<span class="text-stone-600">チェックアウト</span>
			<input name="checkoutTime" value={f.checkoutTime} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
		</label>
	</div>

	<label class="block text-sm">
		<span class="text-stone-600">設備・アメニティ（「、」区切り）</span>
		<input name="amenities" value={f.amenities.join('、')} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
	</label>

	<label class="flex items-center gap-2 text-sm">
		<input type="checkbox" name="isPublished" checked={f.isPublished} class="h-4 w-4" />
		<span>公開する</span>
	</label>

	<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">保存する</button>
</form>

<!-- 写真管理（Supabase Storage 接続予定） -->
<section class="mt-6 rounded-xl border border-stone-200 bg-white p-5">
	<div class="flex items-center justify-between">
		<h2 class="text-sm font-medium text-stone-700">写真管理</h2>
		<button type="button" disabled class="rounded-md border border-dashed border-stone-300 px-3 py-1.5 text-xs text-stone-400" title="Supabase Storage 接続後に有効化">＋ アップロード（Storage 接続後に有効化）</button>
	</div>
	<div class="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
		{#each f.photos as photo, i}
			<div class="rounded-lg border border-stone-200 p-2">
				<img src={photo.url} alt={photo.caption} class="h-24 w-full rounded object-cover" />
				<p class="mt-1 text-[10px] text-stone-400">{catLabel[photo.category]}</p>
				<form method="POST" action="?/caption" use:enhance class="mt-1 flex gap-1">
					<input type="hidden" name="facilityId" value={f.id} />
					<input type="hidden" name="index" value={i} />
					<input name="caption" value={photo.caption} class="w-full rounded border border-stone-200 px-1.5 py-1 text-xs" />
					<button type="submit" class="rounded bg-stone-100 px-2 text-xs hover:bg-stone-200">保存</button>
				</form>
			</div>
		{/each}
	</div>
	<p class="mt-2 text-xs text-stone-400">並べ替え（ドラッグ）と Supabase Storage へのアップロードは P1 実装時に接続します。</p>
</section>

<!-- アクセス情報（構造化フォームは P1 で拡充。現在は表示のみ） -->
<section class="mt-6 rounded-xl border border-stone-200 bg-white p-5 text-sm">
	<h2 class="font-medium text-stone-700">アクセス情報（access jsonb）</h2>
	<pre class="mt-2 overflow-x-auto rounded bg-stone-50 p-3 text-xs text-stone-600">{JSON.stringify(f.access, null, 2)}</pre>
	<p class="mt-2 text-xs text-stone-400">車・電車・飛行機の行追加フォームは P1 で実装（設計書 A-03）。</p>
</section>

<!-- 翻訳（i18n フェーズ2） -->
<section class="mt-6 rounded-xl border border-stone-200 bg-white p-5">
	<h2 class="mb-3 text-sm font-bold text-stone-700">翻訳（コンテンツ多言語化）</h2>
	<p class="mb-3 text-xs text-stone-400">en / zh-TW の翻訳を入力し公開すると、各言語の顧客画面に反映されます。未入力フィールドは日本語がフォールバック表示されます。</p>

	<!-- ロケール切替 -->
	<div class="mb-4 flex gap-2">
		{#each (['en', 'zh-TW'] as const) as loc}
			<button
				type="button"
				onclick={() => { translationLocale = loc; }}
				class="rounded-md px-4 py-1.5 text-sm font-medium transition-colors {translationLocale === loc ? 'bg-brand-800 text-white' : 'border border-stone-300 bg-white text-stone-600 hover:bg-stone-50'}"
			>{loc === 'en' ? 'English (en)' : '繁體中文 (zh-TW)'}</button>
		{/each}
	</div>

	{#if form?.translationSaved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">翻訳を保存しました（{translationLocale}）。</p>{/if}

	<form method="POST" action="?/saveTranslation" use:enhance class="space-y-4">
		<input type="hidden" name="facilityId" value={f.id} />
		<input type="hidden" name="locale" value={translationLocale} />

		<!-- ja 原文を並記 -->
		<div class="grid gap-4 lg:grid-cols-2">
			<div class="space-y-3">
				<p class="text-xs font-medium text-stone-500">日本語（原文・参照用）</p>
				<div class="text-sm">
					<p class="text-stone-400 text-xs">キャッチコピー</p>
					<p class="mt-1 rounded bg-stone-50 px-3 py-2 text-stone-700">{f.catchCopy}</p>
				</div>
				<div class="text-sm">
					<p class="text-stone-400 text-xs">紹介文</p>
					<pre class="mt-1 overflow-auto rounded bg-stone-50 px-3 py-2 text-xs text-stone-600 whitespace-pre-wrap max-h-40">{f.description}</pre>
				</div>
				<div class="text-sm">
					<p class="text-stone-400 text-xs">設備・アメニティ</p>
					<p class="mt-1 rounded bg-stone-50 px-3 py-2 text-stone-700">{f.amenities.join('、')}</p>
				</div>
			</div>

			<div class="space-y-3">
				<p class="text-xs font-medium text-stone-500">{translationLocale === 'en' ? 'English' : '繁體中文'}（翻訳入力）</p>
				<label class="block text-sm">
					<span class="text-xs text-stone-400">catchCopy</span>
					<input
						name="catchCopy"
						value={data.translations[translationLocale]?.fields?.catchCopy ?? ''}
						class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
						placeholder="翻訳を入力（空白は日本語で表示）"
					/>
				</label>
				<div class="text-sm">
					<span class="text-xs text-stone-400">description（Markdown）</span>
					<div class="mt-1">
						<MarkdownEditor bind:value={trDescription} name="description" rows={6} photos={[]} />
					</div>
				</div>
				<label class="block text-sm">
					<span class="text-xs text-stone-400">amenities（カンマ区切り）</span>
					<input
						name="amenities"
						value={(data.translations[translationLocale]?.fields?.amenities as string[] | undefined)?.join(', ') ?? ''}
						class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
						placeholder="Free Wi-Fi, Onsen, ..."
					/>
				</label>
			</div>
		</div>

		<div class="flex items-center gap-4 border-t border-stone-100 pt-4">
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" name="isPublished" checked={data.translations[translationLocale]?.isPublished ?? false} class="h-4 w-4" />
				<span>公開する（顧客画面に反映）</span>
			</label>
			<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">翻訳を保存</button>
		</div>
	</form>
</section>
