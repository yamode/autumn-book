<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	const CATEGORIES: { value: string; label: string }[] = [
		{ value: 'meal', label: 'お食事' },
		{ value: 'spa', label: 'スパ・マッサージ' },
		{ value: 'activity', label: 'アクティビティ' },
		{ value: 'amenity', label: 'アメニティ' },
		{ value: 'personalize', label: 'パーソナライズ' },
		{ value: 'other', label: 'その他' }
	];
	const PRICE_TYPES: { value: string; label: string }[] = [
		{ value: 'per_person', label: '1名あたり' },
		{ value: 'per_unit', label: '1個あたり' },
		{ value: 'per_stay', label: '1滞在あたり' }
	];
	function categoryLabel(v: string) {
		return CATEGORIES.find((c) => c.value === v)?.label ?? v;
	}

	// 翻訳の展開状態
	let expandedTr = $state<string | null>(null);
	let trLocaleById = $state<Record<string, 'en' | 'zh-TW'>>({});
	function trLocale(id: string): 'en' | 'zh-TW' {
		return trLocaleById[id] ?? 'en';
	}
</script>

<svelte:head><title>オプション管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">オプション管理（滞在アレンジ） — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-400">
	会員が予約詳細から事前予約できるオプション商品です。会計は宿泊料金と分離し、現地精算で扱います。公開すると会員のオプション追加画面に表示されます。
</p>

{#if form?.added}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">追加しました。</p>{/if}
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

<!-- 当日提供リスト -->
<div class="mb-6 rounded-xl border border-stone-200 bg-white p-4">
	<h2 class="text-sm font-medium text-stone-700">本日（{data.today}）の提供リスト</h2>
	{#if data.todayOrders.length === 0}
		<p class="mt-2 text-xs text-stone-400">本日提供予定のオプションはありません。</p>
	{:else}
		<table class="mt-2 w-full text-left text-xs">
			<thead class="text-stone-400">
				<tr>
					<th class="py-1">予約番号</th>
					<th class="py-1">ご宿泊者</th>
					<th class="py-1">オプション</th>
					<th class="py-1">区分</th>
					<th class="py-1 text-right">数量</th>
					<th class="py-1">要望</th>
				</tr>
			</thead>
			<tbody>
				{#each data.todayOrders as o (o.orderId)}
					<tr class="border-t border-stone-100">
						<td class="py-1 font-mono">{o.bookingCode}</td>
						<td class="py-1">{o.guestName}</td>
						<td class="py-1">{o.optionName}</td>
						<td class="py-1 text-stone-500">{categoryLabel(o.category)}</td>
						<td class="py-1 text-right">{o.quantity}</td>
						<td class="py-1 text-stone-500">{o.note ?? ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<!-- 商品一覧・編集 -->
<div class="space-y-3">
	{#each data.items as o (o.id)}
		<div class="rounded-xl border border-stone-200 bg-white">
			<form method="POST" action="?/save" use:enhance class="p-4 text-sm">
				<input type="hidden" name="optionId" value={o.id} />
				<div class="flex flex-wrap items-center gap-2">
					<input name="name" value={o.name} placeholder="商品名" class="min-w-48 flex-1 rounded-md border border-stone-300 px-3 py-1.5 font-medium" />
					<input name="code" value={o.code} placeholder="コード" class="w-32 rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
					<label class="flex items-center gap-1.5 text-xs">
						<input type="checkbox" name="isActive" checked={o.isActive} class="h-4 w-4" /> 公開
					</label>
					{#if form?.saved === o.id}<span class="text-xs text-emerald-600">✔</span>{/if}
				</div>
				<textarea name="description" rows="2" placeholder="説明（Markdown 可）" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5 text-sm">{o.description}</textarea>
				<div class="mt-2 flex flex-wrap gap-2 text-xs">
					<label class="flex flex-col gap-1">区分
						<select name="category" value={o.category} class="rounded-md border border-stone-300 px-2 py-1.5">
							{#each CATEGORIES as c}<option value={c.value}>{c.label}</option>{/each}
						</select>
					</label>
					<label class="flex flex-col gap-1">課金単位
						<select name="priceType" value={o.priceType} class="rounded-md border border-stone-300 px-2 py-1.5">
							{#each PRICE_TYPES as p}<option value={p.value}>{p.label}</option>{/each}
						</select>
					</label>
					<label class="flex flex-col gap-1">単価（税込円）
						<input type="number" name="unitPrice" value={o.unitPrice} min="0" class="w-28 rounded-md border border-stone-300 px-2 py-1.5" />
					</label>
					<label class="flex flex-col gap-1">締切（時間前）
						<input type="number" name="leadTimeHours" value={o.leadTimeHours} min="0" class="w-24 rounded-md border border-stone-300 px-2 py-1.5" />
					</label>
					<label class="flex flex-col gap-1">在庫
						<select name="stockType" value={o.stockType} class="rounded-md border border-stone-300 px-2 py-1.5">
							<option value="none">無制限</option>
							<option value="per_day">日別上限</option>
						</select>
					</label>
					<label class="flex flex-col gap-1">日別上限
						<input type="number" name="dailyCapacity" value={o.dailyCapacity ?? ''} min="0" class="w-24 rounded-md border border-stone-300 px-2 py-1.5" />
					</label>
					<label class="flex flex-col gap-1">表示順
						<input type="number" name="sortOrder" value={o.sortOrder} class="w-20 rounded-md border border-stone-300 px-2 py-1.5" />
					</label>
				</div>
				<div class="mt-2 flex flex-wrap items-center gap-4 text-xs">
					<label class="flex items-center gap-1.5"><input type="checkbox" name="requiresServiceDate" checked={o.requiresServiceDate} class="h-4 w-4" /> 提供日を指定する</label>
					<label class="flex items-center gap-1.5"><input type="checkbox" name="memberOnly" checked={o.memberOnly} class="h-4 w-4" /> 会員限定</label>
				</div>
				<div class="mt-3 flex items-center gap-2">
					<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
					<button type="button" onclick={() => { expandedTr = expandedTr === o.id ? null : o.id; }} class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-500 hover:bg-stone-50">
						{expandedTr === o.id ? '翻訳を閉じる ▲' : '翻訳 ▼'}
					</button>
				</div>
			</form>

			{#if expandedTr === o.id}
				<div class="border-t border-stone-100 px-4 pb-4 pt-3">
					<div class="mb-3 flex gap-2">
						{#each (['en', 'zh-TW'] as const) as loc}
							<button type="button" onclick={() => { trLocaleById = { ...trLocaleById, [o.id]: loc }; }}
								class="rounded-md px-3 py-1 text-xs font-medium transition-colors {trLocale(o.id) === loc ? 'bg-brand-800 text-white' : 'border border-stone-300 bg-white text-stone-500 hover:bg-stone-50'}">
								{loc === 'en' ? 'English (en)' : '繁體中文 (zh-TW)'}
							</button>
						{/each}
					</div>
					{#if form?.translationSaved === o.id}<p class="mb-2 rounded bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800">翻訳を保存しました。</p>{/if}
					<form method="POST" action="?/saveTranslation" use:enhance class="grid gap-3 lg:grid-cols-2">
						<input type="hidden" name="optionId" value={o.id} />
						<input type="hidden" name="locale" value={trLocale(o.id)} />
						<div class="space-y-2 text-xs text-stone-500">
							<p class="font-medium">日本語（参照）</p>
							<p><span class="text-stone-400">商品名：</span>{o.name}</p>
							<p><span class="text-stone-400">説明：</span>{o.description}</p>
						</div>
						<div class="space-y-2 text-xs">
							<p class="font-medium text-stone-500">{trLocale(o.id) === 'en' ? 'English' : '繁體中文'}（翻訳入力）</p>
							<input name="name" value={data.optionTranslations[o.id]?.[trLocale(o.id)]?.fields?.name ?? ''} placeholder="Name" class="w-full rounded-md border border-stone-300 px-2 py-1.5" />
							<textarea name="description" rows="3" class="w-full rounded-md border border-stone-300 px-2 py-1.5" placeholder="Description">{data.optionTranslations[o.id]?.[trLocale(o.id)]?.fields?.description ?? ''}</textarea>
							<div class="flex items-center gap-3">
								<label class="flex items-center gap-1.5">
									<input type="checkbox" name="isPublished" checked={data.optionTranslations[o.id]?.[trLocale(o.id)]?.isPublished ?? false} class="h-4 w-4" />
									<span>公開</span>
								</label>
								<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-white hover:bg-brand-700">翻訳を保存</button>
							</div>
						</div>
					</form>
				</div>
			{/if}
		</div>
	{/each}
</div>

<!-- 新規追加 -->
<form method="POST" action="?/add" use:enhance class="mt-6 rounded-xl border border-dashed border-stone-300 bg-white p-4 text-sm">
	<input type="hidden" name="facilityId" value={data.currentFacility.id} />
	<h2 class="font-medium text-stone-700">＋ 新しいオプションを追加</h2>
	<div class="mt-2 flex flex-wrap gap-2">
		<input name="name" placeholder="商品名" class="min-w-48 flex-1 rounded-md border border-stone-300 px-3 py-1.5" />
		<input name="code" placeholder="コード（例 spa-basic）" class="w-40 rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
	</div>
	<textarea name="description" rows="2" placeholder="説明（Markdown 可）" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5"></textarea>
	<div class="mt-2 flex flex-wrap gap-2 text-xs">
		<label class="flex flex-col gap-1">区分
			<select name="category" class="rounded-md border border-stone-300 px-2 py-1.5">
				{#each CATEGORIES as c}<option value={c.value}>{c.label}</option>{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1">課金単位
			<select name="priceType" class="rounded-md border border-stone-300 px-2 py-1.5">
				{#each PRICE_TYPES as p}<option value={p.value}>{p.label}</option>{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1">単価（税込円）
			<input type="number" name="unitPrice" value="0" min="0" class="w-28 rounded-md border border-stone-300 px-2 py-1.5" />
		</label>
		<label class="flex flex-col gap-1">締切（時間前）
			<input type="number" name="leadTimeHours" value="24" min="0" class="w-24 rounded-md border border-stone-300 px-2 py-1.5" />
		</label>
		<label class="flex flex-col gap-1">表示順
			<input type="number" name="sortOrder" value="0" class="w-20 rounded-md border border-stone-300 px-2 py-1.5" />
		</label>
	</div>
	<div class="mt-2 flex flex-wrap items-center gap-4 text-xs">
		<label class="flex items-center gap-1.5"><input type="checkbox" name="requiresServiceDate" class="h-4 w-4" /> 提供日を指定する</label>
		<label class="flex items-center gap-1.5"><input type="checkbox" name="memberOnly" checked class="h-4 w-4" /> 会員限定</label>
		<label class="flex items-center gap-1.5"><input type="checkbox" name="isActive" class="h-4 w-4" /> すぐに公開</label>
	</div>
	<button type="submit" class="mt-3 rounded-md bg-accent-600 px-4 py-1.5 text-xs text-white hover:bg-accent-500">追加</button>
</form>
