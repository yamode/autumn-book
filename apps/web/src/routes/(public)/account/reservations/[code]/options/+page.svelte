<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatPrice, formatDate } from '$lib/format';
	import { addDays } from '@autumn-book/core';
	import * as m from '$lib/paraglide/messages';
	import type { OptionItem, OptionCategory } from '$lib/types';

	let { data, form } = $props();

	const CATEGORY_ORDER: OptionCategory[] = ['meal', 'spa', 'activity', 'amenity', 'personalize', 'other'];

	function categoryLabel(cat: OptionCategory): string {
		switch (cat) {
			case 'meal': return m.options_category_meal();
			case 'spa': return m.options_category_spa();
			case 'activity': return m.options_category_activity();
			case 'amenity': return m.options_category_amenity();
			case 'personalize': return m.options_category_personalize();
			default: return m.options_category_other();
		}
	}

	function priceTypeLabel(pt: OptionItem['priceType']): string {
		switch (pt) {
			case 'per_person': return m.options_price_per_person();
			case 'per_unit': return m.options_price_per_unit();
			default: return m.options_price_per_stay();
		}
	}

	// 提供日の候補（チェックイン日〜チェックアウト日）
	let serviceDates = $derived.by(() => {
		const dates: string[] = [];
		let d = data.checkin;
		while (d <= data.checkout) {
			dates.push(d);
			d = addDays(d, 1);
		}
		return dates;
	});

	// カテゴリ順にグループ化（該当商品のあるカテゴリのみ）
	let grouped = $derived(
		CATEGORY_ORDER.map((cat) => ({
			cat,
			items: (data.items as OptionItem[]).filter((o) => o.category === cat)
		})).filter((g) => g.items.length > 0)
	);
</script>

<svelte:head><title>{m.options_page_title()}</title></svelte:head>

<nav class="mb-4 text-xs text-stone-400">
	<a href="/account" class="hover:underline">{m.reservation_breadcrumb_list()}</a> /
	<a href="/account/reservations/{data.code}" class="hover:underline">{data.code}</a> /
	{m.options_add()}
</nav>

<h1 class="text-xl font-semibold text-brand-900">{m.options_heading()}</h1>
<p class="mt-1 text-sm text-stone-500">{m.options_lead()}</p>

{#if form?.message}
	<p class="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
{/if}

{#if grouped.length === 0}
	<p class="mt-6 rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-400">{m.options_catalog_empty()}</p>
{:else}
	<form method="POST" action="?/add" use:enhance class="mt-6 space-y-8">
		{#each grouped as g (g.cat)}
			<section>
				<h2 class="mb-3 text-sm font-medium text-brand-900">{categoryLabel(g.cat)}</h2>
				<div class="grid gap-4 md:grid-cols-2">
					{#each g.items as o (o.id)}
						<div class="rounded-2xl border border-stone-200 bg-white p-4">
							{#if o.photos.length > 0}
								<img src={o.photos[0].url} alt={o.name} class="mb-3 h-32 w-full rounded-lg object-cover" />
							{/if}
							<div class="flex items-start justify-between gap-2">
								<h3 class="font-medium text-stone-800">{o.name}</h3>
								<span class="shrink-0 text-sm font-medium {o.unitPrice === 0 ? 'text-emerald-700' : 'text-stone-700'}">
									{o.unitPrice === 0 ? m.options_free() : `${formatPrice(o.unitPrice)}`}
								</span>
							</div>
							{#if o.unitPrice > 0}
								<p class="text-right text-xs text-stone-400">{priceTypeLabel(o.priceType)}</p>
							{/if}
							{#if o.description}
								<p class="mt-1 text-xs leading-relaxed text-stone-500">{o.description}</p>
							{/if}
							<p class="mt-2 text-xs text-stone-400">{m.options_deadline_fmt({ days: String(Math.max(1, Math.ceil(o.leadTimeHours / 24))) })}</p>

							<div class="mt-3 flex flex-wrap items-end gap-3">
								{#if o.priceType === 'per_stay'}
									<label class="flex items-center gap-1.5 text-xs text-stone-600">
										<input type="checkbox" name="qty_{o.id}" value="1" class="h-4 w-4" />
										{m.options_apply()}
									</label>
								{:else}
									<label class="text-xs text-stone-500">
										{m.options_qty_label()}
										<input
											type="number"
											name="qty_{o.id}"
											min="0"
											max="20"
											value="0"
											class="mt-1 block w-20 rounded-md border border-stone-300 px-2 py-1.5 text-sm"
										/>
									</label>
								{/if}
								{#if o.requiresServiceDate}
									<label class="text-xs text-stone-500">
										{m.options_service_date_label()}
										<select name="date_{o.id}" class="mt-1 block rounded-md border border-stone-300 px-2 py-1.5 text-sm">
											{#each serviceDates as d}
												<option value={d}>{formatDate(d)}</option>
											{/each}
										</select>
									</label>
								{/if}
							</div>
							<input
								name="note_{o.id}"
								placeholder={m.options_note_placeholder()}
								class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm"
							/>
						</div>
					{/each}
				</div>
			</section>
		{/each}

		<div class="flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-50 p-4">
			<p class="text-xs text-stone-500">{m.options_local_payment_note()}</p>
			<button type="submit" class="rounded-lg bg-accent-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-accent-500">
				{m.options_submit()}
			</button>
		</div>
	</form>
{/if}
