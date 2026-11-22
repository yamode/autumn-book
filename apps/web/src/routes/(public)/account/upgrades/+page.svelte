<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { upgradeStatusLabel } from '$lib/room-upgrades';
	let { data } = $props();
</script>
<svelte:head><title>{m.upgrade_list_page_title()}</title></svelte:head>
<h2 class="text-xl text-brand-900">{m.upgrade_heading()}</h2>
<p class="mt-2 text-sm text-stone-600">{m.upgrade_list_intro()}</p>
{#if !data.enabled}<p class="mt-5 text-stone-500">{m.upgrade_list_disabled()}</p>{/if}
{#if data.offers.length === 0}<p class="mt-6 rounded-xl bg-stone-50 p-5 text-stone-600">{m.upgrade_list_empty()}</p>{/if}
<div class="mt-6 space-y-4">
	{#each data.offers as o (o.id)}
		<a href="/account/upgrades/{o.id}" class="block rounded-xl border border-stone-200 bg-white p-5 hover:border-brand-800">
			<p class="text-xs text-stone-500">{m.upgrade_booking_ref({ facility: o.facility_name, code: o.booking_code, n: String(o.room_index) })}</p>
			<h3 class="mt-2 font-semibold text-brand-900">{o.title}</h3>
			<p class="mt-2 text-sm">{m.upgrade_list_dates_rooms({ checkin: o.checkin, checkout: o.checkout, source: o.source_name, target: o.target_name ?? m.upgrade_target_unpublished() })}</p>
			<p class="mt-2 text-sm">{m.upgrade_list_total({ amount: o.total.toLocaleString(), payment: o.payment_mode === 'online' ? m.upgrade_payment_online() : m.upgrade_payment_onsite() })}</p>
			<span class="mt-3 inline-block rounded-full bg-stone-100 px-3 py-1 text-xs">{o.status === 'offered' && !o.eligible ? m.upgrade_status_closed_or_changed() : upgradeStatusLabel(o.status)}</span>
		</a>
	{/each}
</div>
