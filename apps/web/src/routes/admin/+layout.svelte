<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import VersionBadge from '$lib/components/VersionBadge.svelte';
	import Toast from '$lib/components/admin/Toast.svelte';

	let { data, children } = $props();

	// 「誰が・何をきっかけに操作するか」でグループ化する（docs/ADMIN_APP_OPS.md §2）。
	// 1項目は1箇所にしか置かない。両属性の項目は画面内の相互リンクで辿らせる。
	// tenantWide = 施設に紐づかない画面（施設セレクトを出すと「切り替えても変わらない」混乱を生む）
	// demoOnly = まだ本番データに繋がっていない画面（デモストアを読み書きする）。本番では注意を出し、保存はサーバで止める（lib/server/admin-demo-guard.ts）
	const navGroups: { label: string; items: { href: string; label: string; icon: string; tenantWide?: boolean; demoOnly?: boolean }[] }[] = [
		{
			label: '宿泊・直販',
			items: [
				{ href: '/admin', label: 'ダッシュボード', icon: '📊' },
				{ href: '/admin/reservations', label: '予約管理', icon: '📅' },
				{ href: '/admin/partners', label: '取引先', icon: '🤝' },
				{ href: '/admin/plans', label: 'プラン', icon: '📝' },
				{ href: '/admin/rooms', label: '部屋編集', icon: '🛏' },
				{ href: '/admin/options', label: 'オプション', icon: '🧺', demoOnly: true },
				{ href: '/admin/cancel-policies', label: 'キャンセル規定', icon: '🚫', tenantWide: true, demoOnly: true },
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
				{ href: '/admin/facility', label: '施設ページ編集', icon: '🏠', demoOnly: true },
				{ href: '/admin/news', label: 'お知らせ', icon: '📰' },
				{ href: '/admin/faqs', label: 'FAQ', icon: '❓', demoOnly: true },
				{ href: '/admin/mail', label: 'メルマガ', icon: '✉', demoOnly: true },
				{ href: '/admin/sequences', label: 'ステップメール', icon: '🔁', demoOnly: true }
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
	// 本番（実データ）なのに、デモストアしか読み書きしない画面を開いている
	let live = $derived(data.dataSource === 'supabase');
	let demoOnlyHere = $derived(live && (activeItem?.demoOnly ?? false));

	// 施設ごとの色（別施設の編集事故を防ぐため、どの施設を触っているかを色でも見せる）
	const FACILITY_TONES = ['bg-brand-800 text-white', 'bg-accent-600 text-white', 'bg-sky-700 text-white'];
	let facilityTone = $derived(
		FACILITY_TONES[Math.max(0, data.facilities.findIndex((f) => f.id === data.currentFacility.id)) % FACILITY_TONES.length]
	);

	// モバイルのメニュー（ドロワー）
	let menuOpen = $state(false);

	// ---- 未保存の変更の離脱ガード（管理画面の全フォーム共通）----
	// main 内の POST フォームに入力があったら「未保存」とし、送信で解除する。GET の絞り込みフォームは対象外。
	// 個別画面に手を入れずに全画面へ効かせるため、レイアウトでイベントを拾う。
	const dirtyForms = new Set<HTMLFormElement>();
	function postFormOf(t: EventTarget | null): HTMLFormElement | null {
		const f = t instanceof Element ? t.closest('form') : null;
		if (!f || f.method.toLowerCase() !== 'post' || f.dataset.noGuard !== undefined) return null;
		return f;
	}
	function markDirty(e: Event) {
		const f = postFormOf(e.target);
		if (f) dirtyForms.add(f);
	}
	function markClean(e: Event) {
		const f = postFormOf(e.target);
		if (f) dirtyForms.delete(f);
	}
	beforeNavigate((nav) => {
		for (const f of dirtyForms) if (!f.isConnected) dirtyForms.delete(f);
		if (dirtyForms.size === 0 || nav.type === 'form') return;
		// タブを閉じる・再読み込み（leave）はブラウザ標準の確認を出す
		if (nav.type === 'leave') {
			nav.cancel();
			return;
		}
		if (!confirm('保存していない変更があります。このページを離れますか？')) nav.cancel();
	});
	afterNavigate(() => {
		dirtyForms.clear();
		menuOpen = false;
	});
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>

{#snippet navList()}
	{#each navGroups as group, gi}
		<p class="px-3 pb-1 text-[10px] font-medium tracking-wider text-stone-500 uppercase {gi === 0 ? 'pt-0' : 'pt-4'}">
			{group.label}
		</p>
		<div class="space-y-0.5">
			{#each group.items as item}
				<a
					href={item.href}
					aria-current={item === activeItem ? 'page' : undefined}
					class="block rounded-lg px-3 py-2 text-sm transition {item === activeItem
						? 'bg-white/10 font-medium text-white'
						: 'hover:bg-white/5 hover:text-white'}"
				>
					{item.icon} {item.label}
					{#if item.tenantWide}<span class="ml-1 rounded bg-white/5 px-1 text-[10px] text-stone-500">全施設</span>{/if}
					{#if live && item.demoOnly}<span class="ml-1 rounded bg-white/10 px-1 text-[10px] text-stone-400">未接続</span>{/if}
				</a>
			{/each}
		</div>
	{/each}
{/snippet}

{#if isLogin}
	{@render children()}
{:else}
	<div class="flex min-h-screen bg-stone-100">
		<aside class="sticky top-0 hidden h-screen w-56 shrink-0 flex-col bg-brand-900 text-stone-300 md:flex">
			<p class="px-5 pt-4 font-display text-lg text-white">山人 <span class="text-xs text-stone-400">管理</span></p>
			<p class="mx-5 mt-2 mb-3 truncate rounded px-2 py-1 text-xs font-medium ring-1 ring-white/20 {facilityTone}" title="いま操作している施設">
				{tenantWide ? '全施設共通' : data.currentFacility.name}
			</p>
			<nav class="flex-1 overflow-y-auto px-2 pb-4" aria-label="管理メニュー">
				{@render navList()}
			</nav>
			<a href="/" class="px-5 py-4 text-xs text-stone-500 hover:text-white">← 顧客サイトへ</a>
		</aside>

		<!-- モバイル用ドロワー -->
		{#if menuOpen}
			<div class="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="管理メニュー">
				<button type="button" class="absolute inset-0 bg-black/40" aria-label="メニューを閉じる" onclick={() => (menuOpen = false)}></button>
				<div class="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-brand-900 text-stone-300 shadow-xl">
					<div class="flex items-center justify-between px-5 py-4">
						<p class="font-display text-lg text-white">山人 <span class="text-xs text-stone-400">管理</span></p>
						<button type="button" class="text-2xl leading-none text-stone-400 hover:text-white" aria-label="メニューを閉じる" onclick={() => (menuOpen = false)}>×</button>
					</div>
					<nav class="flex-1 overflow-y-auto px-2 pb-4">
						{@render navList()}
					</nav>
					<a href="/" class="px-5 py-4 text-xs text-stone-500 hover:text-white">← 顧客サイトへ</a>
				</div>
			</div>
		{/if}

		<div class="flex min-w-0 flex-1 flex-col">
			<!-- 上部バーはスクロールしても残す（施設切替・メンテナンス表示を常に見せる） -->
			<div class="sticky top-0 z-30">
				<header class="flex items-center gap-3 border-b border-stone-200 bg-white px-4 py-2.5">
					<button
						type="button"
						class="rounded-md border border-stone-300 px-2.5 py-1.5 text-sm md:hidden"
						aria-label="メニューを開く"
						aria-expanded={menuOpen}
						onclick={() => (menuOpen = true)}
					>
						☰
					</button>
					<span class="truncate text-sm font-medium text-stone-700 md:hidden">{activeItem?.label ?? ''}</span>

					<!-- 施設切替（設計書 §4.1）。テナント横断の画面では出さない -->
					{#if tenantWide}
						<span class="hidden text-sm text-stone-500 sm:inline">全施設共通</span>
					{:else}
						<label class="flex items-center gap-2 text-sm text-stone-500">
							<span class="hidden sm:inline">施設:</span>
							<select
								aria-label="操作する施設"
								class="rounded-md border-0 px-2 py-1.5 text-sm font-medium {facilityTone}"
								onchange={(e) => (location.href = `/admin/switch?f=${e.currentTarget.value}&back=${encodeURIComponent(page.url.pathname)}`)}
							>
								{#each data.facilities as f}
									<option value={f.id} selected={f.id === data.currentFacility.id} class="bg-white text-stone-800">{f.name}</option>
								{/each}
							</select>
						</label>
					{/if}

					<div class="ml-auto flex items-center gap-3 text-sm">
						<span class="hidden text-stone-500 sm:inline">{data.user?.name}（{data.user?.role === 'admin' ? '管理者' : 'スタッフ'}）</span>
						<form method="POST" action="/auth/logout" data-no-guard>
							<button type="submit" class="text-xs text-stone-400 hover:text-stone-600">ログアウト</button>
						</form>
					</div>
				</header>

				{#if data.maintenanceActive}
					<a href="/admin/maintenance" class="block bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white hover:bg-amber-600">
						🛠 メンテナンスモード有効 — 一般ユーザーへ非公開中（運営はプレビュー可）
					</a>
				{/if}
			</div>

			{#if demoOnlyHere}
				<div class="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
					<span class="font-bold">この画面はまだ本番データに繋がっていません。</span>
					表示はサンプルです。保存してもお客様の画面には反映されないため、保存は止めています。
				</div>
			{/if}

			<main class="min-w-0 flex-1 p-4 md:p-6" oninput={markDirty} onchange={markDirty} onsubmit={markClean}>
				{@render children()}
			</main>
		</div>
	</div>
	<Toast />
{/if}

<!-- ログイン画面含め管理画面のどのページでも常時見えるバージョン表記 -->
<VersionBadge />
