<script lang="ts">
	// ヘルプページ（docs/member-support.md「お客様側」）: よくある質問（カテゴリごとに折りたたみ）と、いちばん下の問い合わせフォーム
	import { enhance } from '$lib/enhance';
	import * as m from '$lib/paraglide/messages';
	import Turnstile from '$lib/components/Turnstile.svelte';
	import { groupFaqs, SUPPORT_CATEGORIES, type SupportCategory } from '$lib/support';

	let { data, form } = $props();

	const categoryLabel = (c: string) => {
		const labels: Record<SupportCategory, () => string> = {
			login: m.support_category_login,
			legacy: m.support_category_legacy,
			booking: m.support_category_booking,
			points: m.support_category_points,
			other: m.support_category_other
		};
		return (labels as Record<string, (() => string) | undefined>)[c]?.() ?? m.support_category_other();
	};

	const groups = $derived(groupFaqs(data.faqs));
	const sent = $derived(form && 'sent' in form && form.sent === true ? form : null);
	const failure = $derived(form && 'message' in form && form.message ? { message: String(form.message), field: 'field' in form ? (form.field as string | undefined) : undefined } : null);
	const values = $derived(form && 'values' in form && form.values ? form.values : null);
</script>

<svelte:head><title>{m.help_title()}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="font-display text-2xl text-brand-900">{m.help_heading()}</h1>
	<p class="mt-2 text-sm leading-6 text-stone-600">{m.help_lead()}</p>
	<p class="mt-2 text-sm"><a href="#contact" class="text-accent-600 underline">{m.help_to_form()}</a></p>

	<section class="mt-6" aria-labelledby="faq-heading">
		<h2 id="faq-heading" class="text-lg text-brand-900">{m.help_faq_heading()}</h2>
		{#if groups.length === 0}
			<p class="mt-3 rounded-xl border border-stone-200 bg-white p-5 text-sm text-stone-600">{m.help_faq_empty()}</p>
		{/if}
		{#each groups as g (g.category)}
			<div class="mt-4">
				<h3 class="mb-2 text-sm font-medium text-stone-700">{categoryLabel(g.category)}</h3>
				<div class="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
					{#each g.items as faq (faq.id)}
						<details class="group px-4">
							<summary class="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-medium text-brand-900 [&::-webkit-details-marker]:hidden">
								<span>{faq.question}</span>
								<span aria-hidden="true" class="shrink-0 text-stone-400 transition-transform group-open:rotate-90">›</span>
							</summary>
							<p class="pb-4 text-sm leading-7 whitespace-pre-line text-stone-700">{faq.answer}</p>
						</details>
					{/each}
				</div>
			</div>
		{/each}
		<p class="mt-4 text-xs leading-5 text-stone-500">{m.help_facility_note()}</p>
	</section>

	<section id="contact" class="mt-10 scroll-mt-20" aria-labelledby="contact-heading">
		<h2 id="contact-heading" class="text-lg text-brand-900">{m.support_form_heading()}</h2>
		<p class="mt-2 text-sm leading-6 text-stone-600">{m.support_form_lead()}</p>

		{#if sent}
			<div class="mt-4 space-y-3 rounded-2xl border border-stone-200 bg-white p-6 text-sm leading-6 text-stone-700" role="status">
				<p class="font-medium text-brand-900">{m.support_sent_heading()}</p>
				<p class="font-mono text-base text-brand-900">{m.support_sent_code({ code: sent.code })}</p>
				<p>{m.support_sent_body({ email: sent.email })}</p>
				<p class="text-xs text-stone-500">{m.support_sent_note()}</p>
				{#if sent.demo}<p class="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{m.support_demo_note()}</p>{/if}
			</div>
		{:else}
			{#if failure}
				<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{failure.message}</p>
			{/if}
			<form method="POST" action="?/submit#contact" use:enhance class="mt-4 space-y-4 rounded-2xl border border-stone-200 bg-white p-6">
				<label class="block text-sm">
					<span class="text-stone-600">{m.support_name_label()} <span class="text-red-500">*</span></span>
					<input name="name" autocomplete="name" maxlength="100" required value={values?.name ?? data.prefill.name}
						class="mt-1 w-full rounded-md border px-3 py-2 {failure?.field === 'name' ? 'border-red-400' : 'border-stone-300'}" />
				</label>
				<label class="block text-sm">
					<span class="text-stone-600">{m.support_email_label()} <span class="text-red-500">*</span></span>
					<input type="email" name="email" autocomplete="email" maxlength="254" required value={values?.email ?? data.prefill.email} placeholder="mail@example.com"
						class="mt-1 w-full rounded-md border px-3 py-2 {failure?.field === 'email' ? 'border-red-400' : 'border-stone-300'}" />
				</label>
				<label class="block text-sm">
					<span class="text-stone-600">{m.support_category_label()} <span class="text-red-500">*</span></span>
					<select name="category" required class="mt-1 w-full rounded-md border bg-white px-3 py-2 {failure?.field === 'category' ? 'border-red-400' : 'border-stone-300'}">
						<option value="" selected={!values?.category}>{m.support_category_placeholder()}</option>
						{#each SUPPORT_CATEGORIES as c (c)}
							<option value={c} selected={values?.category === c}>{categoryLabel(c)}</option>
						{/each}
					</select>
				</label>
				<label class="block text-sm">
					<span class="text-stone-600">{m.support_subject_label()} <span class="text-xs text-stone-400">（{m.common_optional()}）</span></span>
					<input name="subject" maxlength="200" value={values?.subject ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
				</label>
				<label class="block text-sm">
					<span class="text-stone-600">{m.support_body_label()} <span class="text-red-500">*</span></span>
					<textarea name="body" rows="7" maxlength="10000" required placeholder={m.support_body_placeholder()} value={values?.body ?? ''}
						class="mt-1 w-full rounded-md border px-3 py-2 {failure?.field === 'body' ? 'border-red-400' : 'border-stone-300'}"></textarea>
				</label>
				<label class="flex cursor-pointer items-start gap-2 text-sm">
					<input type="checkbox" name="privacyConsent" required class="mt-0.5 h-4 w-4 shrink-0" />
					<span class="text-stone-700"><a href="/legal/privacy" target="_blank" rel="noopener" class="underline">{m.register_privacy_link()}</a>{m.migrate_consent_post()}</span>
				</label>
				<Turnstile action="support-submit" />
				<button type="submit" class="w-full rounded-lg bg-accent-600 py-2.5 font-medium text-white hover:bg-accent-500">{m.support_submit()}</button>
			</form>
			<!-- 迷惑メールを避けるため、ページにはメールアドレスを出さない（2026-11-22 指示） -->
		{/if}
	</section>
</div>
