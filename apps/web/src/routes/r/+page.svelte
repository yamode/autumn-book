<script lang="ts">
	// 客室インフォメーションのトップ。
	//
	// 並びは現行の VERY travel を踏襲する:
	//   ヒーロー写真 → Wi-Fi 帯 → 滞在カード → 機能ナビ（横並びアイコン）→ 案内カードのグリッド
	// 「館内のご案内」は1件ずつ詳細ページ（/r/g/<id>）へ。長い案内（ルームサービスのメニュー等）を
	// トップに積まないための分け方で、これも現行アプリと同じ。
	import { enhance } from '$app/forms';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import { inroomCardImage, inroomHero, inroomIcon } from '$lib/inroom-visuals';
	import IntercomSheet from '$lib/components/IntercomSheet.svelte';

	let { data, form } = $props();

	// 客室内線（Wi-Fi データ通話）。/admin/inroom で施設ごとに ON にしたときだけ出す
	let sheetOpen = $state(false);
	let sheet = $state<ReturnType<typeof IntercomSheet> | null>(null);
	const intercom = $derived(data.stay ? data.intercom : undefined);

	const localeTag: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-TW': 'zh-TW' };
	function fmtDate(iso: string): string {
		try {
			return new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				timeZone: 'Asia/Tokyo'
			}).format(new Date(iso));
		} catch {
			return iso.slice(0, 10);
		}
	}
	function fmtBathDate(ymd: string): string {
		try {
			return new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', {
				month: 'long',
				day: 'numeric',
				weekday: 'short',
				timeZone: 'Asia/Tokyo'
			}).format(new Date(`${ymd}T00:00:00+09:00`));
		} catch {
			return ymd;
		}
	}

	// tel: リンク用（ハイフン等を除去）
	function telHref(phone?: string): string {
		return 'tel:' + (phone ?? '').replace(/[^0-9+]/g, '');
	}

	const slug = $derived(data.stay?.facility.slug ?? '');
	const hero = $derived(inroomHero(slug));
	// Wi-Fi は現行アプリと同じくヒーロー直下に常時出す。残りはカードに並べる。
	const wifi = $derived(data.guides.find((g) => g.section === 'wifi'));
	const cards = $derived(data.guides.filter((g) => g.section !== 'wifi'));
</script>

<svelte:head><title>{m.inroom_header()} ｜ YAMADO</title></svelte:head>

{#if data.stay}
	<!-- ============ ヒーロー ============ -->
	{#if hero}
		<img src={hero} alt={data.stay.facility.name} class="h-48 w-full object-cover" />
	{/if}

	<!-- ============ Wi-Fi 帯 ============ -->
	{#if wifi}
		<a href={`/r/g/${wifi.id}`} class="block bg-white px-5 py-4">
			<div class="flex items-start gap-3">
				<svg viewBox="0 0 24 24" class="mt-0.5 h-5 w-5 shrink-0 text-stone-800" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
					<path d={inroomIcon('wifi')} />
				</svg>
				<div class="min-w-0 flex-1">
					<p class="text-xs text-stone-400">{wifi.title}</p>
					<div class="wifi-body mt-0.5 line-clamp-3 text-[15px] font-medium text-stone-900">
						<MarkdownView source={wifi.body} />
					</div>
				</div>
				<span class="mt-1 shrink-0 text-stone-300">›</span>
			</div>
		</a>
	{/if}

	<div class="space-y-3 px-4 py-3">
		<!-- ============ 滞在カード ============ -->
		<section class="rounded-lg bg-white px-4 py-4 shadow-card">
			<p class="text-[15px] font-medium text-stone-900">
				{#if data.stay.guestName}
					{m.inroom_welcome({ name: data.stay.guestName })}
				{:else}
					{m.inroom_welcome_generic()}
				{/if}
			</p>
			<dl class="mt-3 space-y-1.5 text-sm">
				<div class="flex items-baseline justify-between">
					<dt class="text-stone-400">{m.inroom_room()}</dt>
					<dd class="font-medium text-stone-800">{data.stay.roomCode}</dd>
				</div>
				<div class="flex items-baseline justify-between">
					<dt class="text-stone-400">{m.inroom_checkout()}</dt>
					<dd class="font-medium text-stone-800">{fmtDate(data.stay.validTo)}</dd>
				</div>
			</dl>
		</section>

		{#if data.bathReservations.length}
			<section class="rounded-lg border border-stone-200 bg-white px-4 py-4 shadow-card" aria-labelledby="bath-reservations-title">
				<div class="flex items-center justify-between gap-3">
					<h2 id="bath-reservations-title" class="text-[15px] font-semibold text-stone-900">{m.bath_mine_title()}</h2>
					<a href="/r/bath" class="shrink-0 text-xs font-medium text-stone-600 underline underline-offset-2">{m.inroom_bath_manage()}</a>
				</div>
				<ul class="mt-3 divide-y divide-stone-100">
					{#each data.bathReservations as reservation (reservation.id)}
						<li class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
							<span class="text-sm text-stone-700">{fmtBathDate(reservation.date)}</span>
							<strong class="text-base font-semibold tabular-nums text-stone-900">{reservation.from}{reservation.to ? `〜${reservation.to}` : ''}</strong>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<!-- ============ 機能ナビ（横並び） ============ -->
		<nav class="flex items-stretch rounded-lg bg-white shadow-card">
			<a href="/r/bath" class="flex flex-1 flex-col items-center justify-center gap-1.5 py-4">
				<svg viewBox="0 0 24 24" class="h-7 w-7 text-stone-800" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
					<path d={inroomIcon('onsen')} />
				</svg>
				<span class="text-xs text-stone-700">{m.bath_link()}</span>
			</a>
			{#if intercom?.enabled}
				<div class="my-3 w-px bg-stone-200"></div>
				<button
					type="button"
					onclick={() => sheet?.dial()}
					disabled={!intercom.open}
					class="flex flex-1 flex-col items-center justify-center gap-1.5 py-4 disabled:opacity-40"
				>
					<svg viewBox="0 0 24 24" class="h-7 w-7 text-stone-800" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a5.5 5.5 0 0 1 8 0" /><circle cx="12" cy="18.5" r="1" fill="currentColor" />
						<path d="M9 3h6M12 3v5" />
					</svg>
					<span class="text-xs text-stone-700">{m.intercom_call()}</span>
					<span class="text-[10px] text-stone-400">{intercom.open ? m.intercom_call_sub() : m.intercom_closed()}</span>
				</button>
			{/if}
			{#if data.stay.facility.phone}
				<div class="my-3 w-px bg-stone-200"></div>
				<a href={telHref(data.stay.facility.phone)} class="flex flex-1 flex-col items-center justify-center gap-1.5 py-4">
					<svg viewBox="0 0 24 24" class="h-7 w-7 text-stone-800" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
						<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 6.2 2 2 0 0 1 6.5 3z" />
					</svg>
					<span class="text-xs text-stone-700">{m.inroom_front_call()}</span>
				</a>
			{/if}
		</nav>
		{#if intercom?.enabled}
			<IntercomSheet bind:this={sheet} bind:open={sheetOpen} phone={data.stay.facility.phone} />
		{/if}

		<!-- ============ 館内のご案内（カード） ============ -->
		{#if cards.length === 0}
			<p class="rounded-lg bg-white px-4 py-8 text-center text-sm text-stone-400 shadow-card">
				{m.inroom_guides_empty()}
			</p>
		{:else}
			<ul class="grid grid-cols-2 items-stretch gap-3">
				{#each cards as g (g.id)}
					{@const img = inroomCardImage(slug, g.section)}
					<li class="overflow-hidden rounded-lg bg-white shadow-card">
						<a href={`/r/g/${g.id}`} class="relative flex h-24 items-center justify-center px-3 text-center">
							{#if img}
								<img src={img} alt="" class="absolute inset-0 h-full w-full object-cover" loading="lazy" />
								<span class="absolute inset-0 bg-black/45"></span>
								<span class="relative text-[15px] font-medium leading-snug text-white drop-shadow">{g.title}</span>
							{:else}
								<span class="relative flex flex-col items-center gap-1.5">
									<svg viewBox="0 0 24 24" class="h-6 w-6 text-stone-500" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
										<path d={inroomIcon(g.section)} />
									</svg>
									<span class="text-[14px] font-medium leading-snug text-stone-800">{g.title}</span>
								</span>
							{/if}
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{:else}
	<!-- ============ 未 claim / 無効 / 終了：コード入力 ============ -->
	<div class="space-y-3 px-4 py-4">
		{#if data.invalidQr}
			<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_invalid_qr()}</p>
		{:else if data.expired}
			<p class="rounded-lg bg-white px-4 py-3 text-sm text-stone-600 shadow-card">{m.inroom_err_expired()}</p>
		{/if}

		{#if form?.claimError === 'fail'}
			<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_code()}</p>
		{:else if form?.claimError === 'locked'}
			<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_locked()}</p>
		{/if}

		<section class="rounded-lg bg-white px-4 py-5 shadow-card">
			<h1 class="text-[15px] font-medium text-stone-900">{m.inroom_code_title()}</h1>
			<p class="mt-1 text-sm text-stone-500">{m.inroom_code_help()}</p>
			<form method="POST" action="?/claim" use:enhance class="mt-4 space-y-3">
				<input
					name="code"
					inputmode="numeric"
					autocomplete="off"
					maxlength="8"
					placeholder={m.inroom_code_placeholder()}
					class="w-full rounded-md border border-stone-300 px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] text-stone-800"
				/>
				<button type="submit" class="w-full rounded-md bg-stone-700 py-3 text-sm font-medium text-white hover:bg-stone-600">
					{m.inroom_code_submit()}
				</button>
			</form>
		</section>
	</div>
{/if}

<style>
	/* 現行アプリのカードの影（うっすら1段だけ） */
	:global(.shadow-card) {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}
	/* Wi-Fi 帯は1行ずつ大きめに出す（Markdown のリスト装飾は落とす） */
	.wifi-body :global(ul) {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.wifi-body :global(li),
	.wifi-body :global(p) {
		margin: 0;
	}
</style>
