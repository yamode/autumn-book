<script lang="ts">
	import { enhance } from '$app/forms';
	import Stepper from '$lib/components/Stepper.svelte';
	import HoldTimer from '$lib/components/HoldTimer.svelte';
	import PriceBreakdown from '$lib/components/PriceBreakdown.svelte';
	import { formatYen, formatDateLongJa } from '$lib/format';

	let { data, form } = $props();
	let expiredNow = $state(false);
	let paying = $state(false);
</script>

<svelte:head><title>ご予約 ｜ お支払い</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-8">
	{#if data.expired || expiredNow}
		<div class="rounded-2xl border border-stone-200 bg-white p-8 text-center">
			<h1 class="font-display text-xl text-brand-900">確保時間が過ぎました</h1>
			<p class="mt-2 text-sm text-stone-600">お手数ですが、もう一度プランからお選び直しください。</p>
			<a href="/search" class="mt-4 inline-block rounded-lg bg-brand-800 px-6 py-2 text-sm text-white">宿を探す</a>
		</div>
	{:else}
		<Stepper steps={['プラン選択', 'お客様情報', 'お支払い', '完了']} current={2} />

		<div class="mt-6"><HoldTimer expiresAt={data.hold.expiresAt} onexpire={() => (expiredNow = true)} /></div>

		{#if form?.message}
			<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}

		<div class="mt-6 rounded-2xl border border-stone-200 bg-white p-5">
			<h1 class="font-display text-lg text-brand-900">お支払い</h1>
			<p class="mt-1 text-sm text-stone-500">{data.facility.name} ／ {formatDateLongJa(data.hold.checkin)} から {data.hold.nights}泊</p>

			<div class="mt-4 rounded-lg bg-stone-50 p-4">
				<PriceBreakdown quote={data.hold.quote} showLines={false} />
			</div>

			<!-- Stripe Payment Element 設置位置（P4 で本実装・カード情報は Stripe 直収） -->
			<div class="mt-5 space-y-3 rounded-xl border border-dashed border-stone-300 p-4">
				<p class="text-xs font-medium text-stone-400">デモ決済フォーム（本番は Stripe Payment Element・3Dセキュア対応）</p>
				<label class="block text-sm">
					<span class="text-stone-600">カード番号</span>
					<input value="4242 4242 4242 4242" readonly class="mt-1 w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-mono" />
				</label>
				<div class="grid grid-cols-2 gap-3">
					<label class="block text-sm">
						<span class="text-stone-600">有効期限</span>
						<input value="12/28" readonly class="mt-1 w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-mono" />
					</label>
					<label class="block text-sm">
						<span class="text-stone-600">CVC</span>
						<input value="424" readonly class="mt-1 w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 font-mono" />
					</label>
				</div>
			</div>

			<form
				method="POST"
				action="?/pay"
				use:enhance={() => {
					paying = true;
					return async ({ update }) => {
						paying = false;
						await update();
					};
				}}
				class="mt-5"
			>
				<input type="hidden" name="holdId" value={data.hold.id} />
				<button type="submit" disabled={paying} class="w-full rounded-lg bg-accent-600 py-3 text-base font-medium text-white hover:bg-accent-500 disabled:opacity-50">
					{paying ? '決済処理中…' : `${formatYen(data.hold.quote.payable)} を支払って予約を確定する`}
				</button>
			</form>
			<p class="mt-3 text-center text-xs text-stone-400">カード情報は当社サーバーに保存されません（Stripe 直接処理）</p>
		</div>
	{/if}
</div>
