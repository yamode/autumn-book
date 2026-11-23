<script lang="ts">
	import { enhance } from '$lib/enhance';
	import PageLoadingSkeleton from '$lib/components/PageLoadingSkeleton.svelte';
	import RadioEpisodes from '$lib/components/RadioEpisodes.svelte';
	import * as m from '$lib/paraglide/messages';
	import { fadeIn } from '$lib/fade-in';

	let { data, form } = $props();
	let sending = $state(false);
	const playlistUrl = $derived(`https://www.youtube.com/playlist?list=${data.playlist}`);
	const body = $derived(form && 'body' in form ? String(form.body ?? '') : '');
</script>

<svelte:head><title>{m.radio_title()} ｜ 山人</title></svelte:head>

<div class="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
	<header class="mb-8 border-b border-stone-200 pb-6">
		<h1 class="font-display text-3xl text-brand-900 sm:text-4xl">{m.radio_title()}</h1>
		<a href="#letter" class="mt-4 inline-flex min-h-11 items-center rounded-lg bg-brand-800 px-4 text-sm font-medium text-white hover:bg-brand-700 lg:hidden">{m.radio_letter_title()}</a>
	</header>

	<div class="grid items-start gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
		<section aria-labelledby="radio-episodes">
			<div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
				<h2 id="radio-episodes" class="text-xl text-brand-900">{m.radio_episodes()}</h2>
				<a href={playlistUrl} class="text-sm font-medium text-brand-800 underline underline-offset-4">{m.radio_youtube()}</a>
			</div>
			{#await data.episodes}
				<PageLoadingSkeleton kind="videos" title={m.radio_episodes()} />
			{:then first}
				<!-- 回の一覧の枠（シマー）のあとは、一覧をふわっと出す（一覧の中の回ごとのフェードは「もっと見る」のときだけ） -->
				<div in:fadeIn>
					{#if first?.items.length}
						{#key first}<RadioEpisodes initial={first} playlist={data.playlist} />{/key}
					{:else}
						<p class="text-sm text-stone-600">{m.radio_unavailable()}</p>
					{/if}
				</div>
			{/await}
		</section>

		<section id="letter" aria-labelledby="radio-letter" class="scroll-mt-28 rounded-2xl border border-stone-200 bg-white p-4 sm:p-6">
			<h2 id="radio-letter" class="text-xl text-brand-900">{m.radio_letter_title()}</h2>
			{#if data.staff}
				<p class="mt-3 text-sm text-stone-600">{m.otayori_staff_no_post()}</p>
			{:else}
				<p class="mt-2 text-sm leading-6 text-stone-600">{m.radio_letter_note()}</p>
				{#if !data.member}
					<!-- おたよりの投稿は会員だけ（紹介されたときのポイントは会員にしか付けられないため・2026-11-23） -->
					<div class="mt-4 rounded-xl bg-[#f6f3ec] p-4">
						<p class="text-sm leading-6 text-stone-700">{m.otayori_cta_banner()}</p>
						<div class="mt-3 flex flex-wrap gap-2">
							<a href="/auth/register?next=%2Fkitakaze%23letter" class="inline-flex min-h-10 items-center rounded-full bg-accent-600 px-4 text-sm font-medium text-white hover:bg-accent-500">{m.otayori_cta_register()}</a>
							<a href="/auth/login?next=%2Fkitakaze%23letter" class="inline-flex min-h-10 items-center rounded-full border border-stone-300 bg-white px-4 text-sm text-stone-700 hover:bg-stone-50">{m.otayori_cta_login()}</a>
						</div>
					</div>
				{:else if form?.submitted}
					<p role="status" class="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{m.radio_sent()}</p>
					<a href="/account/coupons#otayori" class="mt-3 inline-block text-sm text-brand-800 underline">{m.otayori_thanks_mypage()}</a>
				{:else}
					{#if form?.message}<p role="alert" class="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{form.message}</p>{/if}
					<form method="POST" action="?/submit#letter" enctype="multipart/form-data" class="mt-4 space-y-4"
						use:enhance={({ cancel }) => {
							if (sending) return cancel();
							sending = true;
							return async ({ update }) => { try { await update(); } finally { sending = false; } };
						}}>
						<dl class="rounded-lg bg-stone-50 px-3 py-2.5 text-sm">
							<dt class="text-stone-600">{m.otayori_radio_label()}</dt>
							<dd class="mt-1 break-words font-medium text-brand-900">
								{#if data.nickname}{data.nickname}{:else if data.nickname === null}{m.radio_submit_failed()}{:else}
									<a href="/account/community?next=%2Fkitakaze%23letter" class="underline underline-offset-4">{m.radio_nickname_required()}</a>
								{/if}
							</dd>
						</dl>
						<label class="block text-sm">
							<span>{m.otayori_body_label()}</span>
							<textarea name="body" rows="6" required maxlength="2000" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2">{body}</textarea>
						</label>
						<label class="block text-sm">
							<span>{m.radio_file_label()}</span>
							<input name="media" type="file" accept={data.accept} multiple aria-describedby="radio-file-note" class="mt-1 block w-full text-xs file:mr-2 file:min-h-10 file:rounded-lg file:border-0 file:bg-stone-100 file:px-2 file:text-sm" />
						</label>
						<p id="radio-file-note" class="text-xs leading-5 text-stone-600">{m.radio_file_note()}</p>
						<button type="submit" disabled={sending || !data.nickname} class="min-h-11 w-full rounded-lg bg-brand-800 px-4 py-2.5 font-medium text-white hover:bg-brand-700 disabled:opacity-60">
							{sending ? m.radio_sending() : m.otayori_submit()}
						</button>
					</form>
				{/if}
			{/if}
		</section>
	</div>
</div>
