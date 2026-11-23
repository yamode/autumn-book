<script lang="ts">
	import MemberBenefitsTable from '$lib/components/MemberBenefitsTable.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import * as m from '$lib/paraglide/messages';
	import { enhance } from '$lib/enhance';
	import { siteText } from '$lib/member-benefit-texts';

	let { data, form } = $props();
	const LOCALES = [
		{ code: 'ja', label: '日本語' },
		{ code: 'en', label: 'English' },
		{ code: 'zh-TW', label: '繁體中文' }
	] as const;
	const overridden = (v: Record<string, string>) => Object.values(v).some((x) => x.trim());
</script>

<svelte:head>
	<title>会員特典 ｜ 山人管理</title>
	{@html '<style>@page { size: A4 landscape; margin: 10mm; }</style>'}
</svelte:head>

<div class="member-benefit-print mx-auto max-w-6xl">
	<div class="actions mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
		<PageHeader title="会員特典" description="ランク別の適用条件と優待を確認できます。特典名を押すと詳細が開きます。下の「説明文の編集」で、公開ページの文言を変えられます。" />
		<button type="button" class="min-h-11 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700" onclick={() => window.print()}>
			印刷（A4横）
		</button>
	</div>
	<div class="hidden print:block print:pb-2">
		<h1 class="text-xl font-semibold">YAMADO　会員特典比較表</h1>
	</div>
	<MemberBenefitsTable printable texts={data.texts} />
	<p class="rank-note mt-3 text-sm leading-relaxed text-stone-600">{siteText(data.texts, 'membership_rank_note', m.membership_rank_note)}</p>

	<!-- 説明文の編集（book.site_texts）。空にする・元の文言と同じにすると元に戻る。公開ページへの反映は最大1分ほど遅れることがある -->
	<section class="mt-10 print:hidden" aria-labelledby="benefit-texts">
		<h2 id="benefit-texts" class="text-lg font-semibold text-stone-800">説明文の編集</h2>
		<p class="mt-1 text-sm text-stone-600">公開ページ（会員特典）と、この比較表の文言を変えられます。空欄にすると元の文言に戻ります。保存してからお客様の画面に出るまで、最大1分ほどかかることがあります。</p>
		{#if !data.editable}<p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">本番データ環境でだけ編集できます。</p>{/if}
		{#if data.loadError}<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.loadError}</p>{/if}
		{#if form?.message}<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}
		{#each data.groups as g (g.title)}
			<h3 class="mt-6 text-sm font-semibold text-stone-700">{g.title}</h3>
			<div class="mt-2 divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
				{#each g.items as item (item.key)}
					<details class="group" open={(form as { key?: string } | null)?.key === item.key || form?.savedKey === item.key}>
						<summary class="flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm [&::-webkit-details-marker]:hidden">
							<span class="min-w-0 flex-1">
								<span class="font-medium text-stone-800">{item.label}</span>
								<span class="mt-0.5 block truncate text-xs text-stone-500">{item.values.ja || item.defaults.ja}</span>
							</span>
							{#if overridden(item.values)}<span class="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">変更あり</span>{/if}
							{#if form?.savedKey === item.key}<span class="shrink-0 text-xs text-emerald-700">保存しました</span>{/if}
							<span class="shrink-0 text-stone-400 transition group-open:rotate-180" aria-hidden="true">▾</span>
						</summary>
						<form method="POST" action="?/saveText" use:enhance class="space-y-3 px-4 pb-4">
							<input type="hidden" name="key" value={item.key} />
							{#each LOCALES as l (l.code)}
								<label class="block text-xs">
									<span class="font-medium text-stone-600">{l.label}</span>
									{#if item.multiline}
										<textarea name={`value_${l.code}`} rows="3" maxlength="4000" disabled={!data.editable || !data.canEdit} placeholder={item.defaults[l.code]} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm leading-6">{item.values[l.code]}</textarea>
									{:else}
										<input name={`value_${l.code}`} value={item.values[l.code]} maxlength="4000" disabled={!data.editable || !data.canEdit} placeholder={item.defaults[l.code]} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm" />
									{/if}
									<span class="mt-1 block text-stone-400">元の文言: {item.defaults[l.code]}</span>
								</label>
							{/each}
							{#if data.editable && data.canEdit}
								<button type="submit" class="min-h-10 rounded-md bg-brand-800 px-5 text-sm font-medium text-white hover:bg-brand-700">保存</button>
							{/if}
						</form>
					</details>
				{/each}
			</div>
		{/each}
	</section>
</div>

<style>
	@media print {
		:global(body:has(.member-benefit-print)),
		:global(body :has(.member-benefit-print)) {
			display: block !important;
			width: auto !important;
			height: auto !important;
			min-height: 0 !important;
			max-width: none !important;
			margin: 0 !important;
			padding: 0 !important;
			overflow: visible !important;
			background: white !important;
		}
		:global(body:has(.member-benefit-print) > :not(:has(.member-benefit-print), .member-benefit-print)),
		:global(body :has(.member-benefit-print) > :not(:has(.member-benefit-print), .member-benefit-print)),
		.actions { display: none !important; }
		.member-benefit-print { margin: 0; max-width: none; }
		.rank-note { margin-top: 2mm; font-size: 9pt; }
	}
</style>
