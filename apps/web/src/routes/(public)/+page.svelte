<script lang="ts">
	import SearchBar from '$lib/components/SearchBar.svelte';
	import MapPanel from '$lib/components/MapPanel.svelte';
	import { formatYen } from '$lib/format';
	import { goto } from '$app/navigation';

	let { data } = $props();

	let mapItems = $derived(
		data.results.map((r) => ({
			id: r.facility.id,
			lat: r.facility.lat,
			lng: r.facility.lng,
			name: r.facility.name,
			label: r.minPerPerson ? `${formatYen(r.minPerPerson)}〜` : '満室',
			soldOut: !r.minPerPerson,
			href: `/${r.facility.brandSlug}/${r.facility.slug}`
		}))
	);
</script>

<svelte:head>
	<title>山人 -yamado- ｜ 公式予約サイト</title>
	<meta name="description" content="岩手・西和賀と秋田・男鹿。山人の宿の公式予約サイト。ベストレートでのご予約は公式サイトから。" />
</svelte:head>

<!-- ヒーロー -->
<section class="relative">
	<img src="https://picsum.photos/seed/yamado-hero/1600/700" alt="" class="h-[420px] w-full object-cover sm:h-[480px]" />
	<div class="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-black/10"></div>
	<div class="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-4 pb-8">
		<h1 class="font-display text-3xl text-white drop-shadow sm:text-4xl">土地の記憶を、味わう宿。</h1>
		<p class="mt-2 text-sm text-white/90 drop-shadow">東北の山峡と海辺に佇むちいさな宿 — 公式サイトならベストレート＆ポイント還元</p>
		<div class="mt-4 max-w-2xl">
			<SearchBar large />
		</div>
	</div>
</section>

<!-- 地図プレビュー + 施設カード -->
<section class="mx-auto max-w-6xl px-4 py-12">
	<h2 class="font-display mb-1 text-2xl text-brand-900">地図から宿を探す</h2>
	<p class="mb-4 text-sm text-stone-500">ピンの料金は大人2名1泊あたりの参考最低料金です。日付を選ぶと正確な空室・料金が表示されます。</p>
	<MapPanel items={mapItems} height="380px" onpinclick={(id) => {
		const r = data.results.find((x) => x.facility.id === id);
		if (r) goto(`/${r.facility.brandSlug}/${r.facility.slug}`);
	}} />
</section>

<section class="mx-auto max-w-6xl px-4">
	<h2 class="font-display mb-4 text-2xl text-brand-900">宿一覧</h2>
	<div class="grid gap-6 sm:grid-cols-2">
		{#each data.results as r}
			<a href="/{r.facility.brandSlug}/{r.facility.slug}" class="group overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-lg">
				<div class="relative">
					<img src={r.facility.photos[0].url} alt={r.facility.name} class="h-56 w-full object-cover transition group-hover:scale-[1.02]" />
					<span class="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs text-white">{r.facility.prefecture}</span>
				</div>
				<div class="p-5">
					<h3 class="font-display text-xl text-brand-900">{r.facility.name}</h3>
					<p class="mt-1 text-sm text-stone-600">{r.facility.catchCopy}</p>
					<p class="mt-3 text-lg font-bold text-brand-900">
						{#if r.minPerPerson}
							{formatYen(r.minPerPerson)}<span class="text-xs font-normal text-stone-500">〜 / 1名1泊（参考）</span>
						{:else}
							<span class="text-stone-400">満室</span>
						{/if}
					</p>
				</div>
			</a>
		{/each}
	</div>
</section>

<!-- 会員制度 -->
<section class="mx-auto mt-14 max-w-6xl px-4">
	<div class="rounded-2xl bg-brand-800 px-6 py-8 text-white sm:flex sm:items-center sm:justify-between">
		<div>
			<h2 class="font-display text-xl">山人会員のご案内</h2>
			<p class="mt-2 text-sm text-stone-300">
				ご宿泊で最大3%のポイント還元。貯まったポイントは<strong class="text-accent-500">次のご予約ですぐ使えます</strong>。全施設共通・入会無料。
			</p>
		</div>
		<a href="/auth/register" class="mt-4 inline-block rounded-lg bg-accent-600 px-6 py-2.5 text-sm font-medium hover:bg-accent-500 sm:mt-0">無料で会員登録</a>
	</div>
</section>
