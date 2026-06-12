<script lang="ts">
	import { page } from '$app/state';

	let { data, children } = $props();

	const nav = [
		{ href: '/admin', label: 'ダッシュボード', icon: '📊' },
		{ href: '/admin/reservations', label: '予約管理', icon: '📅' },
		{ href: '/admin/facility', label: '施設ページ編集', icon: '🏠' },
		{ href: '/admin/rooms', label: '部屋編集', icon: '🛏' },
		{ href: '/admin/plans', label: 'プラン', icon: '📝' },
		{ href: '/admin/news', label: 'お知らせ', icon: '📰' },
		{ href: '/admin/mail', label: 'メルマガ', icon: '✉' },
		{ href: '/admin/sequences', label: 'ステップメール', icon: '🔁' },
		{ href: '/admin/members', label: '会員', icon: '👤' },
		{ href: '/admin/faqs', label: 'FAQ', icon: '❓' },
		{ href: '/admin/community', label: 'コミュニティ', icon: '💬' }
	];

	let isLogin = $derived(page.url.pathname === '/admin/login');

	function isActive(href: string) {
		return href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);
	}
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>

{#if isLogin}
	{@render children()}
{:else}
	<div class="flex min-h-screen bg-stone-100">
		<aside class="hidden w-56 shrink-0 flex-col bg-brand-900 text-stone-300 md:flex">
			<p class="px-5 py-4 font-display text-lg text-white">山人 <span class="text-xs text-stone-400">管理</span></p>
			<nav class="flex-1 space-y-0.5 px-2">
				{#each nav as item}
					<a
						href={item.href}
						class="block rounded-lg px-3 py-2 text-sm transition {isActive(item.href)
							? 'bg-white/10 font-medium text-white'
							: 'hover:bg-white/5 hover:text-white'}"
					>
						{item.icon} {item.label}
					</a>
				{/each}
			</nav>
			<a href="/" class="px-5 py-4 text-xs text-stone-500 hover:text-white">← 顧客サイトへ</a>
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5">
				<!-- モバイル用ナビ -->
				<select class="rounded-md border border-stone-300 px-2 py-1.5 text-sm md:hidden" onchange={(e) => (location.href = e.currentTarget.value)}>
					{#each nav as item}
						<option value={item.href} selected={isActive(item.href)}>{item.label}</option>
					{/each}
				</select>

				<!-- 施設切替（設計書 §4.1） -->
				<label class="flex items-center gap-2 text-sm text-stone-500">
					施設:
					<select
						class="rounded-md border border-stone-300 px-2 py-1.5 text-sm font-medium text-stone-800"
						onchange={(e) => (location.href = `/admin/switch?f=${e.currentTarget.value}&back=${encodeURIComponent(page.url.pathname)}`)}
					>
						{#each data.facilities as f}
							<option value={f.id} selected={f.id === data.currentFacility.id}>{f.name}</option>
						{/each}
					</select>
				</label>

				<div class="ml-auto flex items-center gap-3 text-sm">
					<span class="text-stone-500">{data.user?.name}（{data.user?.role === 'admin' ? '管理者' : 'スタッフ'}）</span>
					<form method="POST" action="/auth/logout">
						<button type="submit" class="text-xs text-stone-400 hover:text-stone-600">ログアウト</button>
					</form>
				</div>
			</header>

			<main class="min-w-0 flex-1 p-4 md:p-6">
				{@render children()}
			</main>
		</div>
	</div>
{/if}
