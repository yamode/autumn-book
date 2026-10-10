<script lang="ts">
	// 客室インフォメーションのトップ。
	//
	// 並びは現行の VERY travel を踏襲する:
	//   ヒーロー写真 → Wi-Fi 帯 → 滞在カード → 機能ナビ（横並びアイコン）→ 案内カードのグリッド
	// 「館内のご案内」は1件ずつ詳細ページ（/r/g/<id>）へ。長い案内（ルームサービスのメニュー等）を
	// トップに積まないための分け方で、これも現行アプリと同じ。
	import { invalidateAll } from '$app/navigation';
	import { groupByDay, upcomingItems } from '$lib/inroom-day';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import { inroomCardImage, inroomHero, inroomIcon } from '$lib/inroom-visuals';
	import IntercomSheet from '$lib/components/IntercomSheet.svelte';
	import StayCodeInput from '$lib/components/StayCodeInput.svelte';

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

	// 食事時間（PMS で決まったもの。将来は事前チェックインの申請中も status='requested' で並ぶ）
	const mealLabel = (t: string) => (t === 'dinner' ? m.inroom_meal_dinner() : t === 'breakfast' ? m.inroom_meal_breakfast() : m.inroom_meal_lunch());

	// tel: リンク用（ハイフン等を除去）
	function telHref(phone?: string): string {
		return 'tel:' + (phone ?? '').replace(/[^0-9+]/g, '');
	}

	// 過ぎた予定を隠す（2026-10-09）。画面を開いたまま（ホーム画面に置いたまま）でも1分ごとに判定し直す。
	// 新しく決まった予定（PMS で入った翌朝の朝食など）は、画面に戻ったとき・日付が変わったときに読み直して出す
	let now = $state(new Date());
	$effect(() => {
		if (!data.stay) return;
		let day = now.toDateString();
		const tick = () => {
			now = new Date();
			if (document.visibilityState === 'visible' && now.toDateString() !== day) {
				day = now.toDateString();
				invalidateAll();
			}
		};
		const onVisible = () => {
			if (document.visibilityState === 'visible') {
				now = new Date();
				invalidateAll();
			}
		};
		const timer = setInterval(tick, 60_000);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});
	// 日をまたいで並ぶときは日ごとにまとめ、最初の日だけ開く（後の日は日付を押すと開く）
	const mealDays = $derived(groupByDay(upcomingItems(data.meals, (meal) => ({ date: meal.date, start: meal.time }), now)));
	const bathDays = $derived(
		groupByDay(upcomingItems(data.bathReservations, (r) => ({ date: r.date, start: r.from, end: r.to }), now))
	);

	const slug = $derived(data.stay?.facility.slug ?? data.browse?.slug ?? data.endedFacility?.slug ?? '');
	// コードなしで見る館内案内（入口QRから・2026-10-10）。滞在の情報（食事・貸切風呂・内線）は出さず、トップでコードを入れてもらう
	const facilityName = $derived(data.stay?.facility.name ?? data.browse?.name ?? '');
	const facilityPhone = $derived(data.stay?.facility.phone ?? data.browse?.phone ?? '');
	const hero = $derived(inroomHero(slug));
	// Wi-Fi は現行アプリと同じくヒーロー直下に常時出す。残りはカードに並べる。
	const wifi = $derived(data.guides.find((g) => g.section === 'wifi'));
	const cards = $derived(data.guides.filter((g) => g.section !== 'wifi'));
</script>

<svelte:head><title>{m.inroom_header()} ｜ YAMADO</title></svelte:head>

{#snippet codeErrors()}
	{#if form?.claimError === 'fail'}
		<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_code()}</p>
	{:else if form?.claimError === 'locked'}
		<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_locked()}</p>
	{/if}
{/snippet}

{#if data.stay || data.browse}
	<!-- ============ ヒーロー ============ -->
	{#if hero}
		<img src={hero} alt={facilityName} class="h-48 w-full object-cover" />
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
		{#if !data.stay}
			<!-- ============ コードの入力（館内案内を見ている方が、滞在に紐づけるとき）============ -->
			{@render codeErrors()}
			<section class="rounded-lg bg-white px-4 py-5 shadow-card">
				<h1 class="text-[15px] font-medium text-stone-900">{m.inroom_browse_code_title()}</h1>
				<p class="mt-1 text-sm text-stone-500">{m.inroom_browse_code_help()}</p>
				<StayCodeInput autofocus={false} />
			</section>
		{:else}
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
		{/if}

		{#if mealDays.length}
			<!-- ============ お食事の時間（PMS の伺い書で決まった時間）。過ぎた分は隠し、日ごとにまとめる ============ -->
			<section class="rounded-lg border border-stone-200 bg-white px-4 py-4 shadow-card" aria-labelledby="meal-times-title">
				<h2 id="meal-times-title" class="text-[15px] font-semibold text-stone-900">{m.inroom_meals_title()}</h2>
				<div class="mt-3 divide-y divide-stone-100">
					{#each mealDays as day, i (day.date)}
						<details class="group py-2 first:pt-0 last:pb-0" open={i === 0}>
							<summary class={`flex list-none ${mealDays.length > 1 ? 'cursor-pointer' : 'pointer-events-none'} items-center justify-between gap-3 text-sm font-medium text-stone-800 [&::-webkit-details-marker]:hidden`}>
								{fmtBathDate(day.date)}
								{#if mealDays.length > 1}<span class="text-xs text-stone-400 transition group-open:rotate-180">▾</span>{/if}
							</summary>
							<ul class="mt-1.5 space-y-1.5">
								{#each day.items as meal (`${meal.date}-${meal.type}`)}
									<li class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pl-3">
										<span class="text-sm text-stone-500">{mealLabel(meal.type)}</span>
										<strong class="text-base font-semibold tabular-nums text-stone-900">
											{meal.time}
											{#if meal.status === 'requested'}<span class="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{m.inroom_meal_requested()}</span>{/if}
										</strong>
									</li>
								{/each}
							</ul>
						</details>
					{/each}
				</div>
				<p class="mt-2 text-xs text-stone-500">{m.inroom_meals_note()}</p>
			</section>
		{/if}

		{#if bathDays.length}
			<section class="rounded-lg border border-stone-200 bg-white px-4 py-4 shadow-card" aria-labelledby="bath-reservations-title">
				<div class="flex items-center justify-between gap-3">
					<h2 id="bath-reservations-title" class="text-[15px] font-semibold text-stone-900">{m.bath_mine_title()}</h2>
					<a href="/r/bath" class="shrink-0 text-xs font-medium text-stone-600 underline underline-offset-2">{m.inroom_bath_manage()}</a>
				</div>
				<div class="mt-3 divide-y divide-stone-100">
					{#each bathDays as day, i (day.date)}
						<details class="group py-2 first:pt-0 last:pb-0" open={i === 0}>
							<summary class={`flex list-none ${bathDays.length > 1 ? 'cursor-pointer' : 'pointer-events-none'} items-center justify-between gap-3 text-sm font-medium text-stone-800 [&::-webkit-details-marker]:hidden`}>
								{fmtBathDate(day.date)}
								{#if bathDays.length > 1}<span class="text-xs text-stone-400 transition group-open:rotate-180">▾</span>{/if}
							</summary>
							<ul class="mt-1.5 space-y-1.5">
								{#each day.items as reservation (reservation.id)}
									<li class="pl-3 text-right">
										<strong class="text-base font-semibold tabular-nums text-stone-900">{reservation.from}{reservation.to ? `〜${reservation.to}` : ''}</strong>
									</li>
								{/each}
							</ul>
						</details>
					{/each}
				</div>
			</section>
		{/if}

		<!-- ============ 機能ナビ（横並び） ============ -->
		<!-- 貸切風呂: コードなし（館内案内）で押すと、先にコード入力（/r/bath/code）→ 予約フォーム -->
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
					disabled={!intercom.open || !intercom.online}
					class="flex flex-1 flex-col items-center justify-center gap-1.5 py-4 disabled:opacity-40"
				>
					<svg viewBox="0 0 24 24" class="h-7 w-7 text-stone-800" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M5 12.5a10 10 0 0 1 14 0M8 15.5a5.5 5.5 0 0 1 8 0" /><circle cx="12" cy="18.5" r="1" fill="currentColor" />
						<path d="M9 3h6M12 3v5" />
					</svg>
					<span class="text-xs text-stone-700">{m.intercom_call()}</span>
					<span class="text-[10px] text-stone-400">{!intercom.open ? m.intercom_closed() : !intercom.online ? m.intercom_offline() : m.intercom_call_sub()}</span>
				</button>
			{/if}
			{#if facilityPhone}
				<div class="my-3 w-px bg-stone-200"></div>
				<a href={telHref(facilityPhone)} class="flex flex-1 flex-col items-center justify-center gap-1.5 py-4">
					<svg viewBox="0 0 24 24" class="h-7 w-7 text-stone-800" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
						<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 5.5 5.5L16 12l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 6.2 2 2 0 0 1 6.5 3z" />
					</svg>
					<span class="text-xs text-stone-700">{m.inroom_front_call()}</span>
				</a>
			{/if}
		</nav>
		{#if intercom?.enabled}
			<IntercomSheet bind:this={sheet} bind:open={sheetOpen} phone={facilityPhone} />
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
	<!-- ============ 未 claim / 無効 / 終了 ============ -->
	{#if data.expired && hero}
		<img src={hero} alt={data.endedFacility?.name ?? ''} class="h-40 w-full object-cover" />
	{/if}
	<div class="space-y-3 px-4 py-4">
		{#if data.expired}
			<!-- ご滞在終了（チェックアウト後の QR・期限切れの Cookie）：サンクス表示 -->
			<section class="rounded-lg bg-white px-5 py-8 text-center shadow-card">
				{#if data.endedFacility?.name}
					<p class="mb-2 text-xs tracking-wide text-stone-400">{data.endedFacility.name}</p>
				{/if}
				<p class="text-[17px] font-medium text-stone-900">{m.inroom_ended_title()}</p>
				<p class="mt-3 text-sm leading-relaxed text-stone-600">{m.inroom_ended_body()}</p>
			</section>

			<!-- 販促バナー（/admin/inroom/banners で施設ごとに設定。公開中・掲載期間内・言語が合うものだけ） -->
			{#each data.banners as b (b.id)}
				{#snippet bannerInner()}
					<img src={b.imageUrl} alt={b.title} loading="lazy" class="block w-full" />
					{#if b.body}
						<p class="px-4 py-3 text-sm leading-relaxed text-stone-700">{b.body}</p>
					{/if}
				{/snippet}
				{#if b.linkUrl}
					<a href={b.linkUrl} target="_blank" rel="noopener" class="block overflow-hidden rounded-lg bg-white shadow-card">
						{@render bannerInner()}
					</a>
				{:else}
					<div class="overflow-hidden rounded-lg bg-white shadow-card">{@render bannerInner()}</div>
				{/if}
			{/each}
		{:else if data.invalidQr}
			<p class="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{m.inroom_err_invalid_qr()}</p>
		{/if}

		{@render codeErrors()}

		{#snippet codeForm(autofocus: boolean)}
			<!-- 6桁のマスに打つ入力欄（そろったら自動で送る・違えば揺らして打ち直し。2026-10-09） -->
			<StayCodeInput {autofocus} />
		{/snippet}

		{#if data.expired}
			<!-- 新しいご滞在の案内カードを持つ方だけが使う。普段は畳んでおく -->
			<details class="rounded-lg bg-white px-4 py-3 shadow-card" open={!!form?.claimError}>
				<summary class="cursor-pointer text-sm text-stone-500">{m.inroom_ended_other_code()}</summary>
				<p class="mt-2 text-sm text-stone-500">{m.inroom_code_help()}</p>
				{@render codeForm(false)}
			</details>
		{:else}
			<section class="rounded-lg bg-white px-4 py-5 shadow-card">
				<h1 class="text-[15px] font-medium text-stone-900">{m.inroom_code_title()}</h1>
				<p class="mt-1 text-sm text-stone-500">{m.inroom_code_help()}</p>
				{@render codeForm(true)}
			</section>
		{/if}
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
