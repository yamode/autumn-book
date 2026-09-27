<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import PhotoGallery from '$lib/components/PhotoGallery.svelte';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import ContentBlocks from '$lib/components/ContentBlocks.svelte';
	import ScrollDatePicker from '$lib/components/ScrollDatePicker.svelte';
	import CancelPolicyNote from '$lib/components/CancelPolicyNote.svelte';
	import { formatDate, formatPrice, todayStr } from '$lib/format';
	import { gaEvent } from '$lib/analytics';
	import * as m from '$lib/paraglide/messages';
	import { percentText } from '$lib/early-prepay';
	import { searchQuery } from '$lib/components/guests';

	let { data, form } = $props();

	// GA4 予約ファネル: プラン閲覧（設計書 §9）
	$effect(() => {
		gaEvent('view_item', {
			currency: 'JPY',
			items: [{ item_id: data.plan.id, item_name: data.plan.name, item_brand: data.facility.name }]
		});
	});
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
	let selectedRoom = $derived(page.url.searchParams.get('room') ?? '');
	let facilitiesHref = $derived(data.params.checkin ? `/search?${searchQuery(data.params)}` : '/search');
	let qs = $derived(
		data.params.checkin ? `checkin=${data.params.checkin}&nights=${data.params.nights}&adults=${data.params.adults}` : ''
	);

	// 料金は「1名1泊・税込」を主、1室の合計を従で出す（全画面で単位を統一）。
	// quote.perPerson は1名あたりの全泊合計なので、泊数で割って1名1泊にする。
	const perPersonNight = (total: number) => Math.round(total / Math.max(1, data.params.adults * data.params.nights));

	// ファーストビュー用の料金サマリ: 日付指定時は予約できる客室の最安、未指定はプラン基準料金（〜）
	let cheapest = $derived.by(() => {
		let best: { total: number } | null = null;
		for (const r of data.rooms) {
			if (r.quote && (!best || r.quote.total < best.total)) best = { total: r.quote.total };
		}
		return best;
	});
	let soldOut = $derived(!!data.params.checkin && cheapest === null);
	// 早期決済割・早期決済ポイントの最大率（withEarlyPrepayMax が入れる）。points は定率割引と並べて出す
	let earlyMax = $derived(data.plan.payment.prepay ? (data.plan.payment.earlyPrepayMaxRate ?? 0) : 0);
	let earlyPoints = $derived(earlyMax > 0 && data.plan.payment.earlyPrepayMode === 'points');
	let earlyMaxText = $derived(percentText(Math.round(earlyMax * 1000) / 10));

	// モバイルの下部固定バー: 客室セクションが画面に入ったら隠す（同じCTAが二重にならないように）
	let roomsInView = $state(false);
	let datePickerOpen = $state(false);
	function chooseDate(date: string, nights: number) {
		const query = new URLSearchParams({ checkin: date, nights: String(nights), adults: String(data.params.adults) });
		if (selectedRoom) query.set('room', selectedRoom);
		void goto(`${base}/plans/${data.plan.slug}?${query}#${selectedRoom ? `room-${selectedRoom}` : 'rooms'}`);
	}
	$effect(() => {
		const el = document.getElementById('rooms');
		if (!el || typeof IntersectionObserver === 'undefined') return;
		const io = new IntersectionObserver((entries) => {
			roomsInView = entries.some((e) => e.isIntersecting);
		});
		io.observe(el);
		return () => io.disconnect();
	});
</script>

{#snippet priceBlock()}
	{#if cheapest}
		<p class="text-xs text-stone-500">{m.plan_price_dated_label()}</p>
		<p class="text-2xl font-bold text-brand-900">
			{formatPrice(perPersonNight(cheapest.total))}〜<span class="text-xs font-normal text-stone-500">{m.price_unit_pp_night()}</span>
		</p>
		<p class="text-xs text-stone-500">
			{m.plan_detail_price_detail({ adults: String(data.params.adults), nights: String(data.params.nights), total: formatPrice(cheapest.total) })}
		</p>
	{:else if soldOut}
		<p class="text-sm font-medium text-stone-500">{m.plan_price_sold_out()}</p>
	{:else if data.plan.basePrice > 0}
		<p class="text-xs text-stone-500">{data.referenceMode ? m.plan_price_reference_label() : m.plan_price_base_label()}</p>
		<p class="text-2xl font-bold text-brand-900">
			{formatPrice(data.plan.basePrice)}<span class="text-xs font-normal text-stone-500">{m.plan_card_base_price()}</span>
		</p>
	{:else}
		<p class="text-sm text-stone-500">{m.plan_price_base_note()}</p>
	{/if}
{/snippet}

<svelte:head>
	<title>{m.plan_detail_title({ name: data.plan.name, facility: data.facility.name })}</title>
	<meta name="description" content={data.plan.headline} />
</svelte:head>

<div class="mx-auto max-w-5xl px-4 pb-24 pt-8 md:pb-8">
	<nav class="mb-2 text-xs text-stone-400">
		<a href={facilitiesHref} class="hover:underline">{m.common_facility_list()}</a> /
		<a href="{base}/plans{qs ? '?' + qs : ''}" class="hover:underline">{m.plan_detail_breadcrumb_plans()}</a> / {data.plan.name}
	</nav>

	<div class="grid gap-6 md:grid-cols-[1fr_320px]">
		<div>
			<PhotoGallery photos={[...data.plan.photos, ...data.facility.photos.slice(0, 3)]} />
		</div>
		<!-- 右カラムはスクロールしても料金・CTA が見えるよう追従させる（ヘッダー高さ分下げる） -->
		<div class="space-y-3 md:sticky md:top-32 md:self-start lg:top-24">
			<div class="flex flex-wrap gap-1.5">
				{#each data.plan.highlightTags as tag}
					<span class="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">{tag}</span>
				{/each}
			</div>
			<h1 class="font-display text-2xl leading-snug text-brand-900">{data.plan.name}</h1>
			{#if data.plan.headline && data.plan.headline !== data.plan.name}
				<p class="text-sm text-stone-600">{data.plan.headline}</p>
			{/if}
			<dl class="space-y-1 rounded-lg bg-stone-100 p-3 text-sm">
				<div class="flex justify-between"><dt class="text-stone-500">{m.plan_detail_meal()}</dt><dd>{data.plan.mealPlan}</dd></div>
				<div class="flex justify-between">
					<dt class="text-stone-500">{m.plan_detail_payment()}</dt>
					<dd class="text-right">
						{[data.plan.payment.onsite ? m.pay_onsite() : '', data.plan.payment.prepay ? (data.plan.payment.prepayMethods.includes('paypay') ? 'カード / PayPay' : 'カード') : ''].filter(Boolean).join(' ／ ')}
						{#if earlyMax > 0 && !earlyPoints}
							<!-- 早期決済割（段階表の最大率が定率より大きいとき）。定率の表示とは重ねない -->
							<span class="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-600">{m.plan_early_max({ rate: earlyMaxText })}</span>
						{:else if data.plan.payment.prepay && data.plan.payment.prepayDiscountRate > 0}
							<span class="ml-1 rounded bg-red-50 px-1.5 py-0.5 text-xs font-bold text-red-600">{m.pay_prepay_off({ rate: String(Math.round(data.plan.payment.prepayDiscountRate * 100)) })}</span>
						{/if}
						{#if earlyPoints}
							<!-- 早期決済ポイント（宿泊後に上乗せ付与）。定率割引とは別に付く -->
							<span class="ml-1 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-bold text-emerald-700">{m.plan_points_max({ rate: earlyMaxText })}</span>
						{/if}
					</dd>
				</div>
				{#if data.memberOnsiteHint}
					<!-- 非会員は予約時決済のみのプラン。会員なら現地払いも選べる（控えめに案内） -->
					<p class="text-right text-xs text-stone-500">{m.pay_member_onsite_hint()}</p>
				{/if}
			</dl>

			<!-- 料金サマリ＋CTA（ファーストビューで料金と予約導線を見せる） -->
			<div class="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
				{@render priceBlock()}
				{#if data.params.checkin && !soldOut}
					<p class="mt-2 text-xs text-emerald-700">
						{m.plan_detail_cancel()}: <CancelPolicyNote policy={data.plan.cancellationPolicy} checkin={data.params.checkin} />
					</p>
				{:else if !data.params.checkin}
					<p class="mt-2 text-xs text-stone-500">{m.plan_price_base_note()}</p>
				{/if}
				<!-- 日付未指定・満室時は日付選択（料金カレンダー）へ、指定済みなら客室選択へ -->
				{#if cheapest}
					<a href="#rooms" class="mt-3 block rounded-lg bg-accent-600 py-2.5 text-center text-sm font-medium text-white hover:bg-accent-500">{m.plan_price_cta_rooms()}</a>
				{:else}
					<button type="button" onclick={() => (datePickerOpen = true)} class="mt-3 block w-full rounded-lg bg-accent-600 py-2.5 text-center text-sm font-medium text-white hover:bg-accent-500">{m.plan_price_cta_dates()}</button>
				{/if}
			</div>
		</div>
	</div>

	<!-- プラン本文（A-05 で作成した Markdown） -->
	<!-- 改行は Markdown の breaks:true でそのまま改行になる -->
	{#if data.plan.description}
		<section class="mt-10 max-w-3xl">
			<MarkdownView source={data.plan.description} />
		</section>
	{/if}

	<!-- 仕様表・紹介ブロック（book.plan_contents.specs / sections） -->
	<ContentBlocks specs={data.plan.specs} sections={data.plan.sections} specsTitle={m.plan_detail_specs()} />

	<!-- 日付選択 -->
	<section class="mt-10 scroll-mt-16 md:scroll-mt-32 lg:scroll-mt-24" id="cal">
		<h2 class="font-display mb-1 text-xl text-brand-900">{m.plan_detail_price_calendar()}</h2>
		<p class="mb-3 text-sm text-stone-500">{m.plan_detail_calendar_sub()}</p>
		<button type="button" onclick={() => (datePickerOpen = true)} class="w-full max-w-xl rounded-xl border border-stone-300 bg-white px-5 py-4 text-left text-sm font-medium text-brand-800 hover:border-brand-800">
			📅 {data.params.checkin ? formatDate(data.params.checkin) : m.bath_select_date()} · {m.searchbar_nights_option({ n: String(data.params.nights) })}
		</button>
	</section>
	<ScrollDatePicker bind:open={datePickerOpen} checkin={data.params.checkin} nights={data.params.nights} minDate={todayStr()} days={data.calendar} onSelect={chooseDate} />

	<!-- 客室選択 -->
	<section class="mt-10 scroll-mt-16 md:scroll-mt-32 lg:scroll-mt-24" id="rooms">
		<h2 class="font-display mb-3 text-xl text-brand-900">{m.plan_detail_select_room()}</h2>
		{#if form?.message}
			<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}
		{#if !data.params.checkin}
			<p class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{m.plan_detail_select_date()}</p>
		{/if}
		<div class="mt-3 space-y-3">
			{#each data.rooms as r}
				<div id="room-{r.room.slug}" class="flex scroll-mt-28 flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row sm:items-center {selectedRoom === r.room.slug ? 'border-brand-800 ring-1 ring-brand-800' : 'border-stone-200'}">
					<img src={r.room.photos[0]?.url} alt={r.room.name} class="h-24 w-full rounded-lg object-cover sm:w-40" />
					<div class="flex-1">
						<h3 class="font-medium text-brand-900">{r.room.name}</h3>
						<p class="text-xs text-stone-500">{m.plan_detail_capacity({ n: String(r.room.capacity), size: String(r.room.sizeM2) })}</p>
						{#if !r.fits}
							<p class="mt-1 text-xs text-red-600">{m.plan_detail_no_fit()}</p>
						{/if}
					</div>
					<div class="text-right">
						{#if r.quote}
							<p class="text-lg font-bold text-brand-900">
								{formatPrice(perPersonNight(r.quote.total))}<span class="text-xs font-normal text-stone-500">{m.price_unit_pp_night()}</span>
								<span class="block text-xs font-normal text-stone-500">
									{m.plan_detail_price_detail({ adults: String(data.params.adults), nights: String(data.params.nights), total: formatPrice(r.quote.total) })}
								</span>
							</p>
							{#if r.remaining !== null && r.remaining <= 2}
								<p class="text-xs font-medium text-red-600">{m.plan_detail_remaining({ n: String(r.remaining) })}</p>
							{/if}
							<form method="POST" action="?/hold" use:enhance class="mt-2">
								<input type="hidden" name="planId" value={data.plan.id} />
								<input type="hidden" name="roomTypeId" value={r.room.id} />
								<input type="hidden" name="checkin" value={data.params.checkin} />
								<input type="hidden" name="nights" value={data.params.nights} />
								<input type="hidden" name="adults" value={data.params.adults} />
								<button type="submit" class="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500">
									{m.plan_detail_book()}
								</button>
							</form>
						{:else if data.params.checkin && r.fits}
							<p class="text-sm font-medium text-stone-400">{m.plan_detail_sold_out()}</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- キャンセルポリシー -->
	<section class="mt-10 max-w-3xl rounded-xl bg-stone-100 p-5 text-sm">
		<h2 class="mb-2 font-medium">{m.plan_detail_cancel_policy()}</h2>
		<p class="text-stone-600">{data.plan.cancellationPolicy.note}</p>
	</section>
</div>

<!-- モバイル: 下部固定の料金バー（客室セクション表示中は隠す） -->
{#if !roomsInView}
	<div class="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur md:hidden">
		<div class="flex items-center gap-3">
			<div class="min-w-0 flex-1 leading-tight">
				{#if cheapest}
					<p class="text-lg font-bold text-brand-900">
						{formatPrice(perPersonNight(cheapest.total))}〜<span class="whitespace-nowrap text-[11px] font-normal text-stone-500">{m.price_unit_pp_night()}</span>
					</p>
					<p class="truncate text-[11px] text-stone-500">
						{m.plan_detail_price_detail({ adults: String(data.params.adults), nights: String(data.params.nights), total: formatPrice(cheapest.total) })}
					</p>
				{:else if soldOut}
					<p class="text-xs text-stone-500">{m.plan_price_sold_out()}</p>
				{:else if data.plan.basePrice > 0}
					<p class="text-lg font-bold text-brand-900">
						{formatPrice(data.plan.basePrice)}<span class="text-[11px] font-normal text-stone-500">{m.plan_card_base_price()}</span>
					</p>
				{:else}
					<p class="text-xs text-stone-500">{m.plan_price_cta_dates()}</p>
				{/if}
			</div>
			<a
				href={cheapest ? '#rooms' : '#cal'}
				class="shrink-0 rounded-lg bg-accent-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-accent-500"
			>
				{cheapest ? m.plan_price_cta_rooms() : m.plan_price_cta_dates()}
			</a>
		</div>
	</div>
{/if}
