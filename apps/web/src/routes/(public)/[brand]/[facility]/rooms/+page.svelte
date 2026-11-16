<script lang="ts">
	import { roomCapacityText } from '$lib/room-capacity';
	import { localizeHref } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let f = $derived(data.facility);
	let base = $derived(`/${f.brandSlug}/${f.slug}`);

	function roomLabel(name: string) {
		// 西和賀の販売名は「タイプ◆棟名-英字-◆部屋名」または「タイプ■棟名◇部屋名-英字-■」。
		const namedRoom = name.match(/^(.+?)[◆■](?:[^◆■◇]+◇)?(.+?)-[A-Za-z]+-[◆■](.*)$/u);
		if (namedRoom) {
			const [, type, title, suffix] = namedRoom;
			const bath = suffix.match(/^[（(](.+)[）)]$/u)?.[1];
			return { title, type: type.replace(/^［離れ］/u, '離れ・'), note: bath };
		}

		// 男鹿の販売名は客室棟とタイプが「│」で区切られる。
		const suite = name.match(/^([A-Za-z]+)-(.+?)-│(.+?)\s*(\d+(?:\.\d+)?)平米\s*(?:【(.+)】)?$/u);
		if (suite) {
			const [, , wing, type, area, floor] = suite;
			return { title: type, type: wing, note: floor, area: Number(area) };
		}

		return { title: name };
	}
</script>

<svelte:head><title>{m.facility_rooms()} ｜ {f.name}</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
	<div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5 border-b border-stone-200 pb-3 sm:pb-4">
		<h1 class="font-display text-2xl leading-tight text-brand-900 sm:text-3xl">{m.rooms_list_title()}</h1>
		<p class="text-sm text-stone-600">{f.name}</p>
	</div>
	<nav class="mt-1 flex gap-5 text-sm" aria-label={m.plans_view_switch()}>
		<a href={localizeHref(`${base}/plans`)} class="flex min-h-11 items-center border-b-2 border-transparent text-stone-600 hover:text-brand-900">{m.plans_tab_plans()}</a>
		<span class="flex min-h-11 items-center border-b-2 border-brand-800 font-medium text-brand-900" aria-current="page">{m.plans_tab_rooms()}</span>
	</nav>

	{#if data.rooms.length === 0}
		<p class="mt-8 rounded-xl border border-stone-200 bg-white p-6 text-center text-stone-500">{m.rooms_list_empty()}</p>
	{:else}
		<div class="mt-4 grid gap-x-5 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
			{#each data.rooms as r, index (r.slug)}
				{@const label = roomLabel(r.name)}
				{@const photo = r.photos[0]}
				<article id="room-{r.slug}" class="scroll-mt-32 {photo ? '' : 'sm:col-span-full'}">
					<a href={localizeHref(`${base}/rooms/${r.slug}`)}
						class="group flex h-full flex-col overflow-hidden rounded-lg border border-stone-200 bg-white transition-colors hover:border-stone-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-800">
						{#if photo}
							<div class="aspect-[16/10] overflow-hidden bg-stone-100">
								<img src={photo.url} alt="" loading={index === 0 ? 'eager' : 'lazy'} decoding="async"
									class="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-500 motion-safe:group-hover:scale-[1.035]" />
							</div>
						{/if}
						<div class="flex flex-1 items-end justify-between gap-2.5 px-4 py-3.5">
							<div class="min-w-0">
								{#if label.type}<p class="mb-0.5 text-xs text-stone-600">{label.type}</p>{/if}
								<h2 class="font-display text-xl leading-snug break-words text-brand-900">{label.title}{#if label.note && label.area}<span class="ml-2 inline-block align-middle font-sans text-xs text-stone-600">{label.note}</span>{/if}</h2>
								<p class="mt-1 text-xs text-stone-600">{roomCapacityText({ capacity: r.capacity, sizeM2: r.sizeM2 || label.area || 0 })}{#if label.note && !label.area} ・ {label.note}{/if}</p>
							</div>
							<span aria-hidden="true" class="grid size-9 shrink-0 place-items-center rounded-full bg-stone-100 text-base leading-none text-brand-800 transition-colors group-hover:bg-brand-800 group-hover:text-white">→</span>
						</div>
					</a>
				</article>
			{/each}
		</div>
	{/if}
</div>
