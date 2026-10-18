<script lang="ts">
	// 客室案内の「精算済み・返金」（2026-10-18 指示）。オンライン決済で精算したお客様の一覧と、そこからの返金。
	// 返金のダイアログは PMS の Square 返金と同じ作り: 既定は全額（あと返せる額いっぱい）・減らすと一部返金・理由（任意）・
	// 実行前に必ず確認（取り消せない）。返す額はサーバ（DB）が数え直す。
	import { goto } from '$app/navigation';
	import { enhance } from '$lib/enhance';
	import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { INROOM_PAYMENT_STATUS } from '$lib/inroom-bill';

	let { data, form } = $props();

	const BADGE = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset';
	const TONE = {
		on: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
		off: 'bg-stone-50 text-stone-500 ring-stone-200',
		warn: 'bg-amber-50 text-amber-800 ring-amber-200',
		danger: 'bg-red-50 text-red-700 ring-red-200'
	} as const;
	const tone = (s: string) =>
		s === 'paid' || s === 'test_paid'
			? TONE.on
			: s === 'partially_refunded'
				? TONE.warn
				: s === 'mismatch' || s === 'refund_failed'
					? TONE.danger
					: TONE.off;
	const REFUND_STATUS: Record<string, string> = { pending: '確認中', succeeded: '返金済み', failed: '失敗' };

	const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
	const fmtDateTime = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
	const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }) : '');

	// 本番の決済（テストを除く）の合計
	const real = $derived(data.payments.filter((p) => !p.isTest && ['paid', 'partially_refunded', 'refunded'].includes(p.status)));
	const totalPaid = $derived(real.reduce((s, p) => s + p.amount, 0));
	const totalRefunded = $derived(real.reduce((s, p) => s + p.refundedAmount, 0));

	// ---- 期間 ----
	let from = $state('');
	let to = $state('');
	$effect.pre(() => {
		from = data.from;
		to = data.to;
	});
	const applyRange = () => {
		if (from && to) goto(`?from=${from}&to=${to}`, { keepFocus: true, noScroll: true });
	};

	// ---- 返金のダイアログ ----
	type Pay = (typeof data.payments)[number];
	let targetId = $state<string | null>(null);
	const target = $derived<Pay | null>(data.payments.find((p) => p.id === targetId) ?? null);
	let amount = $state(0);
	let reason = $state('');
	const open = (p: Pay) => {
		targetId = p.id;
		// 確認中の返金があるときは、その額（同じ額で押すと Stripe に確かめ直す）
		amount = p.pendingRefund ? p.pendingRefund.amount : p.refundable;
		reason = '';
	};
	const close = () => (targetId = null);
	const maxAmount = $derived(target ? (target.pendingRefund ? target.pendingRefund.amount : target.refundable) : 0);
	const isFull = $derived(!!target && amount === target.amount - target.refundedAmount);
	const amountOk = $derived(Number.isInteger(amount) && amount >= 1 && amount <= maxAmount);

	const submitRefund = ({ cancel }: { cancel: () => void }) => {
		const p = target;
		if (!p || !amountOk) return cancel();
		const kind = p.pendingRefund ? '確認中の返金の確認' : isFull ? '全額返金' : '一部返金';
		const ok = confirm(
			`【${kind}】お客様のカードに ${yen(amount)} を返金します。\n\n` +
				`対象の決済: ${yen(p.amount)}（${p.roomCode ?? ''}${p.guestName ? ` ${p.guestName} 様` : ''}）\n` +
				`返金後にあと返せる額: ${yen(p.amount - p.refundedAmount - amount)}\n` +
				(p.isTest ? '' : 'PMS の請求書にマイナスの入金行が入ります。\n') +
				`\nこの操作は取り消せません。実行しますか？`
		);
		if (!ok) return cancel();
		return async ({ result, update }: { result: { type: string }; update: () => Promise<void> }) => {
			await update();
			if (result.type === 'success') close();
		};
	};
</script>

<svelte:head><title>精算済み・返金 ｜ 管理画面</title></svelte:head>

<PageHeader
	title="精算済み・返金"
	facility={data.currentFacility.name}
	description="客室案内（お客様のスマホ）からオンライン決済で精算したお客様の一覧です。ここから全額・一部の返金ができます。"
/>
<p class="-mt-3 mb-4 max-w-3xl text-xs leading-relaxed text-stone-500">
	返金するとお客様のカードに返金され、PMS の請求書に<b>マイナスの入金行</b>（オンライン決済の返金）が入ります。決済の取り消しも全額返金で行います。
	Stripe の管理画面から返金した分も、ここに反映されます（二重には入りません）。「テスト」はプレビューで管理者が試した決済で、PMS には入れていません。
</p>

{#if data.loadError}
	<div class="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">⚠ {data.loadError}</div>
{/if}
{#if !data.live}
	<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-600">デモの表示です（DATA_SOURCE=demo）。見本の決済で、Stripe には繋ぎません。</p>
{/if}
{#if form?.refunded}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ {yen(form.refunded.amount)} を返金しました。</p>
{/if}
{#if form?.message && !target}
	<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}

<!-- 期間と合計 -->
<section class="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-stone-200 bg-white p-4">
	<label class="text-xs text-stone-600">
		<span class="mb-1 block">入金の日（から）</span>
		<input type="date" bind:value={from} max={data.today} onchange={applyRange} class="h-10 rounded-lg border border-stone-300 px-2 text-sm" />
	</label>
	<label class="text-xs text-stone-600">
		<span class="mb-1 block">（まで）</span>
		<input type="date" bind:value={to} max={data.today} onchange={applyRange} class="h-10 rounded-lg border border-stone-300 px-2 text-sm" />
	</label>
	<dl class="ml-auto grid grid-cols-3 gap-4 text-right text-xs text-stone-500">
		<div><dt>件数</dt><dd class="text-base font-semibold text-stone-800 tabular-nums">{real.length}</dd></div>
		<div><dt>決済</dt><dd class="text-base font-semibold text-stone-800 tabular-nums">{yen(totalPaid)}</dd></div>
		<div><dt>返金</dt><dd class="text-base font-semibold text-stone-800 tabular-nums">{yen(totalRefunded)}</dd></div>
	</dl>
</section>

{#if data.payments.length === 0}
	<p class="rounded-lg border border-dashed border-stone-300 bg-white px-4 py-10 text-center text-sm text-stone-400">この期間に精算したお客様はいません。</p>
{:else}
	<ul class="space-y-3">
		{#each data.payments as p (p.id)}
			<li class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="text-xs tabular-nums text-stone-500">{fmtDateTime(p.paidAt ?? p.createdAt)}</p>
						<p class="mt-0.5 font-medium text-stone-800">
							{p.roomCode ?? '—'}{#if p.guestName}<span class="ml-1.5">{p.guestName} 様</span>{/if}
						</p>
						{#if p.validFrom && p.validTo}
							<p class="text-[11px] text-stone-400">滞在コード {fmtDay(p.validFrom)}〜{fmtDay(p.validTo)}</p>
						{/if}
						<div class="mt-1.5 flex flex-wrap items-center gap-1">
							<span class="{BADGE} {tone(p.status)}">{INROOM_PAYMENT_STATUS[p.status] ?? p.status}</span>
							{#if p.isTest}<span class="{BADGE} {TONE.danger}">テスト</span>{/if}
							{#if p.pendingRefund}<span class="{BADGE} {TONE.warn}">返金を確認中 {yen(p.pendingRefund.amount)}</span>{/if}
						</div>
					</div>
					<div class="shrink-0 text-right">
						<p class="text-lg font-semibold tabular-nums text-stone-900">{yen(p.amount)}</p>
						{#if p.refundedAmount > 0}<p class="text-xs tabular-nums text-red-700">返金 {yen(p.refundedAmount)}</p>{/if}
						{#if data.canRefund && (p.refundable > 0 || p.pendingRefund)}
							<button
								type="button"
								onclick={() => open(p)}
								class="mt-2 min-h-9 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
							>{p.pendingRefund ? '返金を確認する' : '返金する'}</button>
						{/if}
					</div>
				</div>

				{#if p.bills.length}
					<ul class="mt-3 space-y-0.5 border-t border-stone-100 pt-2 text-xs text-stone-600">
						{#each p.bills as b, i (i)}
							<li class="flex justify-between gap-3">
								<span class="min-w-0 truncate">請求書{#if b.billNo} No.{b.billNo}{/if}{#if b.name}（{b.name}）{/if}</span>
								<span class="shrink-0 tabular-nums">{yen(b.amount)}</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if p.refunds.length}
					<ul class="mt-2 space-y-0.5 border-t border-stone-100 pt-2 text-xs text-stone-500">
						{#each p.refunds as r (r.id)}
							<li class="flex flex-wrap justify-between gap-x-3">
								<span class="min-w-0">
									{fmtDateTime(r.createdAt)} 返金（{REFUND_STATUS[r.status] ?? r.status}）{#if r.reason}・{r.reason}{/if}{#if r.createdByName}<span class="text-stone-400">・{r.createdByName}</span>{/if}
									{#if r.status === 'failed' && r.message}<span class="text-red-700">（{r.message}）</span>{/if}
								</span>
								<span class="shrink-0 tabular-nums {r.status === 'failed' ? 'line-through' : ''}">{yen(r.amount)}</span>
							</li>
						{/each}
					</ul>
				{/if}
				{#if p.message}<p class="mt-2 text-[11px] text-stone-400">{p.message}</p>{/if}
				{#if p.paymentIntentId}<p class="mt-1 text-[11px] break-all text-stone-300">{p.paymentIntentId}</p>{/if}
			</li>
		{/each}
	</ul>
{/if}

{#if target}
	<div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="返金">
		<div class="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
			<h2 class="flex items-center gap-2 text-base font-semibold text-stone-800">
				<AdminIcon name="receipt" class="h-4 w-4 text-stone-500" />オンライン決済の返金
			</h2>
			<div class="mt-3 rounded-lg bg-stone-50 px-4 py-3">
				<p class="text-xs text-stone-500">{target.roomCode ?? ''}{#if target.guestName}&nbsp;{target.guestName} 様{/if}・{fmtDateTime(target.paidAt ?? target.createdAt)}</p>
				<p class="text-2xl font-semibold tabular-nums text-stone-900">{yen(target.amount)}</p>
				<p class="mt-1 text-xs tabular-nums text-stone-500">
					返金済み {yen(target.refundedAmount)} ／ <b class="text-stone-700">あと返せる額 {yen(target.amount - target.refundedAmount)}</b>
				</p>
			</div>

			<form method="POST" action="?/refund" use:enhance={submitRefund} class="mt-4 space-y-3">
				<input type="hidden" name="paymentId" value={target.id} />
				<input type="hidden" name="facilityId" value={data.currentFacility.id} />
				{#if target.pendingRefund}
					<p class="rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
						{yen(target.pendingRefund.amount)} の返金が「確認中」です（Stripe の応答を確かめられませんでした）。同じ金額で押すと Stripe に確かめ直します。返金がまだなら、このとき返金されます（重ねて返金はされません）。
					</p>
					<input type="hidden" name="amount" value={target.pendingRefund.amount} />
				{:else}
					<label class="block">
						<span class="text-xs font-medium text-stone-600">返金する金額（既定は全額）</span>
						<div class="mt-1 flex items-center gap-2">
							<span class="text-lg text-stone-500">¥</span>
							<input
								name="amount"
								type="number"
								inputmode="numeric"
								min="1"
								max={maxAmount}
								step="1"
								bind:value={amount}
								class="h-12 w-full rounded-lg border border-stone-300 px-3 text-right text-xl tabular-nums"
							/>
						</div>
					</label>
					<div class="flex flex-wrap gap-1.5">
						<button type="button" data-no-save-state onclick={() => (amount = maxAmount)} class="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-50">全額（{yen(maxAmount)}）</button>
					</div>
					{#if !amountOk}<p class="text-xs text-red-700">1円から {yen(maxAmount)} までの金額を入れてください</p>{/if}
					<label class="block">
						<span class="text-xs font-medium text-stone-600">理由（任意・返金の履歴に残ります）</span>
						<input name="reason" type="text" maxlength="200" bind:value={reason} placeholder="例: 飲み物の重複・ご精算の取り消し" class="mt-1 h-10 w-full rounded-lg border border-stone-300 px-3 text-sm" />
					</label>
					<p class="text-[11px] leading-relaxed text-stone-500">金額はサーバで数え直します。返せる額を超える指定は実行されません。</p>
				{/if}

				{#if form?.message && 'paymentId' in form && form.paymentId === target.id}
					<p class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
				{/if}

				<div class="flex flex-wrap justify-end gap-2 pt-1">
					<button type="button" data-no-save-state onclick={close} class="min-h-10 rounded-lg border border-stone-300 px-4 text-sm text-stone-700 hover:bg-stone-50">閉じる</button>
					<button type="submit" disabled={!amountOk} class="min-h-10 rounded-lg bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-40">
						{target.pendingRefund ? `${yen(amount)} の返金を確かめる` : isFull ? `${yen(amount)} を全額返金する` : `${yen(amount)} を一部返金する`}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
