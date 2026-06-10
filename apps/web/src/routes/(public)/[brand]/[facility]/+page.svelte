<script lang="ts">
	import PhotoGallery from '$lib/components/PhotoGallery.svelte';
	import RoomCard from '$lib/components/RoomCard.svelte';
	import PlanCard from '$lib/components/PlanCard.svelte';
	import PriceCalendar from '$lib/components/PriceCalendar.svelte';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let f = $derived(data.facility);
	let base = $derived(`/${f.brandSlug}/${f.slug}`);

	function shiftMonth(ym: string, delta: number): string {
		const [y, mo] = ym.split('-').map(Number);
		const d = new Date(y, mo - 1 + delta, 1);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}

	let jsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'Hotel',
			name: f.name,
			address: f.addressPublic,
			telephone: f.phone,
			geo: { '@type': 'GeoCoordinates', latitude: f.lat, longitude: f.lng },
			checkinTime: f.checkinTime,
			checkoutTime: f.checkoutTime
		})
	);
</script>

<svelte:head>
	<title>{m.facility_title({ name: f.name })}</title>
	<meta name="description" content={f.catchCopy} />
	<meta property="og:image" content={f.photos[0].url} />
	{@html `<script type="application/ld+json">${jsonLd}<\/script>`}
</svelte:head>

<!-- ヒーロー -->
<section class="relative">
	<img src={f.photos[0].url} alt={f.name} class="h-[400px] w-full object-cover sm:h-[460px]" />
	<div class="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
	<div class="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-4 pb-8 text-white">
		<p class="text-sm opacity-90">{f.prefecture}</p>
		<h1 class="font-display text-3xl sm:text-4xl">{f.name}</h1>
		<p class="mt-2 text-sm opacity-90">{f.catchCopy}</p>
		<a href="{base}/plans" class="mt-4 inline-block rounded-lg bg-accent-600 px-6 py-2.5 text-sm font-medium hover:bg-accent-500">{m.facility_see_plans()}</a>
	</div>
</section>

<div class="mx-auto max-w-6xl space-y-14 px-4 py-12">
	<!-- コンセプト -->
	<section class="mx-auto max-w-3xl text-center">
		<h2 class="font-display mb-4 text-2xl text-brand-900">{f.catchCopy}</h2>
		<p class="text-sm leading-loose text-stone-600">{f.description}</p>
	</section>

	<!-- ギャラリー -->
	<section>
		<h2 class="font-display mb-4 text-2xl text-brand-900">{m.facility_gallery()}</h2>
		<PhotoGallery photos={f.photos} />
	</section>

	<!-- 客室 -->
	<section>
		<h2 class="font-display mb-4 text-2xl text-brand-900">{m.facility_rooms()}</h2>
		<div class="grid gap-5 sm:grid-cols-2">
			{#each data.rooms as room}
				<RoomCard {room} href="{base}/rooms/{room.slug}" />
			{/each}
		</div>
	</section>

	<!-- おすすめプラン -->
	<section>
		<div class="mb-4 flex items-end justify-between">
			<h2 class="font-display text-2xl text-brand-900">{m.facility_recommend_plans()}</h2>
			<a href="{base}/plans" class="text-sm text-accent-600 hover:underline">{m.facility_all_plans()}</a>
		</div>
		<div class="space-y-4">
			{#each data.plans.slice(0, 3) as plan}
				<PlanCard {plan} href="{base}/plans/{plan.slug}" />
			{/each}
		</div>
	</section>

	<!-- 空室カレンダー -->
	{#if data.calendar.length > 0}
		<section>
			<h2 class="font-display mb-1 text-2xl text-brand-900">{m.facility_calendar()}</h2>
			<p class="mb-4 text-sm text-stone-500">{m.facility_calendar_sub()}</p>
			<div class="max-w-xl">
				<PriceCalendar
					days={data.calendar}
					yearMonth={data.calMonth}
					makeDayHref={(date) => `${base}/plans?checkin=${date}&nights=1&adults=2`}
					prevHref="{base}?cal={shiftMonth(data.calMonth, -1)}#cal"
					nextHref="{base}?cal={shiftMonth(data.calMonth, 1)}#cal"
				/>
			</div>
		</section>
	{/if}

	<!-- アクセス -->
	<section id="access">
		<h2 class="font-display mb-4 text-2xl text-brand-900">{m.facility_access()}</h2>
		<div class="grid gap-6 md:grid-cols-2">
			<div class="space-y-3 text-sm">
				{#each f.access.car as c}
					<p>🚗 <strong>{m.facility_car()}</strong>{c.from} から {c.route} 約{c.minutes}分</p>
				{/each}
				{#each f.access.train as t}
					<p>🚃 <strong>{m.facility_train()}</strong>{t.from} から {t.via} 約{t.minutes}分</p>
				{/each}
				{#each f.access.air as a}
					<p>✈ <strong>{m.facility_air()}</strong>{a.from} から 約{a.minutes}分</p>
				{/each}
				{#if f.access.shuttle.available}
					<p class="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">🚌 {m.facility_shuttle_available({ note: f.access.shuttle.note })}</p>
				{/if}
				{#if f.access.parking.available}
					<p>🅿 {m.facility_parking({ capacity: String(f.access.parking.capacity), fee: f.access.parking.fee })}</p>
				{/if}
				<p class="pt-2 text-stone-500">{f.addressPublic}</p>
				<a
					href="https://www.google.com/maps/dir/?api=1&destination={f.lat},{f.lng}"
					target="_blank"
					rel="noopener"
					class="inline-block rounded-md border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50"
				>
					{m.common_google_map()}
				</a>
			</div>
			<iframe
				title={m.facility_map_title()}
				class="h-64 w-full rounded-xl border border-stone-200"
				src="https://www.openstreetmap.org/export/embed.html?bbox={f.lng - 0.05},{f.lat - 0.03},{f.lng + 0.05},{f.lat + 0.03}&marker={f.lat},{f.lng}"
				loading="lazy"
			></iframe>
		</div>
	</section>

	<!-- FAQ -->
	{#if data.facilityFaqs.length > 0}
		<section>
			<h2 class="font-display mb-4 text-2xl text-brand-900">{m.facility_faq()}</h2>
			<div class="space-y-2">
				{#each data.facilityFaqs as q}
					<details class="rounded-lg border border-stone-200 bg-white px-4 py-3">
						<summary class="cursor-pointer text-sm font-medium">
							<span class="mr-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">{q.category}</span>
							{q.question}
						</summary>
						<div class="mt-2 text-sm text-stone-600"><MarkdownView source={q.answer} /></div>
					</details>
				{/each}
			</div>
		</section>
	{/if}

	<!-- 施設概要 -->
	<section class="rounded-2xl bg-stone-100 p-6">
		<h2 class="font-display mb-4 text-xl text-brand-900">{m.facility_info()}</h2>
		<dl class="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
			<div class="flex gap-3"><dt class="w-28 shrink-0 text-stone-500">{m.facility_checkin_label()}</dt><dd>{f.checkinTime}〜</dd></div>
			<div class="flex gap-3"><dt class="w-28 shrink-0 text-stone-500">{m.facility_checkout_label()}</dt><dd>〜{f.checkoutTime}</dd></div>
			<div class="flex gap-3"><dt class="w-28 shrink-0 text-stone-500">{m.facility_address_label()}</dt><dd>{f.addressPublic}</dd></div>
			<div class="flex gap-3"><dt class="w-28 shrink-0 text-stone-500">{m.facility_phone_label()}</dt><dd>{f.phone}</dd></div>
			<div class="col-span-full flex gap-3">
				<dt class="w-28 shrink-0 text-stone-500">{m.facility_amenities_label()}</dt>
				<dd class="flex flex-wrap gap-1.5">
					{#each f.amenities as a}
						<span class="rounded-full bg-white px-2.5 py-0.5 text-xs">{a}</span>
					{/each}
				</dd>
			</div>
		</dl>
	</section>
</div>

<!-- チャットウィジェット（P1=FAQ誘導のみ・P9でLLM化） -->
<a
	href="#access"
	onclick={(e) => {
		e.preventDefault();
		document.querySelector('details')?.scrollIntoView({ behavior: 'smooth' });
	}}
	class="fixed bottom-6 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand-800 text-xl text-white shadow-lg hover:bg-brand-700"
	title={m.facility_chat_title()}
>
	💬
</a>
