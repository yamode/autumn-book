<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();

	const facilityName = (slug: string) => (slug === 'nishiwaga' ? m.footer_facility_nishiwaga() : m.footer_facility_oga());
</script>

<svelte:head><title>{m.lookup_title()}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="font-display text-2xl text-brand-900">{m.lookup_title()}</h1>
	<p class="mt-2 text-sm text-stone-600">{m.lookup_lead()}</p>

	<section class="mt-6 rounded-xl border border-stone-200 bg-white p-6">
		<h2 class="text-lg text-brand-900">{m.lookup_official_h()}</h2>
		<p class="mt-2 text-sm text-stone-600">{m.lookup_official_member()}</p>
		<p class="mt-3">
			<a href="/account" class="inline-block rounded-lg bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700">{m.lookup_official_member_btn()}</a>
		</p>
		<p class="mt-4 text-sm text-stone-600">{m.lookup_official_guest()}</p>
	</section>

	{#if data.legacy.kind === 'active'}
		<section class="mt-4 rounded-xl border border-stone-200 bg-white p-6">
			<h2 class="text-lg text-brand-900">{data.legacy.phase === 'current' ? m.lookup_legacy_h_current() : m.lookup_legacy_h_former()}</h2>
			<p class="mt-2 text-sm text-stone-600">{m.lookup_legacy_body()}</p>
			<ul class="mt-3 space-y-2">
				{#each data.legacy.links as link (link.facility)}
					<li>
						<a href={link.url} target="_blank" rel="noopener noreferrer" class="inline-block rounded-lg border border-brand-800 px-5 py-2 text-sm text-brand-900 hover:bg-stone-50"
							>{m.lookup_legacy_btn({ facility: facilityName(link.facility) })} <span aria-hidden="true">↗</span><span class="sr-only">{m.lookup_legacy_external()}</span></a
						>
					</li>
				{/each}
			</ul>
			<p class="mt-3 text-xs text-stone-500">{m.lookup_legacy_note()}</p>
		</section>
	{:else if data.legacy.kind === 'ended'}
		<section class="mt-4 rounded-xl border border-stone-200 bg-white p-6">
			<p class="text-sm text-stone-600">{m.lookup_legacy_ended()}</p>
		</section>
	{/if}

	<section class="mt-4 rounded-xl border border-stone-200 bg-white p-6">
		<h2 class="text-lg text-brand-900">{m.lookup_ota_h()}</h2>
		<p class="mt-2 text-sm text-stone-600">{m.lookup_ota_body()}</p>
	</section>

	<section class="mt-4 rounded-xl border border-stone-200 bg-white p-6">
		<h2 class="text-lg text-brand-900">{m.lookup_phone_h()}</h2>
		<p class="mt-2 text-sm text-stone-600">{m.lookup_phone_body()}</p>
		<ul class="mt-2 space-y-1 text-sm">
			{#each data.phones as p (p.slug)}
				<li>{facilityName(p.slug)}　<a href="tel:{p.phone.replace(/-/g, '')}" class="text-accent-600 underline">{p.phone}</a></li>
			{/each}
		</ul>
	</section>
</div>
