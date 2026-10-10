<script lang="ts">
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate } from '$app/navigation';
	import { APP_VERSION } from '$lib/version';
	import Toast from '$lib/components/admin/Toast.svelte';
	import ConfirmDialog from '$lib/components/admin/ConfirmDialog.svelte';

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
				{ href: '/admin/partners/invoices', label: '予定請求書', icon: '🧾' },
				{ href: '/admin/partners/charges', label: '今後の請求予定', icon: '📆' },
				{ href: '/admin/plans', label: 'プラン', icon: '📝' },
				{ href: '/admin/payments', label: '支払方法', icon: '💳' },
				{ href: '/admin/rooms', label: '部屋編集', icon: '🛏' },
				{ href: '/admin/options', label: 'オプション', icon: '🧺', demoOnly: true },
				{ href: '/admin/cancel-policies', label: 'キャンセル規定', icon: '🚫', tenantWide: true, demoOnly: true },
				{ href: '/admin/children', label: 'お子様の受け入れ', icon: '🧒' },
				{ href: '/admin/booking-notes', label: '予約時の注意事項', icon: '📌' },
				{ href: '/admin/booking-questions', label: '予約時に聞く項目', icon: '❓' },
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
				{ href: '/admin/faqs', label: 'FAQ', icon: '❓' },
				{ href: '/admin/mail', label: 'メルマガ', icon: '✉', demoOnly: true },
				{ href: '/admin/sequences', label: 'ステップメール', icon: '🔁', demoOnly: true }
			]
		},
		{
			label: 'システム',
			items: [
				{ href: '/admin/maintenance', label: 'メンテナンス', icon: '🛠', tenantWide: true },
				{ href: '/admin/security', label: '二段階認証', icon: '🔐', tenantWide: true }
			]
		}
	];

	const navItems = navGroups.flatMap((g) => g.items);

	// ログイン画面と二段階認証のコード入力画面は、メニューを出さない（まだ管理画面に入れていない状態）
	let isLogin = $derived(page.url.pathname === '/admin/login' || page.url.pathname.startsWith('/admin/mfa'));
	// 二段階認証が未登録（必須化前）なら、上部で登録を案内する。登録画面を開いている間は出さない
	let showMfaBanner = $derived(
		data.adminMfa.enabled && !data.adminMfa.enrolled && !page.url.pathname.startsWith('/admin/security')
	);

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
		.admin-sidebar { zoom: 1.0588; height: calc(100vh / 1.0588); }
		.admin-nav { scrollbar-width: thin; scrollbar-color: transparent transparent; }
		.admin-nav:hover { scrollbar-color: rgb(255 255 255 / 0.22) transparent; }
		.admin-nav::-webkit-scrollbar { width: 6px; }
		.admin-nav::-webkit-scrollbar-track { background: transparent; }
		.admin-nav::-webkit-scrollbar-thumb { background: transparent; border-radius: 3px; }
		.admin-nav:hover::-webkit-scrollbar-thumb { background: rgb(255 255 255 / 0.22); }
	</style>
</svelte:head>

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
	<p class="fixed right-3 bottom-2 font-mono text-[11px] text-stone-400">v{APP_VERSION}</p>
{:else}
	<div class="admin-shell flex min-h-screen bg-[#f0eeeb]">
		<aside class="admin-sidebar sticky top-0 hidden h-screen w-56 shrink-0 flex-col bg-brand-900 text-stone-300 md:flex">
			<p class="px-5 pt-4 font-display text-lg text-white">山人 <span class="text-xs text-stone-400">管理</span></p>
			<p class="mx-5 mt-2 mb-3 truncate rounded px-2 py-1 text-xs font-medium ring-1 ring-white/20 {facilityTone}" title="いま操作している施設">
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
				<div class="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col bg-brand-900 text-stone-300 shadow-xl">
					<div class="flex items-center justify-between px-5 py-4">
						<p class="font-display text-lg text-white">山人 <span class="text-xs text-stone-400">管理</span></p>
						<button type="button" class="text-2xl leading-none text-stone-400 hover:text-white" aria-label="メニューを閉じる" onclick={() => (menuOpen = false)}>×</button>
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

			{#if showMfaBanner}
				<a href="/admin/security" class="block border-b border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900 hover:bg-sky-100">
					<span class="font-bold">🔐 二段階認証（認証アプリ）を登録してください。</span>
					パスワードが漏れても管理画面に入られないようにします。近日中に全員必須になります。→ 登録する
				</a>
			{/if}

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
	<ConfirmDialog />
{/if}

