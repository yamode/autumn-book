<script lang="ts">
	import { page } from '$app/state';
	import VersionBadge from '$lib/components/VersionBadge.svelte';

	let { data, children } = $props();

	// 「誰が・何をきっかけに操作するか」でグループ化する（docs/ADMIN_APP_OPS.md §2）。
	// 1項目は1箇所にしか置かない。両属性の項目は画面内の相互リンクで辿らせる。
	// tenantWide = 施設に紐づかない画面（施設セレクトを出すと「切り替えても変わらない」混乱を生む）
	const navGroups: { label: string; items: { href: string; label: string; icon: string; tenantWide?: boolean }[] }[] = [
		{
			label: '宿泊・直販',
			items: [
				{ href: '/admin', label: 'ダッシュボード', icon: '📊' },
				{ href: '/admin/reservations', label: '予約管理', icon: '📅' },
				{ href: '/admin/plans', label: 'プラン', icon: '📝' },
				{ href: '/admin/rooms', label: '部屋編集', icon: '🛏' },
				{ href: '/admin/options', label: 'オプション', icon: '🧺' },
				{ href: '/admin/cancel-policies', label: 'キャンセル規定', icon: '🚫', tenantWide: true },
				{ href: '/admin/bath', label: '貸切風呂', icon: '♨️' },
				{ href: '/admin/inroom', label: '客室案内', icon: '📱' }
			]
		},
		{
			label: 'アプリ・会員',
			items: [
				{ href: '/admin/app', label: 'アプリ運用', icon: '📲', tenantWide: true },
				{ href: '/admin/push', label: 'アプリ通知', icon: '🔔', tenantWide: true },
				{ href: '/admin/coupons', label: 'クーポン', icon: '🎫', tenantWide: true },
				{ href: '/admin/preferences', label: '好み登録項目', icon: '🧩', tenantWide: true },
				{ href: '/admin/members', label: '会員', icon: '👤', tenantWide: true },
				{ href: '/admin/community', label: 'コミュニティ', icon: '💬', tenantWide: true },
				{ href: '/admin/otayori', label: 'おたより', icon: '📨', tenantWide: true }
			]
		},
		{
			label: 'サイト・コンテンツ',
			items: [
				{ href: '/admin/facility', label: '施設ページ編集', icon: '🏠' },
				{ href: '/admin/news', label: 'お知らせ', icon: '📰' },
				{ href: '/admin/faqs', label: 'FAQ', icon: '❓' },
				{ href: '/admin/mail', label: 'メルマガ', icon: '✉' },
				{ href: '/admin/sequences', label: 'ステップメール', icon: '🔁' }
			]
		},
		{
			label: 'システム',
			items: [{ href: '/admin/maintenance', label: 'メンテナンス', icon: '🛠', tenantWide: true }]
		}
	];

	const navItems = navGroups.flatMap((g) => g.items);

	let isLogin = $derived(page.url.pathname === '/admin/login');

	function isActive(href: string) {
		return href === '/admin' ? page.url.pathname === '/admin' : page.url.pathname.startsWith(href);
	}

	// 最長一致で現在地を決める（/admin は他ページの前方一致になるため）
	let activeItem = $derived(
		navItems.filter((i) => isActive(i.href)).sort((a, b) => b.href.length - a.href.length)[0]
	);
	let tenantWide = $derived(activeItem?.tenantWide ?? false);
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>

{#if isLogin}
	{@render children()}
{:else}
	<div class="flex min-h-screen bg-stone-100">
		<aside class="hidden w-56 shrink-0 flex-col bg-brand-900 text-stone-300 md:flex">
			<p class="px-5 py-4 font-display text-lg text-white">山人 <span class="text-xs text-stone-400">管理</span></p>
			<nav class="flex-1 overflow-y-auto px-2 pb-4">
				{#each navGroups as group, gi}
					<p
						class="px-3 pb-1 text-[10px] font-medium tracking-wider text-stone-500 uppercase {gi === 0
							? 'pt-0'
							: 'pt-4'}"
					>
						{group.label}
					</p>
					<div class="space-y-0.5">
						{#each group.items as item}
							<a
								href={item.href}
								class="block rounded-lg px-3 py-2 text-sm transition {item === activeItem
									? 'bg-white/10 font-medium text-white'
									: 'hover:bg-white/5 hover:text-white'}"
							>
								{item.icon} {item.label}
							</a>
						{/each}
					</div>
				{/each}
			</nav>
			<a href="/" class="px-5 py-4 text-xs text-stone-500 hover:text-white">← 顧客サイトへ</a>
		</aside>

		<div class="flex min-w-0 flex-1 flex-col">
			<header class="flex flex-wrap items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5">
				<!-- モバイル用ナビ -->
				<select class="rounded-md border border-stone-300 px-2 py-1.5 text-sm md:hidden" onchange={(e) => (location.href = e.currentTarget.value)}>
					{#each navGroups as group}
						<optgroup label={group.label}>
							{#each group.items as item}
								<option value={item.href} selected={item === activeItem}>{item.label}</option>
							{/each}
						</optgroup>
					{/each}
				</select>

				<!-- 施設切替（設計書 §4.1）。テナント横断の画面では出さない -->
				{#if tenantWide}
					<span class="text-sm text-stone-500">全施設共通</span>
				{:else}
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
				{/if}

				<div class="ml-auto flex items-center gap-3 text-sm">
					<span class="text-stone-500">{data.user?.name}（{data.user?.role === 'admin' ? '管理者' : 'スタッフ'}）</span>
					<form method="POST" action="/auth/logout">
						<button type="submit" class="text-xs text-stone-400 hover:text-stone-600">ログアウト</button>
					</form>
				</div>
			</header>

			{#if data.maintenanceActive}
				<a href="/admin/maintenance" class="block bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white hover:bg-amber-600">
					🛠 メンテナンスモード有効 — 一般ユーザーへ非公開中（運営はプレビュー可）
				</a>
			{/if}

			<main class="min-w-0 flex-1 p-4 md:p-6">
				{@render children()}
			</main>
		</div>
	</div>
{/if}

<!-- ログイン画面含め管理画面のどのページでも常時見えるバージョン表記 -->
<VersionBadge />
