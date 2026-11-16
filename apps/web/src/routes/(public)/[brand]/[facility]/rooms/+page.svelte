<script lang="ts">
	import { roomCapacityText } from '$lib/room-capacity';
	import PartnerContentBody from '$lib/components/PartnerContentBody.svelte';
	import CommonRoomEquipment from '$lib/components/CommonRoomEquipment.svelte';
	import { roomEquipmentForList } from '$lib/partner-contents';
	import { localizeHref } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let f = $derived(data.facility);
	let base = $derived(`/${f.brandSlug}/${f.slug}`);
	let roomList = $derived(roomEquipmentForList(data.rooms, f.slug === 'nishiwaga'));

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

<div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10" style="--pt-accent: var(--color-brand-800); --pt-accent-soft: var(--color-stone-100)">
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
		<CommonRoomEquipment equipment={roomList.common} label={m.rooms_common_equipment()} />
		<div class="mt-5 space-y-8 sm:space-y-10">
			{#each roomList.rooms as r (r.slug)}
				{@const label = roomLabel(r.name)}
				<article id="room-{r.slug}" class="scroll-mt-32 border-t border-stone-200 pt-4 sm:pt-6">
					<header class="mb-3 sm:mb-4">
						{#if label.type}<p class="mb-0.5 text-xs text-stone-600">{label.type}</p>{/if}
						<h2 class="font-display text-xl leading-snug break-words text-brand-900 sm:text-2xl">
							{label.title}{#if label.note && label.area}<span class="ml-2 inline-block align-middle font-sans text-xs text-stone-600">{label.note}</span>{/if}
						</h2>
						<p class="mt-1 text-xs text-stone-600">{roomCapacityText({ capacity: r.capacity, sizeM2: r.sizeM2 || label.area || 0 })}{#if label.note && !label.area} ・ {label.note}{/if}</p>
					</header>
					<PartnerContentBody photos={r.photos} description={r.description || (r.headline === r.name ? '' : r.headline)}
						specs={r.specs} sections={r.sections} amenities={r.amenities} detailLabel={m.room_detail_more()}>
						{#snippet actions()}
							<a href={localizeHref(`${base}/rooms/${r.slug}`)}
								class="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-brand-900 transition-colors hover:border-brand-800 hover:bg-stone-50">
								{m.rooms_view_plans()} <span aria-hidden="true">→</span>
							</a>
						{/snippet}
					</PartnerContentBody>
				</article>
			{/each}
		</div>
	{/if}
</div>
