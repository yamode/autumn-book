<script lang="ts">
	// 客室案内の精算案内（2026-10-17）。管理画面の出し分けどおりに、
	//   ① 現在のご精算額 ② ご利用明細 ③ フロントでのご精算のご案内 ④ オンラインでお支払い（Stripe）
	// を出す。金額は DB が数え直すので、画面の額と変わっていれば決済の前に断られる（画面を更新してもらう）。
	import { invalidateAll } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import StripePayment from '$lib/components/payment/StripePayment.svelte';
	import type { PaymentLocale, PaymentTexts } from '$lib/components/payment/types';
	import { billStayDate, frontNoteFor, INROOM_TEST_AMOUNT, sortBillsByStay } from '$lib/inroom-bill';

	let { data } = $props();

	const bill = $derived(data.bill);
	const flags = $derived(bill.flags);
	const frontNote = $derived(frontNoteFor(bill.frontNote, getLocale()));
	const localeTag: Record<string, string> = { ja: 'ja-JP', en: 'en-US', 'zh-TW': 'zh-TW' };
	const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`;
	const paidSum = (ps: { amount: number }[]) => ps.reduce((s, p) => s + p.amount, 0);
	function fmtDate(ymd: string | null): string {
		if (!ymd) return '';
		try {
			return new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(
				new Date(`${ymd}T00:00:00+09:00`)
			);
		} catch {
			return ymd;
		}
	}
	// 1泊ずつの見出し用（「10/16（金）」・英語は「Fri, 10/16」）
	function fmtDayOfWeek(ymd: string): string {
		try {
			return new Intl.DateTimeFormat(localeTag[getLocale()] ?? 'ja-JP', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' }).format(
				new Date(`${ymd}T00:00:00+09:00`)
			);
		} catch {
			return ymd;
		}
	}
	// 連結予約は表紙（最終泊）が先に来るので、泊まった日の順に並べ直す
	const sortedBills = $derived(sortBillsByStay(bill.bills));
	const multiBill = $derived(bill.bills.length > 1);
	const qty = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(2).replace(/\.?0+$/, ''));

	const payTexts: PaymentTexts = {
		failed: m.pay_el_failed(),
		tryOtherCard: m.pay_el_try_other(),
		notReady: m.pay_el_not_ready(),
		checkCard: m.pay_el_check_card(),
		setupFailed: m.pay_el_failed(),
		loadFailed: m.pay_el_load_failed(),
		divider: m.pay_el_divider(),
		secure: m.pay_el_secure()
	};
	const stripeLocale = (): PaymentLocale => {
		const l = getLocale();
		return l === 'en' || l === 'zh-TW' ? l : 'ja';
	};

	let payRef: StripePayment | undefined = $state();
	let paying = $state(false);
	let payMessage = $state('');
	// 決済の結果（このページで払った直後・リダイレクトの戻り ?payment=）
	let result = $state<string | null>(null);
	const shownResult = $derived(result ?? data.paymentResult);
	// プレビュー（見本の滞在）で管理者が試す本番の Stripe のテスト決済（¥100 固定・2026-10-17）。文言は社内向けなので日本語だけ
	const payAmount = $derived(data.testPayment ? INROOM_TEST_AMOUNT : bill.dueTotal);

	const errorText = (kind: string | undefined) =>
		kind === 'changed' || kind === 'nothing' ? m.inroom_bill_err_changed() : kind === 'unavailable' ? m.inroom_bill_pay_unavailable() : m.inroom_bill_err_generic();

	async function payRequest(action: 'prepare' | 'confirm', extra: Record<string, string>) {
		const fd = new FormData();
		fd.set('action', action);
		for (const [k, v] of Object.entries(extra)) fd.set(k, v);
		const res = await fetch('/r/bill/pay', { method: 'POST', body: fd });
		return (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; kind?: string; result?: string; clientSecret?: string; returnUrl?: string };
	}

	async function preparePayment() {
		payMessage = '';
		const r = await payRequest('prepare', { amount: String(payAmount) });
		if (!r.ok || !r.clientSecret || !r.returnUrl) throw new Error(errorText(r.kind));
		return { clientSecret: r.clientSecret, returnUrl: r.returnUrl };
	}

	async function onPaid(p: { intentId: string }) {
		const r = await payRequest('confirm', { intentId: p.intentId });
		result = r.result === 'test' ? 'test' : r.ok ? 'paid' : r.result === 'refunded' ? 'refunded' : r.result === 'pending' ? 'pending' : 'pending';
		await invalidateAll();
	}
</script>

<svelte:head><title>{m.inroom_bill_title()} ｜ YAMADO</title></svelte:head>

<div class="space-y-3 px-4 py-4">
	{#if bill.isDemo}
		<!-- オンライン決済を出さないときは「お支払いはできません」に触れない -->
		<p class="rounded-lg bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">{flags.online && !data.testPayment ? m.inroom_bill_demo_note() : m.inroom_bill_demo_note_view()}</p>
	{/if}

	{#if shownResult === 'test'}
		<p class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" role="status">
			テスト決済（本番・¥{INROOM_TEST_AMOUNT}）が完了しました。PMS には入れていません。<strong>返金は Stripe の管理画面から手で行ってください</strong>（管理画面「精算案内」の一覧に「テスト決済」として残ります）。
		</p>
	{:else if shownResult === 'paid'}
		<p class="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">{m.inroom_bill_paid_done()}</p>
	{:else if shownResult === 'refunded'}
		<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">{m.inroom_bill_pay_refunded()}</p>
	{:else if shownResult === 'pending'}
		<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">{m.inroom_bill_pay_pending()}</p>
	{/if}

	{#if flags.items || flags.online}
		<!-- ============ 現在のご精算額 ============ -->
		<section class="rounded-lg bg-white px-4 py-4 shadow-card">
			<p class="text-xs text-stone-400">{m.inroom_bill_due()}</p>
			{#if bill.dueTotal > 0}
				<p class="mt-1 text-2xl font-semibold tabular-nums text-stone-900">{yen(bill.dueTotal)}</p>
			{:else}
				<p class="mt-1 text-sm text-stone-600">{m.inroom_bill_due_none()}</p>
			{/if}
		</section>
	{/if}

	{#if flags.items}
		<!-- ============ ご利用明細（PMS の請求書） ============ -->
		<section class="rounded-lg bg-white px-4 py-4 shadow-card" aria-labelledby="bill-items-title">
			<h2 id="bill-items-title" class="text-[15px] font-semibold text-stone-900">{m.inroom_bill_items_title()}</h2>
			{#if bill.bills.every((b) => b.items.length === 0)}
				<p class="mt-2 text-sm text-stone-500">{m.inroom_bill_items_empty()}</p>
			{:else}
				{#each sortedBills as b (b.id)}
					<!-- 請求書が複数（連結予約など）は、泊まった日の順に1泊ずつ枠で区切り、見出しは「○/○（曜）のご宿泊」（2026-10-17 指示・案A） -->
					<div class={multiBill ? 'mt-3 rounded-lg border border-stone-200 px-3 py-3' : ''}>
					{#if multiBill}
						{@const stayDate = billStayDate(b)}
						<p class="text-sm font-semibold text-stone-800">
							{stayDate ? m.inroom_bill_stay_on({ date: fmtDayOfWeek(stayDate) }) : b.billNo != null ? m.inroom_bill_bill_no({ no: String(b.billNo) }) : ''}
						</p>
					{/if}
					<ul class="mt-2 divide-y divide-stone-100 text-sm">
						{#each b.items as item, i (i)}
							<li class="flex items-baseline justify-between gap-3 py-1.5">
								<span class="min-w-0 text-stone-700">
									{#if item.date}<span class="mr-1.5 text-xs tabular-nums text-stone-400">{fmtDate(item.date)}</span>{/if}
									{item.name}
									{#if item.quantity !== 1}<span class="ml-1 text-xs text-stone-400">{yen(item.unitPrice)} × {qty(item.quantity)}</span>{/if}
								</span>
								<span class="shrink-0 tabular-nums text-stone-900">{yen(item.amount)}</span>
							</li>
						{/each}
					</ul>
					{#if b.payments.length > 0}
						<!-- お支払い済み・割引（入金を1行ずつ・日付は出さない・2026-10-17 指示）。
						     「−」は使わず、見出しで「お支払い済み」と分かるようにする。返金の行は「（ご返金）」を添える -->
						<p class="mt-4 text-xs font-medium text-stone-500">{m.inroom_bill_payments_title()}</p>
						<ul class="mt-1 divide-y divide-stone-100 text-sm">
							{#each b.payments as p, i (i)}
								<li class="flex items-baseline justify-between gap-3 py-1.5">
									<span class="min-w-0 text-stone-700">
										{p.method || m.inroom_bill_paid()}{#if p.amount < 0}<span class="ml-1 text-xs text-stone-400">（{m.inroom_bill_refund()}）</span>{/if}
									</span>
									<span class="shrink-0 tabular-nums text-stone-700">{yen(Math.abs(p.amount))}</span>
								</li>
							{/each}
						</ul>
					{/if}
					<!-- まとめ: ご利用合計 → お支払い済み・割引 → 残りのご精算額（引き算の記号を使わず、段で見せる） -->
					<dl class="mt-3 space-y-1.5 rounded-md bg-stone-50 px-3 py-2.5 text-sm">
						<div class="flex items-baseline justify-between">
							<dt class="text-stone-500">{m.inroom_bill_subtotal()}</dt>
							<dd class="tabular-nums text-stone-900">{yen(b.itemsTotal)}</dd>
						</div>
						{#if b.payments.length > 0}
							<div class="flex items-baseline justify-between">
								<dt class="text-stone-500">{m.inroom_bill_paid_total()}</dt>
								<dd class="tabular-nums text-stone-900">{yen(paidSum(b.payments))}</dd>
							</div>
							<div class="flex items-baseline justify-between border-t border-stone-200 pt-1.5">
								<dt class="font-medium text-stone-800">{m.inroom_bill_bill_due()}</dt>
								<dd class="text-base font-semibold tabular-nums text-stone-900">{yen(b.due)}</dd>
							</div>
						{/if}
					</dl>
					</div>
				{/each}
			{/if}
			<p class="mt-3 text-xs leading-relaxed text-stone-400">※ {m.inroom_bill_note_live()}</p>
		</section>
	{/if}

	{#if flags.front && frontNote}
		<!-- ============ フロントでのご精算のご案内（施設ごとの自由記述） ============ -->
		<section class="rounded-lg bg-white px-4 py-4 shadow-card" aria-labelledby="bill-front-title">
			<h2 id="bill-front-title" class="text-[15px] font-semibold text-stone-900">{m.inroom_bill_front_title()}</h2>
			<div class="mt-2 text-sm leading-relaxed text-stone-700">
				<MarkdownView source={frontNote} />
			</div>
		</section>
	{/if}

	{#if flags.online && (bill.dueTotal > 0 || data.testPayment) && shownResult !== 'paid'}
		<!-- ============ オンラインでお支払い（Stripe） ============ -->
		<section class="space-y-3 rounded-lg bg-white px-4 py-4 shadow-card" aria-labelledby="bill-online-title">
			<h2 id="bill-online-title" class="text-[15px] font-semibold text-stone-900">{m.inroom_bill_online_title()}</h2>
			{#if data.stripeKey && data.testPayment}
				<!-- 管理者のプレビューだけ。本物のカードに本当に請求されることをはっきり出す -->
				<div class="rounded-md border-2 border-red-400 bg-red-50 px-3 py-2.5 text-sm text-red-800" role="note">
					<p class="font-semibold">⚠ 本番の決済です（少額のテスト）</p>
					<p class="mt-1 leading-relaxed">
						見本の滞在から、本番の Stripe で <strong>¥{INROOM_TEST_AMOUNT}</strong> を実際にカードに請求します（見本の明細の金額ではありません）。PMS には入りません。
						自動では返金しないので、<strong>Stripe の管理画面から手で返金</strong>してください。管理者がログイン中のプレビューにだけ出ています。
					</p>
				</div>
			{:else if data.stripeKey}
				<p class="text-sm text-stone-600">{m.inroom_bill_online_help()}</p>
			{/if}
			{#if data.stripeKey}
				<StripePayment
					bind:this={payRef}
					publishableKey={data.stripeKey}
					mode="payment"
					amount={payAmount}
					express={false}
					locale={stripeLocale()}
					texts={payTexts}
					unavailableText={m.inroom_bill_pay_unavailable()}
					prepare={preparePayment}
					onconfirmed={onPaid}
					onbusychange={(b) => (paying = b)}
					onerror={(msg) => (payMessage = msg)}
				/>
				{#if payMessage}
					<p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{payMessage}</p>
				{/if}
				<button
					type="button"
					disabled={paying}
					onclick={() => payRef?.submit()}
					class="w-full rounded-lg bg-stone-900 py-3 text-base font-medium text-white disabled:opacity-50"
				>
					{paying
						? m.inroom_bill_paying()
						: data.testPayment
							? `本番でテスト決済する（¥${INROOM_TEST_AMOUNT}）`
							: m.inroom_bill_pay_button({ amount: Math.round(bill.dueTotal).toLocaleString('ja-JP') })}
				</button>
			{:else}
				<p class="text-sm text-stone-500">{bill.isDemo ? m.inroom_bill_demo_note() : m.inroom_bill_pay_unavailable()}</p>
				{#if data.testBlocker}
					<!-- 管理画面にログイン中の人にだけ、本番のテスト決済を出せない理由を出す（黙って隠さない） -->
					<p class="rounded-md bg-stone-100 px-3 py-2 text-xs leading-relaxed text-stone-600">
						本番の Stripe でのテスト決済（¥{INROOM_TEST_AMOUNT}）を出せません：{data.testBlocker}
					</p>
				{/if}
			{/if}
		</section>
	{/if}

	<a href="/r" class="block py-2 text-center text-sm text-stone-500 underline underline-offset-2">{m.inroom_bill_back()}</a>
</div>
