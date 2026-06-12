<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	// 未ログイン向けの会員登録 CTA バナー + 下部の施設・空室導線（設計書 §6）。
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
	<div class="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
		<p class="text-sm text-stone-700">{m.forum_cta_banner()}</p>
		<div class="mt-3 flex flex-wrap gap-2">
			<a href="/auth/register" class="rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500">{m.forum_cta_register()}</a>
			<a href="/auth/login" class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">{m.forum_cta_login()}</a>
		</div>
	</div>
{/if}

{#if facilities.length}
	<section class="mt-10 rounded-2xl border border-stone-200 bg-stone-50 p-5">
		<h2 class="mb-3 font-medium text-brand-900">{m.forum_cta_facilities_heading()}</h2>
		<div class="grid gap-3 sm:grid-cols-2">
			{#each facilities as f}
				<a href="/{f.brandSlug}/{f.slug}" class="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm hover:shadow-sm">
					<span class="font-medium text-brand-900">{f.name}</span>
					<span class="text-xs text-stone-400">{m.forum_cta_facility_visit()} →</span>
				</a>
			{/each}
		</div>
		<a href="/search" class="mt-3 inline-block rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">{m.forum_cta_search()}</a>
	</section>
{/if}
