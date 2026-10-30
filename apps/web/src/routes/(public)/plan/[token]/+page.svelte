<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head>
	<title>{m.plan_link_invalid_title()}</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-xl px-4 py-16 text-center">
	<h1 class="font-display text-2xl text-brand-900">{m.plan_link_invalid_title()}</h1>
	<p class="mt-3 text-sm text-stone-600">{m.plan_link_invalid_body()}</p>
	<p class="mt-6">
		<a href="/" class="inline-block rounded-lg bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700">{m.plan_link_invalid_top()}</a>
	</p>
</div>
