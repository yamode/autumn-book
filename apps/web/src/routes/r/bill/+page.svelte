<script lang="ts">
	// 客室案内の精算案内（2026-10-17）。管理画面の出し分けどおりに、
	//   ① 現在のご精算額 ② ご利用明細 ③ フロントでのご精算のご案内 ④ オンラインでお支払い（Stripe）
	// を出す。金額は DB が数え直すので、画面の額と変わっていれば決済の前に断られる（画面を更新してもらう）。
	import { invalidateAll, replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import * as m from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import MarkdownView from '$lib/components/MarkdownView.svelte';
	import StripePayment from '$lib/components/payment/StripePayment.svelte';
	import type { PaymentLocale, PaymentTexts } from '$lib/components/payment/types';
	import { billStayDate, frontNoteFor, INROOM_TEST_AMOUNT, sortBillsByStay, billStayRange, billAddressee, payableBills } from '$lib/inroom-bill';

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
	// 請求書の見出し（2026-10-18 指示）: 連泊は「10/16(金)〜10/18(日)（2泊）」、1泊は「10/16(金)のご宿泊」。日付が無ければ請求書番号
	function billHeading(b: (typeof bill.bills)[number]): string {
		const r = billStayRange(b);
		if (!r) return b.billNo != null ? m.inroom_bill_bill_no({ no: String(b.billNo) }) : '';
		return r.nights >= 2
			? m.inroom_bill_stay_range({ from: fmtDayOfWeek(r.from), to: fmtDayOfWeek(r.checkout), nights: String(r.nights) })
			: m.inroom_bill_stay_on({ date: fmtDayOfWeek(r.from) });
	}
	// 請求書の宛名（お客様名と違うときだけ）
	const addresseeOf = (b: (typeof bill.bills)[number]) => billAddressee(b, bill.guestName);
	// 請求書が複数ある滞在は、払う請求書を選ぶ（公開済みで残額があるものだけ・2026-10-18 指示「支払いは請求単位で」）
	const payable = $derived(payableBills(bill.bills));
	let chosenBillId = $state<string | null>(null);
	const chosenBill = $derived(multiBill ? (payable.find((b) => b.id === chosenBillId) ?? payable[0] ?? null) : null);
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
	// 決済完了は画面の中央のモーダルで知らせる（上部の帯だと気づきにくい・2026-10-17 指示）。
	// 閉じる／トップページに戻る。開いている間は後ろをスクロールさせない。閉じたら URL の ?payment= を消す（再読み込みで出し直さない）
	let paidModalDismissed = $state(false);
	let paidAmount = $state<number | null>(null);
	const paidModalOpen = $derived((shownResult === 'paid' || shownResult === 'test') && !paidModalDismissed);
	function closePaidModal() {
		paidModalDismissed = true;
		if (page.url.searchParams.has('payment')) {
			const u = new URL(page.url);
			u.searchParams.delete('payment');
			replaceState(u.pathname + u.search, page.state);
		}
	}
	$effect(() => {
		if (!paidModalOpen) return;
		const html = document.documentElement;
		const prev = { html: html.style.overflow, body: document.body.style.overflow };
		html.style.overflow = 'hidden';
		document.body.style.overflow = 'hidden';
		const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closePaidModal();
		window.addEventListener('keydown', onKey);
		return () => {
			html.style.overflow = prev.html;
			document.body.style.overflow = prev.body;
			window.removeEventListener('keydown', onKey);
		};
	});
	// プレビュー（見本の滞在）で管理者が試す本番の Stripe のテスト決済（¥100 固定・2026-10-17）。文言は社内向けなので日本語だけ
	const payAmount = $derived(data.testPayment ? INROOM_TEST_AMOUNT : multiBill ? (chosenBill?.due ?? 0) : bill.dueTotal);

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
		const r = await payRequest('prepare', {
			amount: String(payAmount),
			...(multiBill && chosenBill && !data.testPayment ? { billId: chosenBill.id } : {})
		});
		if (!r.ok || !r.clientSecret || !r.returnUrl) throw new Error(errorText(r.kind));
		return { clientSecret: r.clientSecret, returnUrl: r.returnUrl };
	}

	async function onPaid(p: { intentId: string }) {
		const r = await payRequest('confirm', { intentId: p.intentId });
		paidAmount = payAmount;
		paidModalDismissed = false;
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

	{#if paidModalOpen}
		<!-- ============ 決済完了のモーダル（画面の中央） ============ -->
		<div class="fixed inset-0 z-50 flex items-center justify-center overscroll-contain bg-black/50 p-4" role="presentation">
			<div
				class="max-h-[85dvh] w-full max-w-sm overflow-y-auto overscroll-contain rounded-xl bg-white p-6 text-center shadow-xl"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="paid-modal-title"
			>
				<div class="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50">
					<svg viewBox="0 0 24 24" class="h-8 w-8 text-emerald-600" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
						<path d="M5 12.5l4.5 4.5L19 7.5" />
					</svg>
				</div>
				<h2 id="paid-modal-title" class="mt-4 text-lg font-semibold text-stone-900">{m.inroom_bill_paid_title()}</h2>
				{#if paidAmount}
					<p class="mt-2 text-sm text-stone-500">{m.inroom_bill_paid_amount()}</p>
					<p class="text-2xl font-semibold tabular-nums text-stone-900">{yen(paidAmount)}</p>
				{/if}
				{#if shownResult === 'test'}
					<!-- 管理者のプレビューでのテスト決済（社内向けなので日本語だけ） -->
					<p class="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-left text-xs leading-relaxed text-red-800">
						テスト決済（本番・¥{INROOM_TEST_AMOUNT}）です。PMS には入れていません。<strong>返金は Stripe の管理画面から手で行ってください</strong>（管理画面「精算案内」の一覧に「テスト決済」として残ります）。
					</p>
				{:else}
					<p class="mt-3 text-sm leading-relaxed text-stone-600">{m.inroom_bill_paid_body()}</p>
				{/if}
				<div class="mt-6 space-y-2">
					<a href="/r" class="block w-full rounded-lg bg-stone-900 py-3 text-sm font-medium text-white active:bg-stone-700">{m.inroom_bill_go_top()}</a>
					<button type="button" onclick={closePaidModal} class="block w-full rounded-lg border border-stone-300 bg-white py-3 text-sm font-medium text-stone-700 active:bg-stone-50">
						{m.inroom_bill_close()}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if shownResult === 'refunded'}
		<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">{m.inroom_bill_pay_refunded()}</p>
	{:else if shownResult === 'pending'}
		<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">{m.inroom_bill_pay_pending()}</p>
	{/if}

	{#if (flags.items || flags.online) && bill.publishedCount > 0}
		<!-- ============ 現在のご精算額（公開済みの請求書の残額だけ。公開済みが無ければ出さない・2026-10-17） ============ -->
		<section class="rounded-lg bg-white px-4 py-4 shadow-card">
			<p class="text-xs text-stone-400">{m.inroom_bill_due()}</p>
			{#if bill.dueTotal > 0}
				<p class="mt-1 text-2xl font-semibold tabular-nums text-stone-900">{yen(bill.dueTotal)}</p>
			{:else}
				<p class="mt-1 text-sm text-stone-600">{m.inroom_bill_due_none()}</p>
			{/if}
		</section>
	{/if}

	{#if !flags.items && flags.online && !bill.isDemo && bill.bills.length > 0 && bill.publishedCount === 0}
		<!-- 明細は出さずオンライン決済だけの設定で、請求書がまだ確認中（金額も決済の欄も出さない・2026-10-17） -->
		<p class="rounded-lg bg-white px-4 py-4 text-sm leading-relaxed text-stone-600 shadow-card">{m.inroom_bill_pending_check()}</p>
	{/if}

	{#if flags.items}
		<!-- ============ ご利用明細（PMS の請求書） ============ -->
		<section class="rounded-lg bg-white px-4 py-4 shadow-card" aria-labelledby="bill-items-title">
			<h2 id="bill-items-title" class="text-[15px] font-semibold text-stone-900">{m.inroom_bill_items_title()}</h2>
			{#if bill.bills.length === 0 || bill.bills.every((b) => b.published && b.items.length === 0)}
				<p class="mt-2 text-sm text-stone-500">{m.inroom_bill_items_empty()}</p>
			{:else}
				{#each sortedBills as b (b.id)}
					<!-- 請求書が複数（連結予約など）は、泊まった日の順に1泊ずつ枠で区切り、見出しは「○/○（曜）のご宿泊」（2026-10-17 指示・案A） -->
					<div class={multiBill ? 'mt-3 rounded-lg border border-stone-200 px-3 py-3' : ''}>
					{#if multiBill || addresseeOf(b)}
						<!-- 見出し: 泊まった日の範囲と泊数（連泊を1泊に見せない）・宛名（お客様名と違うとき）・2026-10-18 -->
						<div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
							{#if multiBill}<p class="text-sm font-semibold text-stone-800">{billHeading(b)}</p>{/if}
							{#if addresseeOf(b)}<p class="text-xs font-medium text-stone-600">{m.inroom_bill_addressee({ name: addresseeOf(b) ?? '' })}</p>{/if}
						</div>
					{/if}
					{#if !b.published}
						<!-- PMS の「請求内容チェック」で明細・入金がすべてチェックされるまで出さない（2026-10-17）。連結予約は泊ごと -->
						<p class="mt-2 rounded-md bg-stone-50 px-3 py-2.5 text-sm leading-relaxed text-stone-600">{m.inroom_bill_pending_check()}</p>
					{:else}
					<ul class="mt-2 divide-y divide-stone-100 text-sm">
						{#each b.items as item, i (i)}
							<li class="flex items-baseline justify-between gap-3 py-1.5">
								<span class="min-w-0 text-stone-700">
									{#if item.date}<span class="mr-1.5 text-xs tabular-nums text-stone-400">{fmtDate(item.date)}</span>{/if}
									{item.name}
									<span class="ml-1 text-xs text-stone-400">{yen(item.unitPrice)} × {qty(item.quantity)}</span>
								</span>
								<span class="shrink-0 tabular-nums text-stone-900">{yen(item.amount)}</span>
							</li>
						{/each}
					</ul>
					<!-- 明細の最後に合計（2026-10-17 指示） -->
					<div class="flex items-baseline justify-between gap-3 border-t border-stone-300 py-1.5 text-sm">
						<span class="font-medium text-stone-700">{m.inroom_bill_subtotal()}</span>
						<span class="shrink-0 font-semibold tabular-nums text-stone-900">{yen(b.itemsTotal)}</span>
					</div>
					{#if b.payments.length > 0}
						<!-- お支払い済み・調整額（入金を1行ずつ・日付は出さない）。「−」は使わず見出しで分かるようにし、最後に合計。
						     返金の行は「（ご返金）」を添える -->
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
						<div class="flex items-baseline justify-between gap-3 border-t border-stone-300 py-1.5 text-sm">
							<span class="font-medium text-stone-700">{m.inroom_bill_total()}</span>
							<span class="shrink-0 font-semibold tabular-nums text-stone-900">{yen(paidSum(b.payments))}</span>
						</div>
						<!-- 最後のご精算額は1行だけ（太い線で区切る。上の「現在のご精算額」と同じ額を何度も並べない・2026-10-17 指示） -->
						<div class="mt-3 flex items-baseline justify-between gap-3 border-t-2 border-stone-800 pt-2">
							<span class="text-sm font-semibold text-stone-900">{m.inroom_bill_bill_due()}</span>
							<span class="shrink-0 text-lg font-semibold tabular-nums text-stone-900">{yen(b.due)}</span>
						</div>
					{/if}
					{/if}
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

	{#if flags.online && ((multiBill ? payable.length > 0 : bill.dueTotal > 0) || data.testPayment) && shownResult !== 'paid'}
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
			{#if data.stripeKey && multiBill && !data.testPayment && payable.length}
				<!-- 請求書が複数ある滞在は、払う請求書を選んでその請求書の残額だけを払う（公開前・残額なしの請求書は出さない） -->
				<fieldset class="space-y-2" disabled={paying}>
					<legend class="text-xs font-medium text-stone-500">{m.inroom_bill_choose()}</legend>
					{#each payable as b (b.id)}
						{@const addressee = addresseeOf(b)}
						<label class="flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm {chosenBill?.id === b.id ? 'border-stone-900 bg-stone-50' : 'border-stone-200'}">
							<input type="radio" name="payBill" value={b.id} checked={chosenBill?.id === b.id} onchange={() => (chosenBillId = b.id)} class="h-4 w-4 shrink-0" />
							<span class="min-w-0 flex-1">
								<span class="block font-medium text-stone-800">{billHeading(b)}</span>
								{#if addressee}<span class="block text-xs text-stone-500">{m.inroom_bill_addressee({ name: addressee })}</span>{/if}
							</span>
							<span class="shrink-0 tabular-nums font-semibold text-stone-900">{m.inroom_bill_choose_due({ amount: yen(b.due) })}</span>
						</label>
					{/each}
				</fieldset>
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
							: m.inroom_bill_pay_button({ amount: Math.round(payAmount).toLocaleString('ja-JP') })}
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
