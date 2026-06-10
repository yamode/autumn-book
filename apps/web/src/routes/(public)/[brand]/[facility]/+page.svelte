<script lang="ts">
	// 施設HP: facility.template でデザインテンプレートを切替（施設ごとに別デザイン運用）
	import StandardTemplate from '$lib/templates/StandardTemplate.svelte';
	import YamadoV1Template from '$lib/templates/YamadoV1Template.svelte';
	import OgaV1Template from '$lib/templates/OgaV1Template.svelte';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let f = $derived(data.facility);

	let jsonLd = $derived(
		JSON.stringify({
			'@context': 'https://schema.org',
			'@type': 'Hotel',
			name: f.name,
			address: f.addressPublic,
			telephone: f.phone,
			geo: { '@type': 'GeoCoordinates', latitude: f.lat, longitude: f.lng },
			checkinTime: f.checkinTime,
			checkoutTime: f.checkoutTime
		})
	);
</script>

<svelte:head>
	<title>{m.facility_title({ name: f.name })}</title>
	<meta name="description" content={f.catchCopy} />
	<meta property="og:image" content={f.photos[0].url} />
	{@html `<script type="application/ld+json">${jsonLd}<\/script>`}
</svelte:head>

{#if f.template === 'yamado-v1'}
	<YamadoV1Template {data} />
{:else if f.template === 'oga-v1'}
	<OgaV1Template {data} />
{:else}
	<StandardTemplate {data} />
{/if}

<!-- チャットウィジェット（P1=FAQ誘導のみ・P9でLLM化） -->
<a
	href="#access"
	onclick={(e) => {
		e.preventDefault();
		document.querySelector('details')?.scrollIntoView({ behavior: 'smooth' });
	}}
	class="fixed bottom-6 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-brand-800 text-xl text-white shadow-lg hover:bg-brand-700"
	title={m.facility_chat_title()}
>
	💬
</a>
