<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatYen, formatDateLongJa } from '$lib/format';

	let { data, form } = $props();
	let b = $derived(data.booking);
	let showCancelConfirm = $state(false);
</script>

<svelte:head><title>予約詳細 {b.code} ｜ マイページ</title></svelte:head>

<nav class="mb-4 text-xs text-stone-400"><a href="/account" class="hover:underline">予約一覧</a> / {b.code}</nav>

{#if form?.cancelled}
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">キャンセルを承りました。確認メールをお送りしています。</p>
{/if}
{#if form?.message}
	<p class="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{form.message}</p>
{/if}

<div class="grid gap-6 md:grid-cols-[1fr_300px]">
	<div class="rounded-2xl border border-stone-200 bg-white p-6">
		<div class="flex items-center justify-between">
			<h1 class="font-display text-xl text-brand-900">{data.facility.name}</h1>
			<span class="rounded-full px-3 py-1 text-xs {b.status === 'reserved' ? 'bg-emerald-50 text-emerald-700' : b.status === 'cancelled' ? 'bg-stone-100 text-stone-500' : 'bg-blue-50 text-blue-600'}">
				{b.status === 'reserved' ? '予約済' : b.status === 'cancelled' ? 'キャンセル済' : '宿泊済'}
			</span>
		</div>
		<p class="mt-1 text-xs text-stone-400">予約番号 {b.code}{b.channel === 'ota' ? '（OTA経由）' : ''}</p>

		<dl class="mt-5 space-y-2 text-sm">
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">チェックイン</dt><dd>{formatDateLongJa(b.checkin)} {data.facility.checkinTime}〜</dd></div>
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">泊数・人数</dt><dd>{b.nights}泊・大人{b.adults}名</dd></div>
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">客室</dt><dd>{data.room.name}</dd></div>
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">プラン</dt><dd class="max-w-[60%] text-right">{data.plan.name}</dd></div>
			<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">ご宿泊者</dt><dd>{b.guest.name} 様</dd></div>
			{#if b.guest.shuttle}
				<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">送迎</dt><dd>希望あり</dd></div>
			{/if}
			{#if b.guest.notes}
				<div class="flex justify-between border-b border-stone-100 pb-2"><dt class="text-stone-500">連絡事項</dt><dd class="max-w-[60%] text-right">{b.guest.notes}</dd></div>
			{/if}
			<div class="flex justify-between pt-1 font-medium"><dt>合計（税込）</dt><dd>{formatYen(b.total)}</dd></div>
			{#if b.pointsUsed > 0}
				<div class="flex justify-between text-emerald-700"><dt>ポイント利用</dt><dd>-{b.pointsUsed.toLocaleString()}pt</dd></div>
			{/if}
			<div class="flex justify-between text-stone-500"><dt>お支払い</dt><dd>{b.payment === 'card' ? `カード（${b.paymentStatus === 'paid' ? '決済済' : b.paymentStatus === 'refunded' ? '返金済' : b.paymentStatus === 'partial_refund' ? '一部返金済' : '未決済'}）` : '現地払い'}</dd></div>
			{#if b.cancelFee !== undefined}
				<div class="flex justify-between text-red-600"><dt>キャンセル料</dt><dd>{formatYen(b.cancelFee)}</dd></div>
			{/if}
		</dl>
	</div>

	<aside class="space-y-4">
		{#if b.status === 'reserved' && data.cancelPreview}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 text-sm">
				<h2 class="font-medium text-brand-900">予約の変更・キャンセル</h2>
				<p class="mt-2 rounded bg-stone-50 px-3 py-2 text-stone-600">
					本日キャンセルの場合のキャンセル料：
					<strong class="{data.cancelPreview.fee > 0 ? 'text-red-600' : 'text-emerald-700'}">
						{formatYen(data.cancelPreview.fee)}（{Math.round(data.cancelPreview.rate * 100)}%）
					</strong>
				</p>
				<p class="mt-2 text-xs text-stone-400">{b.cancellationPolicy.note}</p>

				{#if !showCancelConfirm}
					<button type="button" onclick={() => (showCancelConfirm = true)} class="mt-3 w-full rounded-lg border border-red-300 py-2 text-red-600 hover:bg-red-50">予約をキャンセルする</button>
				{:else}
					<div class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
						<p class="font-medium text-red-700">本当にキャンセルしますか？</p>
						<ul class="mt-1 list-disc pl-4 text-xs text-red-600">
							<li>キャンセル料 {formatYen(data.cancelPreview.fee)} が発生します</li>
							{#if b.payment === 'card'}<li>差額はカードへ返金されます（5〜10営業日）</li>{/if}
							{#if b.pointsUsed > 0}<li>利用ポイント {b.pointsUsed.toLocaleString()}pt は全額返還されます</li>{/if}
							{#if b.pointsEarned > 0}<li>付与予定ポイントは取り消されます</li>{/if}
						</ul>
						<form method="POST" action="?/cancel" use:enhance class="mt-2 flex gap-2">
							<button type="submit" class="flex-1 rounded-md bg-red-600 py-1.5 text-white hover:bg-red-500">キャンセルを確定</button>
							<button type="button" onclick={() => (showCancelConfirm = false)} class="flex-1 rounded-md border border-stone-300 bg-white py-1.5">戻る</button>
						</form>
					</div>
				{/if}

				<p class="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500">
					日程・人数の変更は現在お電話で承っています：<br />
					<a href="tel:{data.facility.phone}" class="font-medium text-brand-800">{data.facility.phone}</a>（{data.facility.name}）
				</p>
			</div>

			<!-- オプション追加枠（P6 §15.2 接続点） -->
			<div class="rounded-2xl border border-dashed border-stone-300 p-5 text-sm text-stone-500">
				<p class="font-medium text-stone-600">ご滞在に追加（準備中）</p>
				<p class="mt-1 text-xs">貸切風呂・記念日ケーキ等のオプションは近日こちらから予約できます。</p>
			</div>
		{/if}

		<div class="rounded-2xl bg-stone-100 p-5 text-sm">
			<p class="font-medium text-brand-900">アクセス</p>
			<p class="mt-1 text-xs text-stone-600">{data.facility.addressPublic}</p>
			<a href="https://www.google.com/maps/dir/?api=1&destination={data.facility.lat},{data.facility.lng}" target="_blank" rel="noopener" class="mt-2 inline-block text-xs text-accent-600 underline">Googleマップで経路を見る ↗</a>
		</div>
	</aside>
</div>
