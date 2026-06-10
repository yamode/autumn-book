<script lang="ts">
	import SitePageView from '$lib/components/facility/SitePageView.svelte';
	import FaqSection from '$lib/components/facility/FaqSection.svelte';
	import AccessSection from '$lib/components/facility/AccessSection.svelte';
	import { reveal } from '$lib/actions/reveal';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let f = $derived(data.facility);
	let variant = $derived(f.template === 'yamado-v1' ? ('yamado' as const) : f.template === 'oga-v1' ? ('oga' as const) : ('standard' as const));
	let base = $derived(`/${f.brandSlug}/${f.slug}`);
	let title = $derived(data.kind === 'page' ? data.page!.title : data.kind === 'faq' ? m.facility_faq() : m.facility_access());
</script>

<svelte:head>
	<title>{title} ｜ {f.name}</title>
	{#if data.kind === 'page'}<meta name="description" content={data.page!.lead} />{/if}
</svelte:head>

{#if data.kind === 'page'}
	<SitePageView page={data.page!} {variant} />
	<!-- 予約導線（各下層ページ末尾） -->
	<div class="pb-16 text-center" use:reveal>
		{#if variant === 'oga'}
			<a href="{base}/plans" class="inline-block bg-[#111] px-14 py-4 text-[14px] tracking-[0.3em] text-white transition hover:bg-[#333]">宿泊予約</a>
		{:else}
			<a href="{base}/plans" class="inline-block bg-[#e5e5e5] px-14 py-4 text-[16px] tracking-[0.2em] text-black transition hover:bg-[#4d4d4d] hover:text-white">ご予約</a>
		{/if}
	</div>
{:else if data.kind === 'faq'}
	<div class="mx-auto {variant === 'yamado' ? 'max-w-[980px]' : 'max-w-4xl'} px-4 py-12 sm:py-16">
		<h1 class="mb-2 text-center text-2xl tracking-[0.3em]" style="color: var(--fac-heading, #1f1d15)">{m.facility_faq()}</h1>
		<p class="mb-10 text-center text-xs tracking-[0.5em] text-stone-400">FAQ</p>
		<div use:reveal><FaqSection faqs={data.faqs} heading=" " /></div>
		<p class="mt-10 text-center text-[15px] text-stone-500">解決しない場合はお電話（{f.phone}）でお気軽にお問い合わせください。</p>
	</div>
{:else}
	<div class="mx-auto {variant === 'yamado' ? 'max-w-[980px]' : 'max-w-5xl'} px-4 py-12 sm:py-16">
		<h1 class="mb-2 text-center text-2xl tracking-[0.3em]" style="color: var(--fac-heading, #1f1d15)">{m.facility_access()}</h1>
		<p class="mb-10 text-center text-xs tracking-[0.5em] text-stone-400">ACCESS</p>
		<div use:reveal><AccessSection {f} heading=" " /></div>
	</div>
{/if}
