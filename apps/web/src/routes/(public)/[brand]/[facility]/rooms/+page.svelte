<script lang="ts">
	// 客室一覧ページ（原サイトの guestroom / room ページに対応）
	import { reveal } from '$lib/actions/reveal';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let f = $derived(data.facility);
	let variant = $derived(f.template === 'oga-v1' ? 'oga' : f.template === 'yamado-v1' ? 'yamado' : 'standard');
	let base = $derived(`/${f.brandSlug}/${f.slug}`);
	let hero = $derived(f.photos.find((p) => p.category === 'room') ?? f.photos[0]);
</script>

<svelte:head><title>{m.facility_rooms()} ｜ {f.name}</title></svelte:head>

<!-- ヒーロー -->
<section class="relative overflow-hidden">
	<img src={hero.url} alt={m.facility_rooms()} class="hero-zoom h-[42vh] min-h-[260px] w-full object-cover sm:h-[52vh]" />
	<div class="absolute inset-0 {variant === 'oga' ? 'bg-black/30' : 'bg-gradient-to-b from-black/10 to-black/45'}"></div>
	<div class="absolute inset-0 flex flex-col items-center justify-center text-center text-white">
		{#if variant === 'oga'}
			<h1 class="font-cormorant text-3xl font-light tracking-[0.4em] sm:text-5xl">Stay</h1>
			<p class="mt-4 text-lg tracking-[0.4em]">{m.facility_rooms()}</p>
		{:else}
			<h1 class="text-3xl tracking-[0.3em] sm:text-4xl">{m.facility_rooms()}</h1>
			<p class="mt-3 text-sm tracking-[0.5em] opacity-80">GUEST ROOM</p>
		{/if}
	</div>
</section>

<div class="mx-auto {variant === 'yamado' ? 'max-w-[980px]' : 'max-w-6xl'} px-4 py-12 sm:py-16">
	<div class="space-y-16 sm:space-y-24">
		{#each data.rooms as room, i}
			<section use:reveal class="grid items-center gap-6 sm:gap-10 md:grid-cols-2 {i % 2 === 1 ? 'md:[&>*:first-child]:order-2' : ''}">
				<a href="{base}/rooms/{room.slug}" class="block overflow-hidden">
					<img src={room.photos[0]?.url} alt={room.name} class="h-64 w-full object-cover transition duration-1000 hover:scale-105 sm:h-80" loading="lazy" />
				</a>
				<div class="md:px-6">
					<h2 class="text-xl leading-relaxed tracking-wider sm:text-2xl" style="color: var(--fac-heading, #1f1d15)">{room.name}</h2>
					<p class="mt-1 text-[14px] tracking-wide text-stone-400">{m.room_card_capacity({ n: String(room.capacity), size: String(room.sizeM2) })}</p>
					<p class="mt-4 text-[17px] leading-[2]">{room.description}</p>
					<div class="mt-4 flex flex-wrap gap-2">
						{#each room.amenities as a}
							<span class="border border-stone-200 bg-stone-50 px-3 py-1 text-[13px] tracking-wide text-stone-600">{a}</span>
						{/each}
					</div>
					<a href="{base}/rooms/{room.slug}" class="mt-6 inline-block text-[14px] tracking-[0.25em] underline-offset-8 hover:underline" style="color: var(--fac-accent, #95742c)">
						{variant === 'oga' ? 'VIEW DETAIL →' : '詳しく見る →'}
					</a>
				</div>
			</section>
		{/each}
	</div>

	<div class="mt-16 text-center" use:reveal>
		{#if variant === 'oga'}
			<a href="{base}/plans" class="inline-block bg-[#111] px-14 py-4 text-[14px] tracking-[0.3em] text-white transition hover:bg-[#333]">宿泊予約</a>
		{:else}
			<a href="{base}/plans" class="inline-block bg-[#e5e5e5] px-14 py-4 text-[16px] tracking-[0.2em] text-black transition hover:bg-[#4d4d4d] hover:text-white">ご予約</a>
		{/if}
	</div>
</div>
