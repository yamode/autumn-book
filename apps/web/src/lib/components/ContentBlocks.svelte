<script lang="ts">
	// 部屋・プラン詳細ページの「仕様表」と「紹介ブロック」。
	// 紹介ブロックは同じ group が連続するものを1つの見出しの下にまとめる（groupSections）。
	// 本文・仕様の値は改行を含むので whitespace-pre-line で表示する。
	import { groupSections, type ContentSection, type ContentSpec } from '$lib/content-blocks';

	let {
		specs = [],
		sections = [],
		specsTitle
	}: { specs?: ContentSpec[]; sections?: ContentSection[]; specsTitle: string } = $props();

	let groups = $derived(groupSections(sections));
</script>

{#if specs.length}
	<section class="mt-10">
		<h2 class="font-display mb-3 text-xl text-brand-900">{specsTitle}</h2>
		<div class="overflow-hidden rounded-xl border border-stone-200">
			<table class="w-full text-sm">
				<tbody>
					{#each specs as spec, i (i)}
						<tr class="border-b border-stone-200 last:border-b-0">
							<th scope="row" class="w-28 bg-stone-50 px-3 py-2.5 text-left align-top font-medium text-stone-600 sm:w-40">{spec.label}</th>
							<td class="whitespace-pre-line px-3 py-2.5 text-stone-700">{spec.value}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}

{#each groups as g, gi (gi)}
	<section class="mt-10">
		{#if g.group}
			<h2 class="font-display mb-4 text-xl text-brand-900">{g.group}</h2>
		{/if}
		<div class="space-y-6">
			{#each g.items as s, si (si)}
				<article class="flex flex-col gap-4 sm:flex-row {si % 2 === 1 ? 'sm:flex-row-reverse' : ''}">
					{#if s.photo}
						<img src={s.photo} alt={s.title || g.group} loading="lazy" class="h-56 w-full rounded-xl object-cover sm:h-52 sm:w-2/5 sm:shrink-0" />
					{/if}
					<div class="min-w-0 flex-1">
						{#if s.title}<h3 class="mb-1.5 font-medium text-brand-900">{s.title}</h3>{/if}
						{#if s.text}<p class="whitespace-pre-line text-sm leading-relaxed text-stone-700">{s.text}</p>{/if}
						{#if s.note}<p class="mt-2 whitespace-pre-line text-xs text-stone-500">{s.note}</p>{/if}
					</div>
				</article>
			{/each}
		</div>
	</section>
{/each}
