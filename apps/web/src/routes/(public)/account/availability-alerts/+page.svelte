<script lang="ts">
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import { alertStatusLabel } from '$lib/availability-alerts';

	let { data, form } = $props();
	let showPast = $state(false);
	const visible = $derived(data.alerts.filter((alert) => (alert.checkin < data.today) === showPast));
</script>

<svelte:head><title>{m.account_alerts_page_title()}</title></svelte:head>
<h2 class="text-xl text-brand-900">{m.account_alerts_heading()}</h2>
<p class="mt-2 text-sm text-stone-600">{m.account_alerts_intro()}</p>

{#if form?.message}<p role="status" class="mt-4 rounded-lg p-3 text-sm {form.success ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}">{form.message}</p>{/if}
{#if !data.enabled}
	<p class="mt-6 rounded-xl bg-stone-100 p-5">{m.account_alerts_disabled()}</p>
{:else if data.loadError}
	<p role="alert" class="mt-6 rounded-xl bg-red-50 p-5 text-red-700">{m.account_alerts_load_error()}</p>
{:else}
	<div class="mt-5 flex gap-2" role="group" aria-label={m.account_alerts_filter_label()}>
		<button type="button" onclick={() => (showPast = false)} aria-pressed={!showPast} class="min-h-11 rounded-lg px-4 text-sm {showPast ? 'border border-stone-300' : 'bg-brand-800 text-white'}">{m.account_alerts_filter_upcoming()}</button>
		<button type="button" onclick={() => (showPast = true)} aria-pressed={showPast} class="min-h-11 rounded-lg px-4 text-sm {showPast ? 'bg-brand-800 text-white' : 'border border-stone-300'}">{m.account_alerts_filter_past()}</button>
	</div>
	{#if visible.length === 0}<p class="mt-4 text-sm text-stone-500">{showPast ? m.account_alerts_empty_past() : m.account_alerts_empty_upcoming()}</p>{/if}
	<div class="mt-3 space-y-3">
		{#each visible as a (a.id)}
			{@const f = data.facilities.find((f) => f.id === a.facility_id)}
			<article class="rounded-xl border border-stone-200 bg-white p-5">
				<div class="flex flex-wrap items-center justify-between gap-2"><h4 class="font-semibold">{f?.name ?? m.common_facility()}</h4><span class="rounded-full bg-stone-100 px-3 py-1 text-xs">{a.status === 'active' && a.checkin <= data.today ? m.account_alerts_status_expired() : alertStatusLabel(a.status)}</span></div>
				<p class="mt-2 text-sm">{m.account_alerts_conditions({ checkin: a.checkin, nights: String(a.nights), rooms: String(a.room_count), adults: String(a.adults) })}</p>
				<p class="mt-1 text-sm text-stone-600">{m.account_alerts_room_plan({
					room: a.room_type_id ? f?.rooms.find((r) => r.id === a.room_type_id)?.name ?? m.account_alerts_room_unpublished() : m.account_alerts_unspecified(),
					plan: a.rate_plan_id ? f?.plans.find((p) => p.id === a.rate_plan_id)?.name ?? m.account_alerts_plan_unpublished() : m.account_alerts_unspecified()
				})}</p>
				<p class="mt-1 text-sm text-stone-600">{m.account_alerts_budget({ budget: a.max_total ? m.account_alerts_budget_max({ amount: a.max_total.toLocaleString() }) : m.account_alerts_budget_none() })}</p>
				<form method="POST" action="?/remove" use:enhance class="mt-3"><input type="hidden" name="id" value={a.id} /><button class="min-h-11 rounded-lg border border-stone-300 px-4 text-sm">{m.account_alerts_delete()}</button></form>
				{#if a.status === 'notified'}<p class="mt-3 text-xs text-stone-500">{m.account_alerts_notified_note()}</p>{/if}
				{#if a.status === 'failed'}<p class="mt-3 text-xs text-red-700">{m.account_alerts_failed_note()}</p>{/if}
			</article>
		{/each}
	</div>
{/if}
