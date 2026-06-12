<script lang="ts">
	// 西和賀「山人 -yamado-」専用テンプレート — hp-yamado テーマ front-page.php の実構成を再現
	// KVスライダー / お知らせ / sec-introduction×2（原文コピー全文・画像左右交互） /
	// sec-links（施設・客室・お料理 ラベル画像+ホバー切替） / 観光バナー / Googleマップ / sec-address
	import { onMount } from 'svelte';
	import PlanCard from '$lib/components/PlanCard.svelte';
	import RoomCard from '$lib/components/RoomCard.svelte';
	import NewsSection from '$lib/components/facility/NewsSection.svelte';
	import CalendarSection from '$lib/components/facility/CalendarSection.svelte';
	import FaqSection from '$lib/components/facility/FaqSection.svelte';
	import OverviewSection from '$lib/components/facility/OverviewSection.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { FacilityPageData } from './types';
	import { reveal } from '$lib/actions/reveal';

	let { data }: { data: FacilityPageData } = $props();
	let f = $derived(data.facility);
	let base = $derived(`/${f.brandSlug}/${f.slug}`);
	const A = '/site-assets/yamado';

	// KV スライダー（原サイト top-slider: 4枚クロスフェード。素材は移植画像で代替）
	const slides = [`${A}/top_fig_01.jpg`, `${A}/link_02.jpg`, `${A}/top_fig_02.jpg`, `${A}/link_03.jpg`];
	let slideIndex = $state(0);
	onMount(() => {
		const t = setInterval(() => (slideIndex = (slideIndex + 1) % slides.length), 5000);
		return () => clearInterval(t);
	});

	// 原サイト front-page.php の実コピー（全文）
	const intro1 = [
		'山人（やまど）―、文字通り「山の人」。',
		'ここ西和賀の地では、山仕事の達人や山を熟知している人のことを',
		'（いささか敬意を込めて）山人と呼びます。',
		'山の優しさ、山の厳しさ、いつごろになるとどこの山になんという木が芽吹き、',
		'何月にはあの山一面まばゆいほどの紅葉に埋め尽くされる、',
		'あの山の陰が、実は山菜の宝庫なのだ・・・などなど。',
		'私たちの宿「山人」も、そんな山の達人たちと同じように、',
		'この地の自然とともに息づき、その季節でなければ決して味わえない味覚を探し出し、',
		'お客様と一緒に楽しんでいきたい。',
		'自然の息づかいにそっと耳を傾ける―、',
		'ここは＜極上のヒーリングリゾート＞です。'
	];
	const intro2 = [
		'世界中から美味しい食材は取り寄せることは、それほど難しいことではありません。',
		'その一方で、その季節にその土地でなければ食べられない味覚というものもあります。',
		'私たちの宿「山人」は、そんな、この土地の食の豊かさに光を当てたい・・・。',
		'それがお客様を当館にお招きしたい一番の理由です。',
		'「山人」ではお泊りのたびに違ったお料理をお出しします。',
		'その季節でなければ食べられない食材、',
		'その季節に一番美味しくなる食材がここには山ほどあるからです。'
	];
</script>

<div class="yamado-v1 bg-white" style="--fac-heading: #333; --fac-accent: #4a6b52;">
	<!-- KVスライダー（原サイト top-slider） -->
	<section class="relative h-[72vh] min-h-[420px] overflow-hidden">
		{#each slides as slide, i}
			<div
				class="absolute inset-0 bg-cover bg-center transition-opacity duration-[2500ms]"
				style="background-image: url({slide}); opacity: {slideIndex === i ? 1 : 0};"
			></div>
		{/each}
		<div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/40 to-transparent pb-8 pt-20">
			<div class="mx-auto max-w-[980px] px-4 text-white">
				<h1 class="text-2xl tracking-[0.25em] drop-shadow sm:text-3xl">{f.name}</h1>
				<a href="{base}/plans" class="mt-4 inline-block border border-white/80 px-8 py-2.5 text-[15px] tracking-widest transition hover:bg-white hover:text-stone-900">
					{m.facility_see_plans()}
				</a>
			</div>
		</div>
	</section>

	<div class="mx-auto max-w-[980px] px-4">
		<!-- お知らせ（原サイト inc/top-news） -->
		<div class="pt-10">
			<NewsSection news={data.news} {base} variant="yamado" />
		</div>

		<!-- sec-introduction 1: 山人と名乗る宿（画像右・テキスト左） -->
		<section use:reveal class="mt-[60px] sm:mt-[125px]">
			<div class="grid items-center gap-8 md:grid-cols-[1fr_55%]">
				<div class="md:order-1">
					<h2 class="text-[26px] font-normal tracking-[0.1em] sm:text-[34px]" style="color: var(--fac-heading)">山人と名乗る宿</h2>
					<p class="mt-[5px] text-[14px] leading-[2] sm:text-[15px]">
						{#each intro1 as line}{line}<br />{/each}
					</p>
				</div>
				<img src="{A}/top_fig_01.jpg" alt="" class="w-full md:order-2" loading="lazy" />
			</div>
		</section>

		<!-- sec-introduction 2: ここに来る理由（画像左・テキスト右） -->
		<section use:reveal class="mt-[60px] sm:mt-[125px]">
			<div class="grid items-center gap-8 md:grid-cols-[55%_1fr]">
				<img src="{A}/top_fig_02.jpg" alt="" class="w-full" loading="lazy" />
				<div>
					<h2 class="text-[26px] font-normal tracking-[0.1em] sm:text-[34px]" style="color: var(--fac-heading)">ここに来る理由</h2>
					<p class="mt-[5px] text-[14px] leading-[2] sm:text-[15px]">
						{#each intro2 as line}{line}<br />{/each}
					</p>
				</div>
			</div>
		</section>

		<!-- sec-links（原サイト: 施設=左大 / 客室・お料理=右2段。ラベル画像+ホバーで明転） -->
		<section use:reveal class="mt-[60px] sm:mt-[125px]">
			<div class="flex flex-col gap-[1%] gap-y-3 sm:flex-row">
				<div class="w-full sm:w-[49.5%]">
					<a href="{base}/facility" class="group relative block h-full">
						<img src="{A}/label_01.png" alt="施設" class="absolute left-4 top-4 z-10 w-[64px]" />
						<img src="{A}/link_01.jpg" alt="施設" class="h-full w-full object-cover transition group-hover:hidden" />
						<img src="{A}/link_01_h.jpg" alt="" class="hidden h-full w-full object-cover group-hover:block" />
					</a>
				</div>
				<div class="flex w-full flex-col justify-between gap-y-3 sm:w-[49.5%]">
					<a href="{base}/rooms" class="group relative block">
						<img src="{A}/label_02.png" alt="客室" class="absolute left-4 top-4 z-10 w-[64px]" />
						<img src="{A}/link_02.jpg" alt="客室" class="w-full transition group-hover:hidden" />
						<img src="{A}/link_02_h.jpg" alt="" class="hidden w-full group-hover:block" />
					</a>
					<a href="{base}/cuisine" class="group relative block">
						<img src="{A}/label_03.png" alt="お料理" class="absolute left-4 top-4 z-10 w-[64px]" />
						<img src="{A}/link_03.jpg" alt="お料理" class="w-full transition group-hover:hidden" />
						<img src="{A}/link_03_h.jpg" alt="" class="hidden w-full group-hover:block" />
					</a>
				</div>
			</div>
		</section>

		<!-- 周辺観光バナー（原サイト sec_sight-bnr） -->
		<section use:reveal class="mt-[60px] text-center sm:mt-[100px]">
			<a href="{base}/shiki" class="inline-block transition hover:opacity-80">
				<img src="{A}/tourist-info.png" alt="周辺観光案内" class="mx-auto w-full max-w-[720px]" loading="lazy" />
			</a>
		</section>

		<!-- 予約機能（プラン・客室・カレンダー） -->
		<section use:reveal id="plans" class="mt-[60px] sm:mt-[125px]">
			<h2 class="mb-8 text-center text-[26px] font-normal tracking-[0.15em] sm:text-[30px]" style="color: var(--fac-heading)">おすすめプラン</h2>
			<div class="space-y-4">
				{#each data.plans.slice(0, 3) as plan}
					<PlanCard {plan} href="{base}/plans/{plan.slug}" />
				{/each}
			</div>
			<p class="mt-5 text-center">
				<a href="{base}/plans" class="inline-block bg-[#e5e5e5] px-12 py-3 text-[15px] tracking-[0.2em] text-black transition hover:bg-[#4d4d4d] hover:text-white">{m.facility_all_plans()}</a>
			</p>
		</section>

		<section use:reveal id="rooms" class="mt-[60px] sm:mt-[100px]">
			<h2 class="mb-8 text-center text-[26px] font-normal tracking-[0.15em] sm:text-[30px]" style="color: var(--fac-heading)">{m.facility_rooms()}</h2>
			<div class="grid gap-6 sm:grid-cols-3">
				{#each data.rooms as room}
					<RoomCard {room} href="{base}/rooms/{room.slug}" />
				{/each}
			</div>
		</section>

		<div class="mt-[60px] sm:mt-[100px]">
			<CalendarSection calendar={data.calendar} calMonth={data.calMonth} calendarNav={data.calendarNav} {base} />
		</div>

		<div id="faq" class="mt-[60px] sm:mt-[100px]">
			<FaqSection faqs={data.facilityFaqs} />
		</div>
	</div>

	<!-- Googleマップ（原サイト sec-map: フル幅） -->
	<section use:reveal class="mt-[60px] sm:mt-[100px]" id="access">
		<iframe
			src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3088.194667159572!2d140.76980285100615!3d39.283835579412404!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x5f8f1436b86818ef%3A0xc7d31a16a1c714f2!2z5pel5pys44CB44CSMDI5LTU1MTQg5bKp5omL55yM5ZKM6LOA6YOh6KW_5ZKM6LOA55S65rmv5bed77yV77yS5Zyw5Ymy77yX77yR4oiS77yR77yQ!5e0!3m2!1sja!2sau!4v1569592660615!5m2!1sja!2sau"
			width="100%"
			height="400"
			style="border:0;"
			loading="lazy"
			title="地図"
			allowfullscreen
		></iframe>
	</section>

	<!-- sec-address（原サイト: ダーク帯 + 白ロゴ + 住所 + SNS） -->
	<section class="bg-[#4d4d4d] py-12 text-white">
		<div class="mx-auto flex max-w-[980px] flex-col items-center justify-between gap-6 px-4 sm:flex-row">
			<div class="text-center sm:text-left">
				<p class="text-[15px] tracking-wider">岩手 湯川温泉「山人-yamado-」</p>
				<p class="mt-2 text-[14px] leading-relaxed text-white/80">〒029-5514 岩手県和賀郡西和賀町湯川52地割71-10<br />TEL {f.phone}</p>
				<p class="mt-3 text-[14px] tracking-widest text-white/70">
					Follow us
					<a href="https://www.instagram.com/explore/locations/299907439/yamado" target="_blank" rel="noopener" class="ml-3 hover:text-white">Instagram</a>
					<a href="https://www.facebook.com/onsen.yamado/" target="_blank" rel="noopener" class="ml-3 hover:text-white">Facebook</a>
				</p>
			</div>
			<img src="{A}/logo_w.png" alt={f.name} class="w-[130px]" />
		</div>
	</section>

	<div class="mx-auto max-w-[980px] px-4 py-12">
		<OverviewSection {f} />
	</div>
</div>
