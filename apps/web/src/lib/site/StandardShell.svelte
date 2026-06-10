<script lang="ts">
	// 標準シェル（新施設の既定）— シンプルな施設ヘッダー + 共通機能への導線
	import { page } from '$app/state';
	import SearchBar from '$lib/components/SearchBar.svelte';
	import type { ShellFacility, ShellUser } from './types';

	let { facility, user, children }: { facility: ShellFacility; user: ShellUser; children: any } = $props();
	let base = $derived(`/${facility.brandSlug}/${facility.slug}`);
	let showSearch = $derived(/\/(plans|rooms)/.test(page.url.pathname));
</script>

<div class="flex min-h-screen flex-col bg-stone-50">
	<header class="sticky top-0 z-50 border-b border-stone-200 bg-white/95 backdrop-blur">
		<div class="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
			<a href={base} class="font-display text-lg font-bold text-brand-900">{facility.name}</a>
			<nav class="ml-auto flex items-center gap-4 text-sm text-stone-600">
				<a href="{base}/plans" class="hover:text-brand-800">プラン</a>
				<a href="{base}/news" class="hover:text-brand-800">お知らせ</a>
				<a href={user?.role === 'member' ? '/account' : '/auth/login'} class="hover:text-brand-800">{user?.role === 'member' ? `${user.name} 様` : 'ログイン'}</a>
				<a href="{base}/plans" class="rounded-md bg-accent-600 px-4 py-1.5 text-white hover:bg-accent-500">ご予約</a>
			</nav>
		</div>
	</header>
	<main class="flex-1">
		{#if showSearch}
			<div class="border-b border-stone-200 bg-white">
				<div class="mx-auto max-w-6xl px-4 py-3">
					<SearchBar
						action="{base}/plans"
						checkin={page.url.searchParams.get('checkin') ?? ''}
						nights={Number(page.url.searchParams.get('nights') ?? 1)}
						adults={Number(page.url.searchParams.get('adults') ?? 2)}
					/>
				</div>
			</div>
		{/if}
		{@render children()}
	</main>
	<footer class="mt-16 border-t border-stone-200 bg-brand-900 py-8 text-center text-xs text-stone-400">
		<p>{facility.name} ｜ {facility.addressPublic} ｜ TEL {facility.phone}</p>
		<p class="mt-2">
			<a href="/legal/tokushoho" class="hover:underline">特商法表記</a> ・
			<a href="/legal/privacy" class="hover:underline">プライバシーポリシー</a> ・
			<a href="/legal/yakkan" class="hover:underline">宿泊約款</a>
		</p>
	</footer>
</div>
