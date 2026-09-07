<script lang="ts">
	import { enhance } from '$app/forms';

	import Unavailable from '$lib/components/admin/Unavailable.svelte';
	import type { PreferenceItem, PreferenceOption } from '$lib/server/admin-app-data';

	let { data, form } = $props();

	const GROUPS = [
		{ value: 'meal', label: 'お食事' },
		{ value: 'room', label: 'お部屋' },
		{ value: 'personal', label: 'その他' }
	];
	const TYPES = [
		{ value: 'single', label: '択一' },
		{ value: 'multi', label: '複数選択' },
		{ value: 'text', label: '自由記述' },
		{ value: 'boolean', label: 'はい／いいえ' },
		{ value: 'date', label: '日付' }
	];
	const needsOptions = (t: string) => t === 'single' || t === 'multi';

	const isAdmin = $derived(data.user?.role === 'admin');

	// 各項目の編集状態（value_type を変えると選択肢欄の出し入れが要る）
	let types = $state<Record<string, string>>({});
	let extraOptions = $state<Record<string, PreferenceOption[]>>({});

	function typeOf(item: PreferenceItem) {
		return types[item.key] ?? item.value_type;
	}
	function addOption(key: string) {
		extraOptions[key] = [...(extraOptions[key] ?? []), { value: '', label: '' }];
	}

	// 新規項目
	let newType = $state('single');
	let newOptions = $state<PreferenceOption[]>([{ value: '', label: '' }]);

	const grouped = $derived(
		GROUPS.map((g) => ({
			...g,
			items: (data.items ?? []).filter((i: PreferenceItem) => i.group_name === g.value)
		}))
	);
</script>

<svelte:head><title>好み登録項目 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">好み登録項目</h1>
<p class="mb-4 text-xs text-stone-400">
	アプリのマイページ「ご滞在の好み」に表示される設問です。回答は PMS のスタッフ画面で閲覧できます。
</p>

{#if data.unavailable}
	<Unavailable authMode={data.authMode} dataSource={data.dataSource} />
{:else}
	{#if data.error}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{data.error}
		</div>
	{/if}
	{#if form?.message}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{form.message}
		</div>
	{/if}
	{#if form?.saved}
		<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
			「{form.saved}」を保存しました。
		</div>
	{/if}
	{#if !isAdmin}
		<div class="mb-4 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-500">
			好み登録項目の編集は管理者のみ行えます（スタッフは閲覧のみ）。
		</div>
	{/if}

	{#each grouped as group}
		<h2 class="mt-6 mb-2 text-sm font-bold text-stone-700">
			{group.label} <span class="font-mono text-xs font-normal text-stone-400">({group.value})</span>
		</h2>

		{#if group.items.length === 0}
			<p class="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-400">
				このグループの項目はありません。
			</p>
		{/if}

		<div class="space-y-3">
			{#each group.items as item (item.key)}
				{@const usage = data.usageMap?.[item.key]}
				{@const t = typeOf(item)}
				<form
					method="POST"
					action="?/save"
					use:enhance
					class="rounded-xl border border-stone-200 bg-white p-4 {item.is_active ? '' : 'opacity-60'}"
				>
					<input type="hidden" name="key" value={item.key} />

					<div class="mb-3 flex flex-wrap items-center gap-3">
						<span class="font-mono text-xs text-stone-400">{item.key}</span>
						<span class="text-xs text-stone-500">
							回答 {usage?.answers ?? 0} 件
						</span>
						{#if !item.is_active}
							<span class="rounded bg-stone-100 px-2 py-0.5 text-xs text-stone-500">非表示</span>
						{/if}
					</div>

					<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<label class="text-sm">
							<span class="mb-1 block text-xs text-stone-500">ラベル</span>
							<input
								name="label"
								value={item.label}
								required
								disabled={!isAdmin}
								class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
							/>
						</label>
						<label class="text-sm">
							<span class="mb-1 block text-xs text-stone-500">グループ</span>
							<select
								name="groupName"
								disabled={!isAdmin}
								class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
							>
								{#each GROUPS as g}
									<option value={g.value} selected={g.value === item.group_name}>{g.label}</option>
								{/each}
							</select>
						</label>
						<label class="text-sm">
							<span class="mb-1 block text-xs text-stone-500">
								形式{(usage?.answers ?? 0) > 0 ? '（回答ありのため変更不可）' : ''}
							</span>
							<select
								name="valueType"
								disabled={!isAdmin || (usage?.answers ?? 0) > 0}
								onchange={(e) => (types[item.key] = e.currentTarget.value)}
								class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
							>
								{#each TYPES as ty}
									<option value={ty.value} selected={ty.value === item.value_type}>{ty.label}</option>
								{/each}
							</select>
							{#if (usage?.answers ?? 0) > 0}
								<input type="hidden" name="valueType" value={item.value_type} />
							{/if}
						</label>
						<label class="text-sm">
							<span class="mb-1 block text-xs text-stone-500">表示順</span>
							<input
								name="sortOrder"
								type="number"
								value={item.sort_order}
								disabled={!isAdmin}
								class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
							/>
						</label>
					</div>

					{#if needsOptions(t)}
						<div class="mt-3">
							<p class="mb-1 text-xs text-stone-500">選択肢（value / ラベル / 回答数）</p>
							<div class="space-y-1.5">
								{#each item.options as opt}
									{@const used = usage?.option_counts?.[opt.value] ?? 0}
									<div class="flex flex-wrap items-center gap-2">
										<input
											name="optValue"
											value={opt.value}
											disabled={!isAdmin}
											class="w-32 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
										/>
										<input
											name="optLabel"
											value={opt.label}
											disabled={!isAdmin}
											class="w-48 rounded-md border border-stone-300 px-2 py-1 text-sm"
										/>
										<span class="text-xs {used > 0 ? 'text-amber-700' : 'text-stone-400'}">
											{used} 件{used > 0 ? '（使用中・削除不可）' : ''}
										</span>
									</div>
								{/each}
								{#each extraOptions[item.key] ?? [] as _, i}
									<div class="flex flex-wrap items-center gap-2">
										<input
											name="optValue"
											placeholder="value"
											class="w-32 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
										/>
										<input
											name="optLabel"
											placeholder="ラベル"
											class="w-48 rounded-md border border-stone-300 px-2 py-1 text-sm"
										/>
										<span class="text-xs text-stone-400">新規 {i + 1}</span>
									</div>
								{/each}
							</div>
							{#if isAdmin}
								<button
									type="button"
									onclick={() => addOption(item.key)}
									class="mt-2 text-xs font-medium text-brand-800 underline">＋ 選択肢を追加</button
								>
							{/if}
							<p class="mt-1 text-xs text-stone-400">
								value を空にすると、その選択肢は削除されます（回答で使われている値は削除できません）。
							</p>
						</div>
					{/if}

					<div class="mt-3 flex flex-wrap items-center gap-4">
						<label class="flex items-center gap-2 text-sm text-stone-700">
							<input type="checkbox" name="isActive" checked={item.is_active} disabled={!isAdmin} />
							アプリに表示する
						</label>
						{#if isAdmin}
							<button
								type="submit"
								class="rounded-lg bg-brand-800 px-4 py-1.5 text-sm font-medium text-white"
								onclick={(e) => {
									if (item.is_active && !e.currentTarget.form?.isActive?.checked) {
										if (!confirm(`「${item.label}」をアプリから非表示にします。回答は保持されます。`)) {
											e.preventDefault();
										}
									}
								}}>保存</button
							>
						{/if}
					</div>
				</form>
			{/each}
		</div>
	{/each}

	{#if isAdmin}
		<h2 class="mt-8 mb-2 text-sm font-bold text-stone-700">＋ 新しい項目</h2>
		<form
			method="POST"
			action="?/save"
			use:enhance
			class="rounded-xl border border-stone-200 bg-white p-4"
		>
			<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<label class="text-sm">
					<span class="mb-1 block text-xs text-stone-500">key（作成後は変更できません）</span>
					<input
						name="key"
						required
						pattern="[a-z][a-z0-9_]&#123;1,31&#125;"
						placeholder="pillow_type"
						class="w-full rounded-md border border-stone-300 px-2 py-1.5 font-mono text-sm"
					/>
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-xs text-stone-500">ラベル</span>
					<input
						name="label"
						required
						class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
					/>
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-xs text-stone-500">グループ</span>
					<select
						name="groupName"
						class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
					>
						{#each GROUPS as g}<option value={g.value}>{g.label}</option>{/each}
					</select>
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-xs text-stone-500">形式</span>
					<select
						name="valueType"
						bind:value={newType}
						class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
					>
						{#each TYPES as ty}<option value={ty.value}>{ty.label}</option>{/each}
					</select>
				</label>
				<label class="text-sm">
					<span class="mb-1 block text-xs text-stone-500">表示順</span>
					<input
						name="sortOrder"
						type="number"
						value={(data.items?.length ?? 0) + 1}
						class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
					/>
				</label>
			</div>

			{#if needsOptions(newType)}
				<div class="mt-3">
					<p class="mb-1 text-xs text-stone-500">選択肢</p>
					<div class="space-y-1.5">
						{#each newOptions as _, i}
							<div class="flex items-center gap-2">
								<input
									name="optValue"
									placeholder="value"
									class="w-32 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
								/>
								<input
									name="optLabel"
									placeholder="ラベル"
									class="w-48 rounded-md border border-stone-300 px-2 py-1 text-sm"
								/>
								<span class="text-xs text-stone-400">{i + 1}</span>
							</div>
						{/each}
					</div>
					<button
						type="button"
						onclick={() => (newOptions = [...newOptions, { value: '', label: '' }])}
						class="mt-2 text-xs font-medium text-brand-800 underline">＋ 選択肢を追加</button
					>
				</div>
			{/if}

			<div class="mt-3 flex items-center gap-4">
				<label class="flex items-center gap-2 text-sm text-stone-700">
					<input type="checkbox" name="isActive" checked />
					すぐに表示する
				</label>
				<button type="submit" class="rounded-lg bg-accent-600 px-4 py-1.5 text-sm font-medium text-white">
					追加する
				</button>
			</div>
		</form>
	{/if}
{/if}
