<script lang="ts">
	import type { CouponRow } from '$lib/server/admin-app-data';

	// クーポンの割引条件フォーム（/new と /[id] で共用）。
	// 配布済み（frozen）のときは割引条件を編集させない — 会員が見ている条件が後から変わるため。
	let {
		coupon = null,
		facilities,
		frozen = false,
		disabled = false
	}: {
		coupon?: CouponRow | null;
		facilities: { id: string; name: string }[];
		frozen?: boolean;
		disabled?: boolean;
	} = $props();

	// 未操作のうちは既存値を出し、ユーザーが変えたらその値を優先する
	let discountTypeOverride = $state<string | null>(null);
	const discountType = $derived(discountTypeOverride ?? coupon?.discount_type ?? 'fixed');

	const d = (s: string | null | undefined) => (s ? s.slice(0, 10) : '');
	const lockCondition = $derived(frozen || disabled);
</script>

<div class="space-y-4">
	<label class="block text-sm">
		<span class="mb-1 block text-xs text-stone-500">名前 *（アプリに表示されます）</span>
		<input
			name="name"
			required
			{disabled}
			value={coupon?.name ?? ''}
			placeholder="秋の感謝券"
			class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
		/>
	</label>

	<label class="block text-sm">
		<span class="mb-1 block text-xs text-stone-500">説明（任意）</span>
		<input
			name="description"
			{disabled}
			value={coupon?.description ?? ''}
			placeholder="会員の皆さまへ。秋のご宿泊にご利用ください。"
			class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
		/>
	</label>

	{#if frozen}
		<p class="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
			配布済みのため割引条件は変更できません。条件を変えるには無効化して新しいクーポンを作成してください。
		</p>
	{/if}

	<div class="grid gap-4 sm:grid-cols-3">
		<div class="text-sm">
			<span class="mb-1 block text-xs text-stone-500">割引 *</span>
			<div class="flex items-center gap-2">
				<select
					name="discountType"
					value={discountType}
					onchange={(e) => (discountTypeOverride = e.currentTarget.value)}
					disabled={lockCondition}
					class="rounded-md border border-stone-300 px-2 py-2 text-sm"
				>
					<option value="fixed">金額</option>
					<option value="percent">割合</option>
				</select>
				<input
					name="discountValue"
					type="number"
					min="1"
					max={discountType === 'percent' ? 100 : undefined}
					required
					disabled={lockCondition}
					value={coupon?.discount_value ?? ''}
					class="w-28 rounded-md border border-stone-300 px-2 py-2 text-sm"
				/>
				<span class="text-sm text-stone-500">{discountType === 'percent' ? '%' : '円'}</span>
			</div>
		</div>

		<label class="block text-sm">
			<span class="mb-1 block text-xs text-stone-500">最低予約金額</span>
			<input
				name="minTotal"
				type="number"
				min="0"
				disabled={lockCondition}
				value={coupon?.min_total ?? 0}
				class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
			/>
		</label>

		<label class="block text-sm">
			<span class="mb-1 block text-xs text-stone-500">対象施設</span>
			<select
				name="facilityId"
				disabled={lockCondition}
				class="w-full rounded-md border border-stone-300 px-2 py-2 text-sm"
			>
				<option value="" selected={!coupon?.facility_id}>全施設共通</option>
				{#each facilities as f}
					<option value={f.id} selected={coupon?.facility_id === f.id}>{f.name}</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="text-sm">
			<span class="mb-1 block text-xs text-stone-500">
				利用できる期間 *（会員が予約を確定できる日）
			</span>
			<div class="flex items-center gap-2">
				<input
					name="validFrom"
					type="date"
					required
					disabled={lockCondition}
					value={d(coupon?.valid_from)}
					class="rounded-md border border-stone-300 px-2 py-2 text-sm"
				/>
				<span class="text-stone-400">〜</span>
				<input
					name="validUntil"
					type="date"
					required
					{disabled}
					value={d(coupon?.valid_until)}
					class="rounded-md border border-stone-300 px-2 py-2 text-sm"
				/>
			</div>
			{#if frozen}
				<p class="mt-1 text-xs text-stone-400">終了日の延長のみ可能です。</p>
			{/if}
		</div>

		<div class="text-sm">
			<span class="mb-1 block text-xs text-stone-500">対象の宿泊日（空欄なら制限なし）</span>
			<div class="flex items-center gap-2">
				<input
					name="stayFrom"
					type="date"
					disabled={lockCondition}
					value={d(coupon?.stay_from)}
					class="rounded-md border border-stone-300 px-2 py-2 text-sm"
				/>
				<span class="text-stone-400">〜</span>
				<input
					name="stayUntil"
					type="date"
					disabled={lockCondition}
					value={d(coupon?.stay_until)}
					class="rounded-md border border-stone-300 px-2 py-2 text-sm"
				/>
			</div>
		</div>
	</div>

	<p class="rounded-lg bg-stone-50 p-2 text-xs text-stone-500">
		「利用できる期間」は<strong>予約する日</strong>、「対象の宿泊日」は<strong>泊まる日</strong>です。別の軸なのでご注意ください。
	</p>

	<label class="flex items-center gap-2 text-sm text-stone-700">
		<input type="checkbox" name="isActive" checked={coupon ? coupon.is_active : true} {disabled} />
		有効（会員がすぐ使える状態にする）
	</label>
</div>
