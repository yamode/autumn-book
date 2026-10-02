<script lang="ts">
	import { enhance } from '$app/forms';
	import ContentEditor from '$lib/components/admin/ContentEditor.svelte';

	let { data, form } = $props();
	let r = $derived(data.room);
</script>

<svelte:head><title>{r.name} ｜ 部屋編集 ｜ 山人管理</title></svelte:head>

<nav class="mb-3 text-xs text-stone-400"><a href="/admin/rooms" class="hover:underline">部屋編集</a> / {r.name}</nav>

<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-lg font-bold text-stone-800">{r.name}</h1>
		<p class="text-xs text-stone-400">
			{r.code}{r.capacityMax ? `・定員${r.capacityMin ?? 1}〜${r.capacityMax}名` : ''}{r.isActive ? '' : '・PMS で無効（公開しても表示されません）'}
			{#if !r.hasContent}・紹介はまだ作られていません（保存すると作成されます）{/if}
		</p>
	</div>
	{#if data.previewBase && r.slug && r.isPublished}
		<a href="{data.previewBase}/rooms/{r.slug}" target="_blank" class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-50">公開ページを開く ↗</a>
	{/if}
</div>

<!-- 取引先向けの短縮名（ご請求書・ご利用明細書の部屋名。2026-10-02 指示）。紹介の編集とは別に保存する -->
<form
	method="POST"
	action="?/savePartnerShortName"
	use:enhance={() =>
		async ({ update }) => {
			// 再読込すると下の紹介エディタの未保存の編集が消えるので、データは読み直さない
			await update({ reset: false, invalidateAll: false });
		}}
	class="mb-4 rounded-xl border border-stone-200 bg-white p-4 text-sm"
>
	<h2 class="mb-1 font-medium text-stone-700">取引先向けの短縮名</h2>
	<p class="mb-2 text-xs text-stone-500">
		取引先へのご請求書・ご利用明細書の部屋名に使います（例: オーシャンスイート）。空欄なら PMS の短縮名{#if r.pmsShortName}（「{r.pmsShortName}」）{/if}、それも無ければ正式名を使います。
		発行済みのご請求書は変わりません。
	</p>
	<div class="flex flex-wrap items-center gap-2">
		<input
			name="partner_short_name"
			value={r.partnerShortName}
			maxlength="40"
			disabled={!data.live}
			placeholder={r.pmsShortName || r.name}
			class="w-72 max-w-full rounded-md border border-stone-300 px-2 py-1.5 disabled:bg-stone-50"
		/>
		<button type="submit" disabled={!data.live} class="rounded-md bg-brand-800 px-3 py-1.5 text-xs text-white hover:bg-brand-700 disabled:opacity-40">保存</button>
		{#if form?.shortNameSaved}<span class="text-xs text-emerald-700">保存しました</span>{/if}
		{#if form?.error && !form?.shortNameSaved}<span class="text-xs text-rose-700">{form.error}</span>{/if}
	</div>
</form>

{#key r.updatedAt}
	<ContentEditor
		initial={r}
		kind="room"
		live={data.live}
		tagsLabel="特徴タグ（「、」区切り）"
		tagsPlaceholder="温泉、テラス付、禁煙"
		photoFallback="room"
	/>
{/key}
