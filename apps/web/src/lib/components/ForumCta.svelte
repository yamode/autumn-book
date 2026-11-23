<script lang="ts">
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';

	// 未ログイン向けの会員登録の案内 + 下部の施設・空室への導線（設計書 §6）。
	// 施設 URL は store から渡される brandSlug/slug で動的生成（ハードコードしない）。
	let {
		showBanner = true,
		facilities = []
	}: {
		showBanner?: boolean;
		facilities?: { name: string; brandSlug: string; slug: string }[];
	} = $props();
</script>

{#if showBanner}
	<div class="cta-banner mb-8">
		<span class="cta-icon" aria-hidden="true">
			<svg viewBox="0 0 24 24" class="h-5 w-5"><path fill="currentColor" d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.4 3.3A1 1 0 0 1 5 18.5V16a2.5 2.5 0 0 1-1-2v-7.5Z" /></svg>
		</span>
		<p class="min-w-0 flex-1 text-sm leading-6 text-stone-700">{m.forum_cta_banner()}</p>
		<div class="flex shrink-0 flex-wrap gap-2">
			<a href="/auth/register" class="inline-flex min-h-10 items-center rounded-full bg-accent-600 px-4 text-sm font-medium text-white transition hover:bg-accent-500">{m.forum_cta_register()}</a>
			<a href="/auth/login?next={encodeURIComponent(page.url.pathname + page.url.search)}" class="inline-flex min-h-10 items-center rounded-full border border-stone-300 bg-white px-4 text-sm text-stone-700 transition hover:bg-stone-50">{m.forum_cta_login()}</a>
		</div>
	</div>
{/if}

{#if facilities.length}
	<section class="mt-14 rounded-2xl border border-stone-200 bg-[#faf8f4] p-5 sm:p-6">
		<h2 class="mb-4 font-medium text-brand-900">{m.forum_cta_facilities_heading()}</h2>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each facilities as f}
				<a href="/{f.brandSlug}/{f.slug}/plans" class="group flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3.5 text-sm transition hover:border-stone-300 hover:shadow-sm">
					<span class="font-medium text-brand-900">{f.name}</span>
					<span class="text-xs text-stone-500 transition group-hover:text-brand-800">{m.home_list_view_plans()} →</span>
				</a>
			{/each}
		</div>
		<a href="/search" class="mt-4 inline-flex min-h-11 items-center rounded-full bg-brand-800 px-5 text-sm font-medium text-white transition hover:bg-brand-700">{m.forum_cta_search()}</a>
	</section>
{/if}

<style>
	.cta-banner {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.875rem 1rem;
		padding: 1rem 1.125rem;
		border: 1px solid #ecdcb5;
		border-radius: 1rem;
		background: linear-gradient(120deg, #fffdf8 0%, #fcf6e7 100%);
	}
	.cta-icon {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		flex-shrink: 0;
		border-radius: 9999px;
		background: #fff;
		color: var(--color-accent-600);
		box-shadow: 0 0 0 1px #ecdcb5;
	}
</style>
