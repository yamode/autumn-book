<script lang="ts">
	import type { Facility } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	let { f }: { f: Facility } = $props();
</script>

<section class="rounded-2xl bg-stone-100 p-6">
	<h2 class="font-display mb-4 text-xl" style="color: var(--fac-heading, #1f1d15)">{m.facility_info()}</h2>
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
