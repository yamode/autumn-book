<script lang="ts">
	import { getLocale } from '$lib/paraglide/runtime';
	import * as m from '$lib/paraglide/messages';

	// 法務系の他ページ（legal/[page]）と同じく、ja 以外では参考訳の注記を出す
	const showTranslationNotice = getLocale() !== 'ja';
	// <strong>・<code>・<a> を含む文は訳文側に HTML を持たせて {@html} で出す（訳文は固定の文言のみ）
</script>

<svelte:head>
	<title>{m.legal_aic_meta_title()}</title>
	<meta name="description" content={m.legal_aic_meta_desc()} />
</svelte:head>

<article class="mx-auto max-w-3xl space-y-7 px-4 py-10">
	<img src="/brand/yamado-connector.png" alt="" width="64" height="64" class="rounded-lg" />
	<h1 class="font-display text-2xl text-brand-900">{m.legal_aic_heading()}</h1>
	{#if showTranslationNotice}
		<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{m.legal_translation_notice()}</p>
	{/if}
	<p>{m.legal_aic_intro()}</p>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">{m.legal_aic_connect_heading()}</h2>
		<ol class="list-decimal space-y-2 pl-5">
			<li>{m.legal_aic_connect_step1()}</li>
			<li>{m.legal_aic_connect_step2()}</li>
			<li>{m.legal_aic_connect_step3()}</li>
		</ol>
		<details>
			<summary class="cursor-pointer">{m.legal_aic_custom_summary()}</summary>
			<p class="mt-2">{@html m.legal_aic_custom_body()}</p>
			<ul class="mt-2 list-disc space-y-2 pl-5">
				<li>{@html m.legal_aic_custom_reservations()}</li>
				<li>{@html m.legal_aic_custom_search()}</li>
			</ul>
		</details>
		<p>{m.legal_aic_preview()}</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">{m.legal_aic_booking_heading()}</h2>
		<p>{m.legal_aic_booking_p1()}</p>
		<p>{m.legal_aic_booking_p2()}</p>
		<p>{m.legal_aic_booking_p3()}</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">{m.legal_aic_muse_heading()}</h2>
		<p>{@html m.legal_aic_muse_p1()}</p>
		<p>{m.legal_aic_muse_p2()}</p>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">{m.legal_aic_contact_heading()}</h2>
		<p>{@html m.legal_aic_contact_p1()}</p>
		<p>{@html m.legal_aic_contact_p2()}</p>
	</section>
</article>
