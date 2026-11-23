<script lang="ts">
	import MemberBenefitsTable from '$lib/components/MemberBenefitsTable.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import * as m from '$lib/paraglide/messages';
	import { siteText } from '$lib/member-benefit-texts';

	let { data } = $props();
</script>

<svelte:head>
	<title>会員特典 ｜ 山人管理</title>
	{@html '<style>@page { size: A4 landscape; margin: 10mm; }</style>'}
</svelte:head>

<div class="member-benefit-print mx-auto max-w-6xl">
	<div class="actions mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
		<PageHeader title="会員特典" description="ランク別の適用条件と優待を確認できます。特典名を押すと詳細が開き、その場で文言（日本語・英語・繁体字）を編集できます。空欄にすると元の文言に戻ります。" />
		<button type="button" class="min-h-11 rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700" onclick={() => window.print()}>
			印刷（A4横）
		</button>
	</div>
	<div class="hidden print:block print:pb-2">
		<h1 class="text-xl font-semibold">YAMADO　会員特典比較表</h1>
	</div>
	<MemberBenefitsTable printable texts={data.texts} edit={data.edit} />
	<p class="rank-note mt-3 text-sm leading-relaxed text-stone-600">{siteText(data.texts, 'membership_rank_note', m.membership_rank_note)}</p>

	{#if !data.editable}<p class="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 print:hidden">文言の編集は本番データ環境でだけできます。</p>{/if}
	{#if data.loadError}<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 print:hidden">{data.loadError}</p>{/if}
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
