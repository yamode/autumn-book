<script lang="ts">
	import MapPanel from '$lib/components/MapPanel.svelte';
	import { formatYen } from '$lib/format';
	import { dbg } from '$lib/debug';

	let { data } = $props();

	let highlighted = $state<string | null>(null);

	let mapItems = $derived(
		data.results.map((r) => ({
			id: r.facility.id,
			lat: r.facility.lat,
			lng: r.facility.lng,
			name: r.facility.name,
			label: r.minTotal !== null ? `${formatYen(r.reference ? r.minPerPerson! : r.minTotal)}〜` : '満室',
			soldOut: r.minTotal === null
		}))
	);

	function plansHref(r: (typeof data.results)[0]) {
		const q = data.params.checkin
			? `?checkin=${data.params.checkin}&nights=${data.params.nights}&adults=${data.params.adults}`
			: '';
		return `/${r.facility.brandSlug}/${r.facility.slug}/plans${q}`;
	}

	function onPin(id: string) {
		highlighted = id;
		dbg('map pin click', id);
		document.getElementById(`fc-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}
</script>

<svelte:head>
	<title>空室検索 ｜ 山人 -yamado-</title>
</svelte:head>

<div class="mx-auto max-w-6xl px-4 py-6">
	<h1 class="font-display mb-1 text-xl text-brand-900">地図から探す</h1>
	{#if !data.params.checkin}
		<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
			日付が未指定のため<strong>参考最低料金（1名1泊）</strong>を表示しています。上の検索バーで日付を選ぶと、空室と正確な料金が表示されます。
		</p>
	{:else}
		<p class="mb-4 text-sm text-stone-500">
			{data.params.checkin} から {data.params.nights}泊・大人{data.params.adults}名 ／ 表示料金は1室あたりの税込総額
		</p>
	{/if}

	<div class="grid gap-4 lg:grid-cols-[1fr_360px]">
		<MapPanel items={mapItems} height="520px" {highlighted} onpinclick={onPin} />

		<div class="flex gap-3 overflow-x-auto lg:max-h-[520px] lg:flex-col lg:overflow-y-auto">
			{#each data.results as r}
				<div
					id="fc-{r.facility.id}"
					role="presentation"
					class="w-72 shrink-0 rounded-xl border bg-white shadow-sm transition lg:w-auto {highlighted === r.facility.id
						? 'border-accent-500 ring-1 ring-accent-500'
						: 'border-stone-200'}"
					onmouseenter={() => (highlighted = r.facility.id)}
					onmouseleave={() => (highlighted = null)}
				>
					<img src={r.facility.photos[0].url} alt={r.facility.name} class="h-32 w-full rounded-t-xl object-cover" />
					<div class="p-3">
						<p class="text-xs text-stone-400">{r.facility.prefecture}</p>
						<h2 class="font-display text-lg text-brand-900">{r.facility.name}</h2>
						{#if r.minTotal !== null}
							<p class="mt-1 font-bold text-brand-900">
								{formatYen(r.reference ? r.minPerPerson! : r.minTotal)}〜
								<span class="text-xs font-normal text-stone-500">
									{r.reference ? '/ 1名1泊（参考）' : `/ ${data.params.adults}名${data.params.nights}泊・税込`}
								</span>
							</p>
							{#if !r.reference && r.remaining <= 2}
								<p class="mt-0.5 text-xs font-medium text-red-600">残り{r.remaining}室</p>
							{/if}
							<a href={plansHref(r)} class="mt-2 block rounded-md bg-brand-800 py-1.5 text-center text-sm text-white hover:bg-brand-700">プランを見る</a>
						{:else}
							<p class="mt-1 text-sm font-medium text-stone-400">この条件では満室です</p>
							<p class="mt-1 text-xs text-stone-500">キャンセル待ちはお電話（{r.facility.phone}）でご相談ください</p>
							<a href="/{r.facility.brandSlug}/{r.facility.slug}" class="mt-2 block rounded-md border border-stone-300 py-1.5 text-center text-sm text-stone-600 hover:bg-stone-50">施設ページへ</a>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</div>
