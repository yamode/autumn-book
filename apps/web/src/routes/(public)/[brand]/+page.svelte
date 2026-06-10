<script lang="ts">
	let { data } = $props();
</script>

<svelte:head>
	<title>{data.brand.name} ｜ ブランドトップ</title>
	<meta name="description" content={data.brand.description} />
</svelte:head>

<section class="relative">
	<img src={data.facilities[0]?.photos[0].url} alt="" class="h-72 w-full object-cover" />
	<div class="absolute inset-0 flex items-center justify-center bg-black/40">
		<div class="text-center text-white">
			<h1 class="font-display text-4xl tracking-widest">{data.brand.name}</h1>
			<p class="mt-3 text-sm">{data.brand.description}</p>
		</div>
	</div>
</section>

<section class="mx-auto max-w-6xl px-4 py-12">
	<div class="grid gap-6 sm:grid-cols-2">
		{#each data.facilities as f}
			<a href="/{f.brandSlug}/{f.slug}" class="group overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-lg">
				<img src={f.photos[0].url} alt={f.name} class="h-56 w-full object-cover transition group-hover:scale-[1.02]" />
				<div class="p-5">
					<p class="text-xs text-stone-400">{f.prefecture}</p>
					<h2 class="font-display text-xl text-brand-900">{f.name}</h2>
					<p class="mt-1 text-sm text-stone-600">{f.catchCopy}</p>
				</div>
			</a>
		{/each}
	</div>
</section>
