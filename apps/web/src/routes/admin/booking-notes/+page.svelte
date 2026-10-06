<script lang="ts">
	// 管理画面: 予約時の注意事項（施設ごと・Markdown）。取引先ページの予約入力の左カラム下部に出る。
	import { enhance } from '$app/forms';
	import MarkdownEditor from '$lib/components/MarkdownEditor.svelte';

	let { data, form } = $props();
	// svelte-ignore state_referenced_locally
	let body = $state(data.body);
	let saving = $state(false);
</script>

<svelte:head><title>予約時の注意事項 ｜ 山人管理</title></svelte:head>

<div class="mb-4">
	<h1 class="text-lg font-bold text-stone-800">予約時の注意事項 — {data.currentFacility.name}</h1>
	<p class="mt-1 text-sm text-stone-500">予約入力の画面の下部に、キャンセルポリシー・お子様についてと並べて表示します（いまは取引先ページの予約入力）。取引先ごとの「予約画面に出す案内」は、この下に続けて表示されます。</p>
</div>

{#if data.loadError}<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{data.loadError}</p>{/if}
{#if form?.error}<p class="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{form.error}</p>{/if}
{#if form?.saved}<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">保存しました。</p>{/if}

<form
	method="POST"
	action="?/save"
	use:enhance={() => {
		saving = true;
		return async ({ update }) => {
			await update({ reset: false });
			saving = false;
		};
	}}
	class="rounded-xl border border-stone-200 bg-white p-4"
>
	<MarkdownEditor bind:value={body} name="body" rows={14} />
	<p class="mt-2 text-xs text-stone-500">例: チェックイン・アウトの時刻、送迎、駐車場、館内の決まり、ペット、喫煙など。見出しは「## 見出し」、箇条書きは「- 項目」。</p>
	<button type="submit" disabled={saving || !data.live} class="mt-4 rounded-md bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-40">{saving ? '保存しています…' : '保存'}</button>
</form>
