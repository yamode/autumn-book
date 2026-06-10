<script lang="ts">
	import { formatYen } from '$lib/format';

	let { data } = $props();
</script>

<svelte:head><title>プラン ｜ 山人管理</title></svelte:head>

<div class="mb-4 flex items-center justify-between">
	<h1 class="text-lg font-bold text-stone-800">プラン — {data.currentFacility.name}</h1>
	<p class="text-xs text-stone-400">プランの新規作成（料金・在庫・キャンセル規定）は rms 側で行い、ここで「見せ方」を作ります</p>
</div>

<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
	{#each data.plans as plan}
		<a href="/admin/plans/{plan.id}" class="group overflow-hidden rounded-xl border border-stone-200 bg-white transition hover:shadow-md">
			<div class="relative">
				<img src={plan.photos[0]?.url} alt={plan.name} class="h-36 w-full object-cover" />
				<span class="absolute left-2 top-2 rounded-full px-2 py-0.5 text-xs font-medium {plan.isPublished ? 'bg-emerald-500 text-white' : 'bg-stone-600 text-white'}">
					{plan.isPublished ? '公開中' : '下書き'}
				</span>
			</div>
			<div class="p-3">
				<h2 class="text-sm font-medium text-stone-800 group-hover:underline">{plan.name}</h2>
				<p class="mt-0.5 truncate text-xs text-stone-500">{plan.headline}</p>
				<p class="mt-1.5 text-xs text-stone-400">
					{plan.mealPlan} ／ {[plan.payment.onsite ? '現地' : null, plan.payment.prepay ? '事前(' + plan.payment.prepayMethods.map((x) => (x === 'paypay' ? 'PayPay' : 'カード')).join('/') + ')' : null].filter(Boolean).join(' + ')}{plan.payment.prepayDiscountRate > 0 ? ' ' + Math.round(plan.payment.prepayDiscountRate * 100) + '%OFF' : ''} ／ 基準 {formatYen(plan.basePrice)}
				</p>
				<div class="mt-1.5 flex flex-wrap gap-1">
					{#each plan.highlightTags as t}
						<span class="rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] text-brand-700">{t}</span>
					{/each}
				</div>
			</div>
		</a>
	{/each}
</div>
