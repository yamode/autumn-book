<script lang="ts">
	import { navigating, page } from '$app/state';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { APP_VERSION } from '$lib/version';
	import AutumnBookLogo from '$lib/components/admin/AutumnBookLogo.svelte';
	// 統合ヘッダー（ロゴ＋PMS/RMS/Order/Book のタブ・autumn-shared から写したもの・2026-10-28）。
	// 設計: autumn-pms/desktop/docs/integrated-header-design.md §6.5。サイドバーの AppSwitcher はこれに置き換えた
	import AppHeaderTabs from '$lib/autumn-shared/components/AppHeaderTabs.svelte';
	import DesktopShellMenuButton from '$lib/autumn-shared/components/DesktopShellMenuButton.svelte';
	import Toast from '$lib/components/admin/Toast.svelte';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import { ADMIN_NAV, activeNav, visibleNav } from '$lib/admin-nav';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';

	let { data, children } = $props();
	// 上部バーの高さ（サイドバーはこの分だけ下げて、残りの高さに収める）
	let headerH = $state(0);

	// メニューは $lib/admin-nav.ts（2026-10-17 モダン化・メニュー整理）。関係する画面は1項目の下にまとめ、開閉できる
	const navGroups = $derived(visibleNav(data.user?.role));
	// いま開いている画面（項目と、その下の子）。客室案内は ?tab で分ける
	const current = $derived(activeNav(page.url.pathname, page.url.searchParams));
	// 開いている項目（いまの画面の項目は自動で開く。ほかはクリックで開閉）
	let openItems = $state<Record<string, boolean>>({});
	const isOpen = (href: string) => openItems[href] ?? current?.item.href === href;
	function toggle(href: string) {
		openItems = { ...openItems, [href]: !isOpen(href) };
	}

	// ログイン画面と二段階認証のコード入力画面は、メニューを出さない（まだ管理画面に入れていない状態）
	// （/admin/login/reset＝パスワードの再設定もメニューを出さない）
	let isLogin = $derived(page.url.pathname.startsWith('/admin/login') || page.url.pathname.startsWith('/admin/mfa'));
	// 二段階認証が未登録（必須化前）なら、上部で登録を案内する。登録画面を開いている間は出さない
	let showMfaBanner = $derived(
		data.adminMfa.enabled && !data.adminMfa.enrolled && !page.url.pathname.startsWith('/admin/security')
	);

	let tenantWide = $derived(current?.leaf.tenantWide ?? current?.item.tenantWide ?? false);
	// 本番（実データ）なのに、デモストアしか読み書きしない画面を開いている
	let live = $derived(data.dataSource === 'supabase');
	let demoOnlyHere = $derived(live && (current?.leaf.demoOnly ?? false));
	// 画面の上の現在地（グループ › 項目 › 子）
	const crumbs = $derived.by(() => {
		if (!current || current.item.href === '/admin') return [] as string[];
		const group = navGroups.find((g) => g.items.includes(current.item))?.label ?? ADMIN_NAV.find((g) => g.items.some((i) => i.href === current.item.href))?.label;
		const list = [group, current.item.label];
		if (current.item.children && current.leaf.label !== current.item.label) list.push(current.leaf.label);
		return list.filter(Boolean) as string[];
	});

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
		// 画面が独自に離脱確認を持っているときは二重に聞かない（取引先詳細など）
		if (document.querySelector('[data-own-unsaved-guard]')) return;
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

<svelte:head>
	<meta name="robots" content="noindex" />
	<!--
		管理画面の文字・余白を全体に大きく（2026-10-04 指示: 全体的に文字が小さい）。
		基準の文字サイズを 16px → 18px に。Tailwind v4 の文字サイズ・余白は rem なので、画面全体が同じ比率で大きくなる。
		px で直に指定した小さな文字（text-[9px]〜[12px]）は rem に読み替えて一緒に大きくする。
		head に置くので管理画面を開いている間だけ効き、公開サイトへ移ると外れる（サーバ描画から効くのでちらつかない）。
	-->
	<!--
		2026-10-06 指示（見づらい・メインカラムの文字が小さい）: 基準を 17px（ユーザー指定）、いちばん多い補足の文字（text-xs）を一段大きく。
		サイドバーは従来の 18px 相当のまま（zoom 18/17。rem は html 基準なので要素ごとに基準を変えられないため）。
		文字は取引先ページと同じ一休式（OS 標準のゴシック・太さ 400・字間なし）。以前の system-ui は Windows で
		「Yu Gothic UI」（幅の狭い細いラベル用の書体）になり、文章が詰まって薄く見えていた。
		本文側（.admin-main）の灰色を一段濃く（stone-400→500・500→600 の濃さ）。サイドバーは暗い地なので変えない。
		サイドバーのスクロールバーは普段は出さず、メニューにマウスを乗せたときだけ細く薄く出す。
	-->
	<style>
		html {
			font-size: 106.25%;
			font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', 'Hiragino Kaku Gothic ProN', 'Hiragino Sans', sans-serif;
			font-weight: 400;
			letter-spacing: normal;
		}
		.font-display { font-family: inherit; letter-spacing: normal; }
		.text-\[9px\], .text-\[10px\] { font-size: 0.6875rem; }
		.text-\[11px\] { font-size: 0.75rem; }
		.text-\[12px\] { font-size: 0.8125rem; }
		.text-xs { font-size: 0.8125rem; line-height: 1.5; }
		/* 背景・カード・入力欄が同じ白で見分けにくかった（2026-10-06 指摘）: 背景を薄い灰色、カードは白に一段濃い枠と薄い影、
		   入力欄・ボタンの枠も一段濃く。stone の枠線色（200・300）を本文側だけ濃い値に差し替える */
		.admin-main {
			--color-stone-200: oklch(89% 0.005 56);
			--color-stone-300: oklch(81% 0.007 56);
			--color-stone-400: oklch(55.3% 0.013 58.071);
			--color-stone-500: oklch(44.4% 0.011 73.639);
		}
		/* 2026-10-17 モダン化: 画面ごとにばらばらだった見出しの大きさ・太さをそろえる（各画面の h1・カードの h2） */
		.admin-main h1 { font-size: 1.25rem; line-height: 1.4; font-weight: 600; letter-spacing: -0.01em; color: #1c1917; }
		.admin-main :is(section, form, div).rounded-xl > h2:first-child,
		.admin-main :is(section, form, div).rounded-xl > header > h2 { font-weight: 600; color: #292524; }
		/* fieldset は既定で中身より狭くならず、スマホで横にはみ出す（2026-10-17 支払方法で発生）。全画面で縮めるようにする */
		.admin-main fieldset { min-width: 0; }
		/* カードの角を少し丸く・余白をスマホで詰める */
		.admin-main :is(.rounded-xl, .rounded-2xl).border.bg-white { border-radius: 0.875rem; }
		@media (max-width: 639px) {
			.admin-main :is(section, form, div).rounded-xl.border.bg-white.p-4 { padding: 0.875rem; }
			.admin-main .overflow-x-auto { -webkit-overflow-scrolling: touch; }
		}
		.admin-main :is(.rounded-xl, .rounded-2xl).border.bg-white {
			box-shadow: 0 1px 2px rgb(41 37 36 / 0.05), 0 1px 1px rgb(41 37 36 / 0.03);
		}
		/* 入力欄（2026-10-06 指摘・見づらい）: 白いカードの上でも欄の範囲が分かるよう、枠線は白との差 3:1 以上（WCAG 1.4.11）。
		   中は常に白（Tailwind の初期値は透明で、灰色の地では地と同じ色になっていた）。入力できない欄だけ薄い灰色。
		   例文の文字も 4.5:1 以上に。カードの区切り線・表の罫線は薄いまま。
		   枠線は色を直接上書きせず、欄の中でだけ stone-200/300 を濃くする（border-red-* などの状態色はそのまま効く）。
		   中の色は base 層に置き、bg-red-50 などの指定があればそちらを優先。bg-stone-50 の欄は白にそろえる */
		.admin-main :is(input, select, textarea) {
			--color-stone-200: #928c87;
			--color-stone-300: #928c87;
			--color-stone-50: #fff;
		}
		.admin-main :is(input, select, textarea):hover:not(:disabled):not(:focus) {
			--color-stone-200: #6f6964;
			--color-stone-300: #6f6964;
		}
		@layer base {
			.admin-main :is(input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']):not([type='submit']):not([type='button']):not([type='color']), select, textarea) {
				background-color: #fff;
			}
		}
		.admin-main :is(input, select, textarea):is(:disabled, [readonly]) {
			background-color: #f5f4f2;
			border-color: #c5c0bd;
			color: #57534e;
		}
		.admin-main :is(input, textarea)::placeholder {
			color: #75706b;
			opacity: 1;
		}
		.admin-main :is(input:not([type='checkbox']):not([type='radio']):not([type='range']), select, textarea):focus {
			border-color: oklch(44.4% 0.011 73.639);
			box-shadow: 0 0 0 3px rgb(68 64 60 / 0.12);
			outline: none;
		}
		/* zoom は高さ（h-screen=100vh）も同じ倍率にするので、画面いっぱいになるよう割り戻す */
		.admin-sidebar { zoom: 1.0588; top: calc(var(--admin-header-h, 0px) / 1.0588); height: calc((100vh - var(--admin-header-h, 0px)) / 1.0588); }
		/* 保存ボタンの中の状態（$lib/save-state.ts・2026-10-18）。元の文字とアイコンを隠し、data-save-label を出す。
		   ボタンの大きさは中身に合わせて変わる（短い「保存」でも「✓ 保存しました」が収まる） */
		.admin-main [data-save-state] { font-size: 0 !important; gap: 0 !important; }
		.admin-main [data-save-state] > * { display: none !important; }
		.admin-main [data-save-state]::after {
			content: attr(data-save-label);
			font-size: 0.875rem;
			line-height: 1.25rem;
			font-weight: 500;
			white-space: nowrap;
		}
		.admin-main [data-save-state='saving'] { pointer-events: none; opacity: 0.85; cursor: progress; }
		.admin-main [data-save-state='saving']::before {
			content: '';
			display: inline-block;
			width: 0.85rem;
			height: 0.85rem;
			margin-right: 0.4rem;
			vertical-align: -0.12rem;
			border: 2px solid currentColor;
			border-right-color: transparent;
			border-radius: 9999px;
			animation: save-spin 0.7s linear infinite;
		}
		.admin-main [data-save-state='done'] { background-color: #047857 !important; border-color: #047857 !important; color: #fff !important; }
		.admin-main [data-save-state='error'] { background-color: #b91c1c !important; border-color: #b91c1c !important; color: #fff !important; }
		@keyframes save-spin { to { transform: rotate(360deg); } }
		.nav-progress { opacity: 0; animation: nav-progress-in 0s linear 150ms forwards; }
		.nav-progress > div { animation: nav-progress-move 1s ease-in-out infinite; }
		@keyframes nav-progress-in { to { opacity: 1; } }
		@keyframes nav-progress-move { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
		.admin-nav { scrollbar-width: thin; scrollbar-color: transparent transparent; }
		.admin-nav:hover { scrollbar-color: rgb(255 255 255 / 0.22) transparent; }
		.admin-nav::-webkit-scrollbar { width: 6px; }
		.admin-nav::-webkit-scrollbar-track { background: transparent; }
		.admin-nav::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
		.admin-nav:hover::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 0.22); }
	</style>
</svelte:head>

{#snippet navList()}
	{#each navGroups as group, gi (gi)}
		{#if group.label}
			<p class="px-3 pb-1 text-[11px] font-medium tracking-wide text-stone-500 {gi === 0 ? 'pt-0' : 'pt-5'}">{group.label}</p>
		{/if}
		<div class="space-y-0.5">
			{#each group.items as item (item.href + item.label)}
				{@const here = current?.item.href === item.href && current?.item.label === item.label}
				{#if item.children}
					<!-- 子のある項目: 押すと開閉（いまの画面の項目は最初から開く） -->
					<button
						type="button"
						onclick={() => toggle(item.href)}
						aria-expanded={isOpen(item.href)}
						class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition {here ? 'text-white' : 'hover:bg-white/5 hover:text-white'}"
					>
						<AdminIcon name={item.icon} class="h-[18px] w-[18px] shrink-0 {here ? 'text-white' : 'text-stone-400'}" />
						<span class="min-w-0 flex-1 truncate {here ? 'font-medium' : ''}">{item.label}</span>
						<AdminIcon name="chevron" class="h-3.5 w-3.5 shrink-0 text-stone-500 transition-transform {isOpen(item.href) ? 'rotate-90' : ''}" />
					</button>
					{#if isOpen(item.href)}
						<div class="mt-0.5 mb-1 ml-[1.35rem] space-y-0.5 border-l border-white/10 pl-2.5">
							{#each item.children as leaf (leaf.href)}
								{@const on = current?.leaf.href === leaf.href && current?.leaf.label === leaf.label}
								<a
									href={leaf.href}
									aria-current={on ? 'page' : undefined}
									class="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition {on ? 'bg-white/10 font-medium text-white' : 'text-stone-400 hover:bg-white/5 hover:text-white'}"
								>
									<span class="min-w-0 truncate">{leaf.label}</span>
									{#if leaf.tenantWide && !item.tenantWide}<span class="shrink-0 rounded bg-white/5 px-1 text-[10px] text-stone-500">全施設</span>{/if}
									{#if live && leaf.demoOnly}<span class="shrink-0 rounded bg-white/10 px-1 text-[10px] text-stone-400">未接続</span>{/if}
								</a>
							{/each}
						</div>
					{/if}
				{:else}
					<a
						href={item.href}
						aria-current={here ? 'page' : undefined}
						class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition {here ? 'bg-white/10 font-medium text-white' : 'hover:bg-white/5 hover:text-white'}"
					>
						<AdminIcon name={item.icon} class="h-[18px] w-[18px] shrink-0 {here ? 'text-white' : 'text-stone-400'}" />
						<span class="min-w-0 flex-1 truncate">{item.label}</span>
						{#if item.tenantWide}<span class="shrink-0 rounded bg-white/5 px-1 text-[10px] text-stone-500">全施設</span>{/if}
						{#if item.badge === 'groupInquiries'}
							<!-- 団体照会の回答待ち（submitted）の件数。layout の load が Promise のまま流す（0・null は出さない・docs/partner-group-booking.md §7.8） -->
							{#await data.groupInquiryBadge then n}{#if n}<span class="shrink-0 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white tabular-nums" title="回答待ちの団体照会">{n}</span>{/if}{/await}
						{/if}
					</a>
				{/if}
			{/each}
		</div>
	{/each}
{/snippet}

<!-- 画面を移っている間、上端に細い帯を出す（押したことがすぐ分かるように・2026-10-18 高速化）。150ms 以内に終わる遷移では出さない -->
{#if navigating.to}
	<div class="nav-progress pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden" aria-hidden="true"><div class="h-full w-1/3 bg-amber-500"></div></div>
{/if}

{#if isLogin}
	{@render children()}
	<p class="fixed right-3 bottom-2 font-mono text-[11px] text-stone-400">v{APP_VERSION}</p>
{:else}
	<div class="admin-shell flex min-h-screen flex-col bg-[#f0eeeb]">
		<!-- 上部バーは PMS/RMS/Order と同じく最上段いっぱい（左サイドバーの上）。スクロールしても残す（施設切替・メンテナンス表示を常に見せる） -->
		<div class="sticky top-0 z-30" data-admin-header bind:clientHeight={headerH}>
			<header
					class="admin-topbar app-header flex items-center gap-2.5 border-b border-stone-200 bg-white/95 px-4 py-2.5 backdrop-blur sm:px-6 lg:px-8"
					style="--foreground: #292524; --muted-foreground: #78716c; --accent: #f5f5f4; --border: #e7e5e4; --popover: #ffffff; --background: #ffffff; --ring: #44403c; --app-header-tab-h: 2.25rem"
				>
					<button
						type="button"
						class="-ml-1 rounded-lg p-2 text-stone-600 hover:bg-stone-100 md:hidden"
						aria-label="メニューを開く"
						aria-expanded={menuOpen}
						onclick={() => (menuOpen = true)}
					>
						<AdminIcon name="menu" class="h-5 w-5" />
					</button>
					<!-- ロゴ＋アプリ切替タブ（ブラウザは他アプリへのリンク・デスクトップのタブ型では View 切替＋Electron のタブバーを畳む）。
					     幅が狭いとロゴ＋▾ に畳む（旧: スマホ用のマークだけのロゴ）。ログイン・二段階認証の画面には出さない＝宣言しない -->
					<AppHeaderTabs currentAppId="book" homeHref="/admin" class="shrink-0" />

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
						<span class="hidden items-center gap-2 text-stone-600 sm:flex">
							<span class="flex h-7 w-7 items-center justify-center rounded-full bg-stone-100 text-xs font-medium text-stone-600">{(data.user?.name ?? '?').slice(0, 1)}</span>
							<span class="max-w-40 truncate">{data.user?.name}</span>
							{#if data.user?.name !== (data.user?.role === 'admin' ? '管理者' : 'スタッフ')}<span class="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-500">{data.user?.role === 'admin' ? '管理者' : 'スタッフ'}</span>{/if}
						</span>
						<form method="POST" action="/auth/logout" data-no-guard>
							<button type="submit" class="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-700" title="ログアウト">
								<AdminIcon name="logout" class="h-4 w-4" /><span class="hidden sm:inline">ログアウト</span>
							</button>
						</form>
						<!-- デスクトップのタブ型だけ「⋯」（更新・表示設定・ログアウト（全アプリ））。それ以外では何も描かない -->
						<DesktopShellMenuButton />
					</div>
				</header>

				{#if data.maintenanceActive}
					<a href="/admin/maintenance" class="block bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-white hover:bg-amber-600">
						🛠 メンテナンスモード有効 — 一般ユーザーへ非公開中（運営はプレビュー可）
					</a>
				{/if}
		</div>

		<div class="flex min-w-0 flex-1">
		<aside class="admin-sidebar sticky hidden w-56 shrink-0 flex-col bg-brand-900 text-stone-300 md:flex" style="--admin-header-h: {headerH}px">
			<!-- ロゴとアプリ切替は上部ヘッダーのタブ（2026-10-28） -->
			<p class="mx-5 mt-4 mb-3 truncate rounded px-2 py-1 text-xs font-medium ring-1 ring-white/20 {facilityTone}" title="いま操作している施設">
				{tenantWide ? '全施設共通' : data.currentFacility.name}
			</p>
			<nav class="admin-nav flex-1 overflow-y-auto px-2 pb-4" aria-label="管理メニュー">
				{@render navList()}
			</nav>
			<div class="flex items-center justify-between px-5 py-4 text-xs">
				<a href="/" class="text-stone-500 hover:text-white">← 顧客サイトへ</a>
				<span class="font-mono text-stone-400" title="管理画面のバージョン">v{APP_VERSION}</span>
			</div>
		</aside>

		<!-- モバイル用ドロワー -->
		{#if menuOpen}
			<div class="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="管理メニュー">
				<button type="button" class="absolute inset-0 bg-black/40" aria-label="メニューを閉じる" onclick={() => (menuOpen = false)}></button>
				<div class="absolute inset-y-0 left-0 flex w-80 max-w-[88%] flex-col bg-brand-900 text-stone-300 shadow-xl">
					<div class="flex items-center justify-between px-5 py-4">
						<div class="flex items-center gap-2">
							<a href="/admin" class="rounded-lg bg-white px-3 py-2.5" aria-label="Autumn Book 管理画面のホーム"><AutumnBookLogo class="h-7 w-auto" /></a>
						</div>
						<button type="button" class="rounded-lg p-2 text-stone-400 hover:bg-white/10 hover:text-white" aria-label="メニューを閉じる" onclick={() => (menuOpen = false)}><AdminIcon name="close" class="h-5 w-5" /></button>
					</div>
					<nav class="admin-nav flex-1 overflow-y-auto px-2 pb-4">
						{@render navList()}
					</nav>
					<div class="flex items-center justify-between px-5 py-4 text-xs">
				<a href="/" class="text-stone-500 hover:text-white">← 顧客サイトへ</a>
				<span class="font-mono text-stone-400" title="管理画面のバージョン">v{APP_VERSION}</span>
			</div>
				</div>
			</div>
		{/if}

		<div class="admin-main flex min-w-0 flex-1 flex-col">

			{#if showMfaBanner}
				<a href="/admin/security" class="block border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 hover:bg-sky-100">
					<span class="font-bold">🔐 パスキーか二段階認証（認証アプリ）を登録してください。</span>
					パスワードが漏れても管理画面に入られないようにします。近日中に全員必須になります。→ 登録する
				</a>
			{/if}

			{#if demoOnlyHere}
				<div class="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
					<span class="font-bold">この画面はまだ本番データに繋がっていません。</span>
					表示はサンプルです。保存してもお客様の画面には反映されないため、保存は止めています。
				</div>
			{/if}

			<main class="min-w-0 flex-1 px-3 py-4 sm:px-4 md:p-6" oninput={markDirty} onchange={markDirty} onsubmit={markClean}>
				{#if crumbs.length}
					<!-- 現在地（どのグループのどの画面か・メニュー整理で場所が変わったので目印に） -->
					<nav class="print-hide mb-2 flex flex-wrap items-center gap-1 text-xs text-stone-500 print:hidden" aria-label="現在地">
						{#each crumbs as c, i (i)}
							{#if i > 0}<AdminIcon name="chevron" class="h-3 w-3 text-stone-400" />{/if}
							<span class={i === crumbs.length - 1 ? 'font-medium text-stone-700' : ''}>{c}</span>
						{/each}
					</nav>
				{/if}
				{@render children()}
			</main>
		</div>
		</div>
	</div>
	<Toast />
	<ConfirmDialog />
{/if}

