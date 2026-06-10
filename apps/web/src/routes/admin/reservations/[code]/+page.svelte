<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatYen, formatDateLongJa } from '$lib/format';

	let { data, form } = $props();
	let b = $derived(data.booking);
	let showCancel = $state(false);
	let waive = $state(false);
</script>

<svelte:head><title>{b.code} ｜ 予約管理</title></svelte:head>

<nav class="mb-3 text-xs text-stone-400"><a href="/admin/reservations" class="hover:underline">予約管理</a> / {b.code}</nav>

{#if form?.cancelled}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">キャンセル処理を実行しました（監査ログに記録）。</p>{/if}
{#if form?.resent}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">確定メールを再送しました。</p>{/if}
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

<div class="grid gap-4 lg:grid-cols-[1fr_320px]">
	<div class="rounded-xl border border-stone-200 bg-white p-5">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h1 class="text-lg font-bold text-stone-800">{b.code}</h1>
			<span class="rounded-full px-3 py-1 text-xs {b.status === 'reserved' ? 'bg-emerald-50 text-emerald-700' : b.status === 'cancelled' ? 'bg-stone-100 text-stone-500' : 'bg-blue-50 text-blue-600'}">
				{b.status === 'reserved' ? '予約済' : b.status === 'cancelled' ? 'キャンセル済' : '宿泊済'}
			</span>
		</div>
		<dl class="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
			<div><dt class="text-xs text-stone-400">施設</dt><dd>{data.facility.name}</dd></div>
			<div><dt class="text-xs text-stone-400">チャネル</dt><dd>{b.channel === 'autumn_booking' ? '直販（autumn_booking）' : 'OTA'}</dd></div>
			<div><dt class="text-xs text-stone-400">チェックイン</dt><dd>{formatDateLongJa(b.checkin)}・{b.nights}泊</dd></div>
			<div><dt class="text-xs text-stone-400">客室 / プラン</dt><dd>{data.room.name} ／ {data.plan.name}</dd></div>
			<div><dt class="text-xs text-stone-400">ゲスト</dt><dd>{b.guest.name}（{b.guest.kana}）大人{b.adults}名</dd></div>
			<div><dt class="text-xs text-stone-400">連絡先</dt><dd>{b.guest.phone}<br />{b.guest.email}</dd></div>
			<div><dt class="text-xs text-stone-400">到着予定 / 送迎</dt><dd>{b.guest.arrival || '未指定'} ／ {b.guest.shuttle ? '送迎希望あり' : '送迎なし'}</dd></div>
			<div><dt class="text-xs text-stone-400">連絡事項</dt><dd>{b.guest.notes || '—'}</dd></div>
			<div><dt class="text-xs text-stone-400">金額</dt><dd>{formatYen(b.total)}（ポイント利用 {b.pointsUsed.toLocaleString()}pt）</dd></div>
			<div>
				<dt class="text-xs text-stone-400">支払</dt>
				<dd>
					{b.payment === 'onsite' ? '現地払い' : b.payment === 'paypay' ? 'PayPay 事前決済（即時）' : 'カード事前決済（即時）'} — {b.paymentStatus}{b.discountAmount ? ` ／ 事前割引 -¥${b.discountAmount.toLocaleString()}` : ''}
					{#if b.payment !== 'onsite'}
						<a href="https://dashboard.stripe.com" target="_blank" rel="noopener" class="ml-1 text-xs text-accent-600 underline">Stripe ↗</a>
					{/if}
				</dd>
			</div>
			{#if b.cancelFee !== undefined}
				<div><dt class="text-xs text-stone-400">キャンセル料</dt><dd class="text-red-600">{formatYen(b.cancelFee)}</dd></div>
			{/if}
			<div><dt class="text-xs text-stone-400">受付日</dt><dd>{b.createdAt}</dd></div>
		</dl>
		<p class="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-400">部屋割り・チェックイン操作は <span class="font-medium">PMS</span> で行ってください（リンクは PMS 稼働後に設置）。</p>
	</div>

	<aside class="space-y-3">
		{#if data.canOperate && b.status === 'reserved'}
			<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<h2 class="font-medium text-stone-700">操作</h2>
				<form method="POST" action="?/resend" use:enhance class="mt-2">
					<button type="submit" class="w-full rounded-md border border-stone-300 py-1.5 hover:bg-stone-50">確定メールを再送</button>
				</form>

				{#if !showCancel}
					<button type="button" onclick={() => (showCancel = true)} class="mt-2 w-full rounded-md border border-red-300 py-1.5 text-red-600 hover:bg-red-50">キャンセル処理</button>
				{:else}
					<form method="POST" action="?/cancel" use:enhance class="mt-3 space-y-2 rounded-lg border border-red-200 bg-red-50 p-3">
						<label class="flex items-center gap-2 text-xs">
							<input type="checkbox" name="waive" bind:checked={waive} class="h-4 w-4" />
							施設都合（キャンセル料を免除する）
						</label>
						<p class="text-xs text-stone-600">
							適用キャンセル料:
							<strong class="text-red-600">{waive ? formatYen(0) : formatYen(data.feePreview ?? 0)}</strong>
						</p>
						<input name="reason" placeholder="理由（必須・監査ログに記録）" class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
						<div class="flex gap-2">
							<button type="submit" class="flex-1 rounded-md bg-red-600 py-1.5 text-xs text-white hover:bg-red-500">実行</button>
							<button type="button" onclick={() => (showCancel = false)} class="flex-1 rounded-md border border-stone-300 bg-white py-1.5 text-xs">戻る</button>
						</div>
					</form>
				{/if}
			</div>
		{:else if !data.canOperate}
			<p class="rounded-xl border border-stone-200 bg-white p-4 text-xs text-stone-400">スタッフ権限では閲覧のみ可能です。キャンセル等の操作・連絡先の表示は管理者にご依頼ください。</p>
		{/if}
	</aside>
</div>
