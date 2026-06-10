<script lang="ts">
	import { enhance } from '$app/forms';
	import PhotoGallery from '$lib/components/PhotoGallery.svelte';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import PriceCalendar from '$lib/components/PriceCalendar.svelte';
	import CancelPolicyNote from '$lib/components/CancelPolicyNote.svelte';
	import { formatYen } from '$lib/format';

	let { data, form } = $props();
	let base = $derived(`/${data.facility.brandSlug}/${data.facility.slug}`);
	let qs = $derived(
		data.params.checkin ? `checkin=${data.params.checkin}&nights=${data.params.nights}&adults=${data.params.adults}` : ''
	);

	function shiftMonth(ym: string, delta: number): string {
		const [y, m] = ym.split('-').map(Number);
		const d = new Date(y, m - 1 + delta, 1);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}
</script>

<svelte:head>
	<title>{data.plan.name} ｜ {data.facility.name}</title>
	<meta name="description" content={data.plan.headline} />
</svelte:head>

<div class="mx-auto max-w-5xl px-4 py-8">
	<nav class="mb-2 text-xs text-stone-400">
		<a href={base} class="hover:underline">{data.facility.name}</a> /
		<a href="{base}/plans" class="hover:underline">プラン一覧</a> / {data.plan.name}
	</nav>

	<div class="grid gap-6 md:grid-cols-[1fr_320px]">
		<div>
			<PhotoGallery photos={[...data.plan.photos, ...data.facility.photos.slice(0, 3)]} />
		</div>
		<div class="space-y-3">
			<div class="flex flex-wrap gap-1.5">
				{#each data.plan.highlightTags as tag}
					<span class="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">{tag}</span>
				{/each}
			</div>
			<h1 class="font-display text-2xl leading-snug text-brand-900">{data.plan.name}</h1>
			<p class="text-sm text-stone-600">{data.plan.headline}</p>
			<dl class="space-y-1 rounded-lg bg-stone-100 p-3 text-sm">
				<div class="flex justify-between"><dt class="text-stone-500">お食事</dt><dd>{data.plan.mealPlan}</dd></div>
				<div class="flex justify-between">
					<dt class="text-stone-500">お支払い</dt>
					<dd>{data.plan.paymentMethod === 'card' ? '事前カード決済' : '現地払い'}</dd>
				</div>
				{#if data.params.checkin}
					<div class="flex justify-between text-emerald-700">
						<dt>キャンセル</dt>
						<dd><CancelPolicyNote policy={data.plan.cancellationPolicy} checkin={data.params.checkin} /></dd>
					</div>
				{/if}
			</dl>
		</div>
	</div>

	<!-- プラン本文（A-05 で作成した Markdown） -->
	<section class="mt-10 max-w-3xl">
		<MarkdownView source={data.plan.description} />
	</section>

	<!-- 料金カレンダー -->
	<section class="mt-10" id="cal">
		<h2 class="font-display mb-1 text-xl text-brand-900">料金カレンダー</h2>
		<p class="mb-3 text-sm text-stone-500">日付を選ぶと下の客室料金が更新されます。</p>
		<div class="max-w-xl">
			<PriceCalendar
				days={data.calendar}
				yearMonth={data.calMonth}
				makeDayHref={(date) =>
					`${base}/plans/${data.plan.slug}?checkin=${date}&nights=${data.params.nights}&adults=${data.params.adults}#rooms`}
				prevHref="{base}/plans/{data.plan.slug}?{qs ? qs + '&' : ''}cal={shiftMonth(data.calMonth, -1)}#cal"
				nextHref="{base}/plans/{data.plan.slug}?{qs ? qs + '&' : ''}cal={shiftMonth(data.calMonth, 1)}#cal"
			/>
		</div>
	</section>

	<!-- 客室選択 -->
	<section class="mt-10" id="rooms">
		<h2 class="font-display mb-3 text-xl text-brand-900">客室を選ぶ</h2>
		{#if form?.message}
			<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}
		{#if !data.params.checkin}
			<p class="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">カレンダーまたは検索バーで日付を選ぶと、ご予約に進めます。</p>
		{/if}
		<div class="mt-3 space-y-3">
			{#each data.rooms as r}
				<div class="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row sm:items-center">
					<img src={r.room.photos[0]?.url} alt={r.room.name} class="h-24 w-full rounded-lg object-cover sm:w-40" />
					<div class="flex-1">
						<h3 class="font-medium text-brand-900">{r.room.name}</h3>
						<p class="text-xs text-stone-500">定員{r.room.capacity}名・{r.room.sizeM2}㎡</p>
						{#if !r.fits}
							<p class="mt-1 text-xs text-red-600">ご指定の人数ではご利用いただけません</p>
						{/if}
					</div>
					<div class="text-right">
						{#if r.quote}
							<p class="text-lg font-bold text-brand-900">
								{formatYen(r.quote.total)}
								<span class="block text-xs font-normal text-stone-500">
									{data.params.adults}名1室・{data.params.nights}泊 税込（1名 {formatYen(r.quote.perPerson)}）
								</span>
							</p>
							{#if r.remaining !== null && r.remaining <= 2}
								<p class="text-xs font-medium text-red-600">残り{r.remaining}室</p>
							{/if}
							<form method="POST" action="?/hold" use:enhance class="mt-2">
								<input type="hidden" name="planId" value={data.plan.id} />
								<input type="hidden" name="roomTypeId" value={r.room.id} />
								<input type="hidden" name="checkin" value={data.params.checkin} />
								<input type="hidden" name="nights" value={data.params.nights} />
								<input type="hidden" name="adults" value={data.params.adults} />
								<button type="submit" class="rounded-lg bg-accent-600 px-5 py-2 text-sm font-medium text-white hover:bg-accent-500">
									この客室で予約する
								</button>
							</form>
						{:else if data.params.checkin && r.fits}
							<p class="text-sm font-medium text-stone-400">満室</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- キャンセルポリシー -->
	<section class="mt-10 max-w-3xl rounded-xl bg-stone-100 p-5 text-sm">
		<h2 class="mb-2 font-medium">キャンセルポリシー</h2>
		<p class="text-stone-600">{data.plan.cancellationPolicy.note}</p>
	</section>
</div>
