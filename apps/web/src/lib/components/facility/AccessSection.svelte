<script lang="ts">
	import type { Facility } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let { f, heading = '' }: { f: Facility; heading?: string } = $props();
</script>

<section id="access">
	<h2 class="font-display mb-4 text-2xl" style="color: var(--fac-heading, #1f1d15)">{heading || m.facility_access()}</h2>
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
