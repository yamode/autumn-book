<script lang="ts">
	// 男鹿「山人 -oga-」専用テンプレート — hp-oga/dist/index.ejs の実構成を再現
	// KV=左右2面スライダー+縦書きコピー / 詩的イントロ（縦書き） / ギャラリーコラージュ /
	// 01 NATURE / 02 CUISINE / 03 PURITY（タイトルSVG+パララックス背景） / ABOUT / NEWS
	import { onMount } from 'svelte';
	import PlanCard from '$lib/components/PlanCard.svelte';
	import CalendarSection from '$lib/components/facility/CalendarSection.svelte';
	import AccessSection from '$lib/components/facility/AccessSection.svelte';
	import FaqSection from '$lib/components/facility/FaqSection.svelte';
	import OverviewSection from '$lib/components/facility/OverviewSection.svelte';
	import * as m from '$lib/paraglide/messages';
	import { formatDate } from '$lib/format';
	import { getLocale } from '$lib/paraglide/runtime';
	import type { FacilityPageData } from './types';
	import { reveal } from '$lib/actions/reveal';

	let { data }: { data: FacilityPageData } = $props();
	let f = $derived(data.facility);
	let base = $derived(`/${f.brandSlug}/${f.slug}`);
	const A = '/site-assets/oga';

	// KV スライダー（原サイト: 左右独立の2面 Swiper をクロスフェードで再現）
	let kvIndex = $state(0);
	onMount(() => {
		const t = setInterval(() => (kvIndex = (kvIndex + 1) % 2), 5000);
		return () => clearInterval(t);
	});

	// 原サイト index.ejs の実コピー
	// 訳文は1行ずつ改行で区切る
	const introLines = $derived(m.tpl_oga_intro().split('\n'));
	// 縦書きは日本語・繁体字のまま。英語は横書きに切り替える
	const vertical = getLocale() !== 'en';

	const pillars = $derived([
		{
			titleSvg: `${A}/t_nature.svg`, alt: '01 NATURE', bg: `${A}/bg_nature.webp`,
			heading: m.tpl_oga_nature_heading(),
			text: m.tpl_oga_nature_text(),
			link: { href: '/nature', text: m.tpl_oga_nature_link() }
		},
		{
			titleSvg: `${A}/t_cuisine.svg`, alt: '02 CUISINE', bg: `${A}/bg_cuisine.webp`,
			heading: m.tpl_oga_cuisine_heading(),
			text: m.tpl_oga_cuisine_text(),
			link: { href: '/cuisine', text: m.tpl_oga_cuisine_link() }
		},
		{
			titleSvg: `${A}/t_purity.svg`, alt: '03 PURITY', bg: `${A}/bg_purity.webp`,
			heading: m.tpl_oga_purity_heading(),
			text: m.tpl_oga_purity_text(),
			link: { href: '/rooms', text: m.tpl_oga_purity_link() }
		}
	]);
</script>

<div class="oga-v1 bg-white" style="--fac-heading: #1c1c1c; --fac-accent: #555;">
	<!-- KV: 左右2面スライダー + サイドバー（縦書きコピー）。原サイト p-index_kv -->
	<section class="relative flex h-[88vh] min-h-[480px] gap-1 pr-[60px] sm:gap-2 sm:pr-[80px]">
		{#each [['kv_left01', 'kv_left02'], ['kv_right01', 'kv_right02']] as pair, col}
			<div class="relative h-full w-1/2 overflow-hidden">
				{#each pair as img, i}
					<img
						src="{A}/{img}.webp"
						alt=""
						class="absolute inset-0 h-full w-full object-cover transition-opacity duration-[2000ms]"
						style="opacity: {(kvIndex + col) % 2 === i ? 1 : 0};"
					/>
				{/each}
			</div>
		{/each}
		<!-- サイドバー: ロゴ + 縦書きコピー（原サイト p-index_kv__sidebar） -->
		<div class="absolute right-0 top-0 flex h-full w-[60px] flex-col items-center justify-between py-6 sm:w-[80px]">
			<img src="{A}/logo.svg" alt={f.name} class="w-[44px] sm:w-[56px]" />
			<img src="{A}/kv_copy.svg" alt={m.tpl_oga_copy_alt()} class="h-[160px] w-auto sm:h-[200px]" />
			<span></span>
		</div>
	</section>

	<!-- 詩的イントロ（縦書き・原文コピー全文） -->
	<section use:reveal class="flex justify-center px-4 py-20 sm:py-28">
		<div class={vertical ? 'flex max-h-[560px] flex-row-reverse items-start gap-6 overflow-hidden [writing-mode:vertical-rl] sm:gap-8' : 'flex max-w-[600px] flex-col items-center gap-8 text-center'}>
			<img src="{A}/intro_copy.webp" alt={m.tpl_oga_copy_alt()} class="h-[280px] w-auto sm:h-[324px]" style="writing-mode: horizontal-tb;" />
			<p class="text-[15px] leading-[2.6] tracking-[0.15em] sm:text-[16px]">
				{#each introLines as line}
					<span class="mb-1 block">{line}</span>
				{/each}
			</p>
		</div>
	</section>

	<!-- ギャラリーコラージュ（原サイト p-index_gallery） -->
	<section use:reveal class="relative mx-auto max-w-[1400px] px-4 pb-24">
		<figure class="mx-auto max-w-[900px]">
			<img src="{A}/g_main.webp" alt={m.tpl_oga_alt_sea()} class="w-full object-cover" />
		</figure>
		<figure class="absolute left-[2%] top-[-8%] hidden w-[20%] md:block"><img src="{A}/g_top.webp" alt={m.tpl_oga_alt_strata()} /></figure>
		<figure class="absolute right-[1%] top-[18%] hidden w-[21%] md:block"><img src="{A}/g_right.webp" alt={m.tpl_oga_alt_incense()} /></figure>
		<figure class="absolute bottom-[4%] left-[1%] hidden w-[24%] md:block"><img src="{A}/g_left.webp" alt={m.tpl_oga_alt_scenery()} /></figure>
		<figure class="absolute bottom-[-10%] right-[14%] hidden w-[23%] md:block"><img src="{A}/g_b1.webp" alt={m.site_oga_nav_onsen()} /></figure>
		<div class="mt-2 grid grid-cols-3 gap-2 md:hidden">
			<img src="{A}/g_top.webp" alt={m.tpl_oga_alt_strata()} /><img src="{A}/g_b1.webp" alt={m.site_oga_nav_onsen()} /><img src="{A}/g_left.webp" alt={m.tpl_oga_alt_scenery()} />
		</div>
	</section>

	<!-- 01 NATURE / 02 CUISINE / 03 PURITY（タイトルSVG + 実コピー + パララックス風背景） -->
	{#each pillars as pillar}
		<section use:reveal class="mx-auto max-w-[1100px] px-6 py-16 sm:py-20">
			<h2><img src={pillar.titleSvg} alt={pillar.alt} class="h-auto w-[260px] sm:w-[360px]" /></h2>
			<div class="ml-auto mt-8 max-w-[560px]">
				<h3 class="text-[22px] font-medium leading-[1.4] tracking-[0.08em] sm:text-[26px]">{@html pillar.heading}</h3>
				<p class="mt-5 text-[15px] leading-[2.1] sm:text-[16px]">{pillar.text}</p>
				<a href="{base}{pillar.link.href}" class="group mt-6 inline-flex items-center gap-3 border-b border-[#111] pb-1 text-[14px] tracking-[0.15em]">
					{pillar.link.text}
					<span class="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
				</a>
			</div>
		</section>
		<div class="h-[300px] bg-cover bg-fixed bg-center sm:h-[420px]" style="background-image: url({pillar.bg});"></div>
	{/each}

	<!-- ABOUT（原サイト p-index_about: 温泉/イベント大カード + 3小カード） -->
	<section use:reveal class="mx-auto max-w-[1100px] px-6 py-20 sm:py-28">
		<div class="grid gap-10 md:grid-cols-[280px_1fr]">
			<div>
				<h2>
					<img src="{A}/t_about.svg" alt="ABOUT" class="w-[200px]" />
					<span class="mt-3 block text-[15px] tracking-[0.2em]">{m.tpl_oga_about()}</span>
				</h2>
				<p class="mt-8 text-[15px] leading-[2.1]">{f.description}</p>
			</div>
			<ul class="grid gap-4 sm:grid-cols-2">
				{#each [{ img: `${A}/about_onsen.webp`, num: '01', en: 'onsen', jp: m.site_oga_nav_onsen(), href: `${base}/onsen` }, { img: `${A}/about_event.webp`, num: '02', en: 'news', jp: m.tpl_oga_card_news(), href: `${base}/news` }] as card}
					<li>
						<a href={card.href} class="group relative block overflow-hidden">
							<img src={card.img} alt={card.jp} class="aspect-square w-full object-cover transition duration-700 group-hover:scale-105" />
							<div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 text-white">
								<h3 class="font-cormorant text-lg tracking-widest"><span class="mr-2 text-sm opacity-70">{card.num}</span>{card.en}</h3>
								<p class="mt-1 flex items-center justify-between text-[14px] tracking-widest">{card.jp}<span class="transition-transform duration-300 group-hover:translate-x-1.5">→</span></p>
							</div>
						</a>
					</li>
				{/each}
			</ul>
		</div>
		<ul class="mt-6 grid gap-4 sm:grid-cols-3">
			{#each [{ img: `${A}/p_facility.webp`, num: '03', en: 'facility', jp: m.tpl_oga_card_facility(), href: `${base}/guide` }, { img: `${A}/p_activities.webp`, num: '04', en: 'activities', jp: m.tpl_oga_card_activities(), href: `${base}/nature` }, { img: `${A}/p_access.webp`, num: '05', en: 'access', jp: m.common_access(), href: `${base}/access` }] as card}
				<li>
					<a href={card.href} class="group flex items-center gap-4 border-b border-stone-200 pb-4">
						<img src={card.img} alt={card.jp} class="h-[72px] w-[115px] object-cover" />
						<div class="flex-1">
							<h3 class="font-cormorant text-base tracking-widest text-stone-400"><span class="mr-2 text-xs">{card.num}</span>{card.en}</h3>
							<p class="mt-1 flex items-center justify-between text-[14px] tracking-widest">{card.jp}<span class="transition-transform duration-300 group-hover:translate-x-1.5">→</span></p>
						</div>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	<!-- NEWS（原サイト p-index_news: 左タイトル + 右リスト） -->
	{#if data.news.length > 0}
		<section use:reveal class="mx-auto max-w-[1100px] px-6 pb-20">
			<div class="grid gap-8 md:grid-cols-[280px_1fr]">
				<h2>
					<img src="{A}/t_news.svg" alt="NEWS" class="w-[160px]" />
					<span class="mt-3 block text-[15px] tracking-[0.2em]">{m.news_title()}</span>
				</h2>
				<div>
					<ul class="divide-y divide-stone-200">
						{#each data.news as n}
							<li>
								<a href="{base}/news/{n.id}" class="group flex flex-col gap-1 py-4 sm:flex-row sm:items-baseline sm:gap-8">
									<time class="font-inter shrink-0 text-[13px] tracking-widest text-stone-400">{formatDate(n.publishedAt)}</time>
									<span class="text-[15px] group-hover:underline">{n.title}</span>
								</a>
							</li>
						{/each}
					</ul>
					<a href="{base}/news" class="group mt-5 inline-flex items-center gap-3 border-b border-[#111] pb-1 text-[14px] tracking-[0.15em]">
						{m.tpl_oga_news_more()} <span class="transition-transform duration-300 group-hover:translate-x-1.5">→</span>
					</a>
				</div>
			</div>
		</section>
	{/if}

	<!-- 予約機能（共通コンポーネント: プラン・カレンダー・アクセス・FAQ・概要） -->
	<div class="mx-auto max-w-[1100px] space-y-20 px-6 pb-24">
		<section use:reveal id="plans">
			<h2 class="font-cormorant mb-8 text-center text-sm font-semibold tracking-[0.5em] text-stone-400">PLAN / RESERVATION</h2>
			<div class="space-y-4">
				{#each data.plans.slice(0, 3) as plan}
					<PlanCard {plan} href="{base}/plans/{plan.slug}" />
				{/each}
			</div>
			<p class="mt-4 text-center">
				<a href="{base}/plans" class="text-xs tracking-[0.3em] text-stone-500 underline-offset-8 hover:underline">{m.facility_all_plans()} →</a>
			</p>
		</section>
		<CalendarSection calendar={data.calendar} calMonth={data.calMonth} calendarNav={data.calendarNav} {base} />
		<AccessSection {f} />
		<FaqSection faqs={data.facilityFaqs} />
		<OverviewSection {f} />
	</div>
</div>
