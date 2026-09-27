<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import Stepper from '$lib/components/Stepper.svelte';
	import HoldTimer from '$lib/components/HoldTimer.svelte';
	import PriceBreakdown from '$lib/components/PriceBreakdown.svelte';
	import CancelPolicyNote from '$lib/components/CancelPolicyNote.svelte';
	import StripePayment from '$lib/components/payment/StripePayment.svelte';
	import type { PaymentConfirmed, PaymentLocale, PaymentPrepareResult, PaymentTexts } from '$lib/components/payment/types';
	import { directChargeOf, type PayOption } from '$lib/direct-payment';
	import { percentText } from '$lib/early-prepay';
	import { formatDateLong, formatPrice } from '$lib/format';
	import { gaEvent } from '$lib/analytics';
	import { getLocale } from '$lib/paraglide/runtime';
	import { guestsLabel } from '$lib/components/guests';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();

	let expiredNow = $state(false);

	// GA4 予約ファネル: 仮押さえ→ゲスト情報入力の開始（設計書 §9）
	$effect(() => {
		if (data.expired) return;
		gaEvent('begin_checkout', { currency: 'JPY' });
	});

	// 支払い方法（サーバがプランの決済設定とオンライン決済の可否から決めたもの）。
	// 「オンライン決済（ご予約時）」と「現地決済（チェックアウト時）」の2グループに分けて見せる。
	// 現地決済を選んだら、その中で PayPay / クレジットカード / 現金 を選ぶ（宿は店頭 PayPay へ誘導したいので PayPay を先頭・既定）。
	// サーバへは payment=card / paypay / onsite_paypay / onsite_card / onsite_cash で送る。現地払いは予約のまま備考で宿へ申し送る
	type OnsiteMethod = 'paypay' | 'card' | 'cash';
	type PayChoice = PayOption | `onsite_${OnsiteMethod}`;
	const ONSITE_METHODS: OnsiteMethod[] = ['paypay', 'card', 'cash'];
	const onsiteMethodLabel = (v: OnsiteMethod) => (v === 'paypay' ? m.pay_method_paypay() : v === 'card' ? m.pay_method_card() : m.pay_method_cash());
	let onlineOptions = $derived(data.expired ? [] : data.payOptions.filter((v): v is 'card' | 'paypay' => v !== 'onsite'));
	let hasOnsite = $derived(!data.expired && data.payOptions.includes('onsite'));
	// 予約時決済の割引（プランの定率と早期決済割の大きい方・泊ごと。オンライン決済を選んだときだけ効く）。
	// サーバが lib/early-prepay.ts（DB と同じ式）で計算した額。金額の正は DB（direct_payment_prepare）
	let prepay = $derived(data.expired ? null : data.prepay);
	let prepayAmount = $derived(prepay?.detail.discount ?? 0);
	// 割引行の名前: 早期決済割が当たっていれば「早期決済割（5%）」、定率なら従来の「予約時決済割引（10%OFF）」
	let discountLabel = $derived(
		prepay?.early
			? m.pay_early_line({ rate: percentText(prepay.detail.maxPermille / 10) })
			: m.pay_discount_line({ rate: percentText((prepay?.detail.flatPermille ?? 0) / 10) })
	);
	// 今の段（段階表のハイライト用・千分率）
	let currentTierPermille = $derived(prepay?.detail.tierPermille ?? 0);
	// 早期決済ポイント（施設の還元方法が points）: 段階表の率は割引にせず、宿泊後にポイントを上乗せする。
	// 請求額から引くのはプランの定率割引だけ（prepayAmount）。会員ランクの通常ポイントとは別に付く
	let isPoints = $derived(prepay?.mode === 'points');
	let bonusPoints = $derived(isPoints ? (prepay?.detail.bonusPoints ?? 0) : 0);
	let bonusRate = $derived(percentText((prepay?.detail.pointsPermille ?? 0) / 10));
	// 非会員の会員登録導線（予約中の入力を消さないよう別タブで開く）
	const registerHref = '/auth/register';
	let selectedGroup = $state<'online' | 'onsite' | null>(null);
	let group = $derived(selectedGroup ?? (onlineOptions.length > 0 ? 'online' : 'onsite'));
	let selectedOnline = $state<'card' | 'paypay' | null>(null);
	let onsiteMethod = $state<OnsiteMethod>('paypay');
	let payValue = $derived<PayChoice>(
		group === 'online' ? (selectedOnline ?? onlineOptions[0] ?? 'card') : `onsite_${onsiteMethod}`
	);
	let isPrepay = $derived(group === 'online');
	// 実データのカード決済はこの画面で払う（同じ画面の決済部品）。デモは従来どおり決済画面へ
	let inlineCard = $derived(!data.expired && data.inline && payValue === 'card');
	let discountNow = $derived(isPrepay ? prepayAmount : 0);
	let discountedTotal = $derived(data.expired ? 0 : data.hold.quote.total - discountNow);

	// ポイント（会員のみ）。請求額の計算は DB（direct_payment_prepare）と同じ式（lib/direct-payment.ts）
	// svelte-ignore state_referenced_locally
	let pointsInput = $state(data.expired ? 0 : data.hold.quote.pointsUsed);
	let pointsApplied = $derived(
		data.expired || !data.member
			? 0
			: Math.min(
					Math.max(0, Math.floor(Number(pointsInput) || 0)),
					data.member.balance,
					// 予約時決済の割引があるときは割引後の宿泊料金まで（DB と同じ）
					data.hold.quote.total - discountNow
				)
	);
	let charge = $derived(
		data.expired ? { lodging: 0, bathTax: 0, discount: 0, charge: 0 } : directChargeOf({ total: data.hold.quote.total, pointsUsed: pointsApplied, bathTax: data.bathTax, prepayDiscount: discountNow })
	);

	// モバイル上部の要約に出す合計（右の明細と同じ額: 入湯税込みで払う場合はその額、それ以外はポイント利用後の宿泊料金）
	let summaryTotal = $derived(
		data.expired ? 0 : inlineCard ? charge.charge : isPrepay ? discountedTotal - pointsApplied : data.hold.quote.total - pointsApplied
	);

	let steps = $derived(isPrepay && !data.inline
		? [m.steps_plan(), m.steps_info(), m.steps_payment(), m.steps_complete()]
		: [m.steps_plan(), m.steps_info(), m.steps_complete()]);

	// 仮押さえの期限（支払の準備で DB が延ばしたら更新する）
	// svelte-ignore state_referenced_locally
	let holdExpiresAt = $state(data.expired ? 0 : data.hold.expiresAt);

	// ---- 同じ画面で払う決済部品 ----
	let formEl: HTMLFormElement | undefined = $state();
	let payRef: StripePayment | undefined = $state();
	let paying = $state(false);
	let payMessage = $state('');
	const PHONE_RE = /^[0-9\-+ ]{10,}$/;
	const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

	// 必須項目を先に確かめる（Apple Pay / Google Pay のシートを開く前にも呼ばれる）
	function validateGuest(): string | null {
		if (!formEl) return m.pay_el_not_ready();
		const fd = new FormData(formEl);
		const v = (k: string) => String(fd.get(k) ?? '').trim();
		if (!v('familyName') || !v('givenName')) return m.error_name_required();
		if (!PHONE_RE.test(v('phone'))) return m.error_phone_invalid();
		if (!EMAIL_RE.test(v('email'))) return m.error_email_invalid();
		return null;
	}

	async function preparePayment(): Promise<PaymentPrepareResult> {
		if (!formEl) throw new Error(m.pay_el_not_ready());
		const fd = new FormData(formEl);
		fd.set('action', 'prepare');
		fd.set('payment', 'card');
		// 画面の請求額。サーバは DB が決めた額（早期決済割を含む）と違えば Intent を作らずに止める
		fd.set('expectedAmount', String(charge.charge));
		const res = await fetch('/booking/pay', { method: 'POST', body: fd });
		const j = (await res.json().catch(() => ({ ok: false, message: m.pay_el_failed() }))) as {
			ok: boolean;
			message?: string;
			clientSecret?: string;
			returnUrl?: string;
			amount?: number;
			expiresAt?: number;
		};
		if (!j.ok || !j.clientSecret || !j.returnUrl) throw new Error(j.message ?? m.pay_el_failed());
		if (typeof j.expiresAt === 'number' && Number.isFinite(j.expiresAt)) holdExpiresAt = j.expiresAt;
		// 画面の金額（Apple Pay のシートに出す額）とサーバが決めた請求額が違えば払わせない
		if (j.amount !== charge.charge) throw new Error(m.pay_notice_amount_changed());
		return { clientSecret: j.clientSecret, returnUrl: j.returnUrl };
	}

	async function onPaid(r: PaymentConfirmed) {
		if (data.expired) return;
		const fd = new FormData();
		fd.set('action', 'confirm');
		fd.set('intentId', r.intentId);
		fd.set('holdId', data.hold.id);
		const res = await fetch('/booking/pay', { method: 'POST', body: fd });
		const j = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; redirect?: string; message?: string };
		if (j.ok && j.redirect) {
			await goto(j.redirect);
			return;
		}
		// 支払は通っているので Webhook でも確定される。ここでは案内だけ出す
		payMessage = j.message ?? m.pay_notice_failed();
	}

	// 3Dセキュア等のリダイレクトの戻りで確定できなかったときの案内（/booking/pay/return）
	const returnNotice = $derived.by(() => {
		const p = page.url.searchParams.get('pay');
		if (p === 'late') return m.pay_notice_late();
		if (p === 'late_unrefunded') return m.pay_notice_late_unrefunded();
		if (p === 'failed' || p === 'error') return m.pay_notice_failed();
		return '';
	});
</script>

<svelte:head><title>{m.hold_title()}</title></svelte:head>

<div class="mx-auto max-w-4xl px-4 py-8">
	{#if returnNotice}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{returnNotice}</p>
	{/if}
	{#if data.expired || expiredNow}
		<div class="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center">
			<p class="text-3xl">⌛</p>
			<h1 class="font-display mt-2 text-xl text-brand-900">{m.hold_expired_heading()}</h1>
			<p class="mt-2 text-sm text-stone-600">{m.hold_expired_msg()}</p>
			<a href="/search" class="mt-4 inline-block rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">{m.hold_expired_search()}</a>
		</div>
	{:else}
		<!-- パンくず: どこから来たかと、戻り先を見せる（ブラウザの戻るに頼らない） -->
		<nav aria-label="breadcrumb" class="mb-3 flex flex-wrap items-center gap-x-1 text-xs text-stone-500">
			<a href="/search?checkin={data.hold.checkin}&nights={data.hold.nights}&adults={data.hold.adults}" class="hover:underline">{m.common_facility_list()}</a>
			<span aria-hidden="true">/</span>
			<a href="/{data.facility.brandSlug}/{data.facility.slug}/plans?checkin={data.hold.checkin}&nights={data.hold.nights}&adults={data.hold.adults}" class="hover:underline">{m.plan_detail_breadcrumb_plans()}</a>
			<span aria-hidden="true">/</span>
			<a href={data.planHref} class="max-w-[16rem] truncate hover:underline">{data.plan.name}</a>
			<span aria-hidden="true">/</span>
			<span class="text-stone-700" aria-current="page">{m.hold_breadcrumb_current()}</span>
		</nav>
		<Stepper {steps} current={1} />
		<!-- 選び直し: 仮押さえを解放してからプラン詳細へ（押さえたまま戻ると期限まで部屋が減ったまま） -->
		<form method="POST" action="?/release" class="mt-2 flex flex-wrap items-baseline gap-x-2">
			<input type="hidden" name="holdId" value={data.hold.id} />
			<input type="hidden" name="back" value={data.planHref} />
			<button type="submit" disabled={paying} class="text-sm text-accent-600 hover:underline disabled:opacity-50">{m.hold_change_plan()}</button>
			<span class="text-xs text-stone-400">{m.hold_change_plan_note()}</span>
		</form>

		<div class="mt-6">
			<!-- 支払の処理中は期限の表示で画面を切り替えない（確定の結果はサーバが判断する） -->
			<HoldTimer expiresAt={holdExpiresAt} onexpire={() => { if (!paying) expiredNow = true; }} />
		</div>

		{#if form?.message}
			<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
		{/if}

		<!-- モバイル: 予約内容の要約（明細の aside は長いフォームの下になるため、合計を先に見せる） -->
		<div class="mt-4 rounded-xl border border-stone-200 bg-white p-3 text-sm md:hidden">
			<p class="font-medium text-brand-900">{data.facility.name}</p>
			<p class="text-xs text-stone-500">{data.room.name} ／ {data.plan.name}</p>
			<p class="mt-0.5 text-xs text-stone-600">
				{formatDateLong(data.hold.checkin)}・{m.hold_nights_adults_val({ nights: String(data.hold.nights), guests: guestsLabel(data.hold.adults) })}
			</p>
			<div class="mt-2 flex items-baseline justify-between border-t border-stone-100 pt-2">
				<span class="text-stone-600">{inlineCard && data.bathTax > 0 ? m.pay_total_due() : m.price_breakdown_total()}</span>
				<span class="text-lg font-bold tabular-nums text-brand-900">{formatPrice(summaryTotal)}</span>
			</div>
			<a href="#hold-summary" class="mt-1 block text-right text-xs text-accent-600 hover:underline">{m.hold_mobile_see_detail()} ↓</a>
		</div>

		<div class="mt-6 grid gap-6 md:grid-cols-[1fr_320px]">
			<!-- 入力フォーム -->
			<div>
				{#if !data.member}
					<div class="mb-5 rounded-xl border border-accent-500/40 bg-amber-50/60 p-4 text-sm">
						<p class="font-medium text-brand-900">{m.hold_login_prompt()}</p>
						<div class="mt-2 flex gap-2">
							<a href="/auth/login?next={encodeURIComponent(page.url.pathname + page.url.search)}" class="rounded-md bg-brand-800 px-4 py-1.5 text-white hover:bg-brand-700">{m.hold_login_btn()}</a>
							<span class="self-center text-stone-500">{m.hold_guest_continue()}</span>
						</div>
					</div>
				{/if}

				<form
					bind:this={formEl}
					method="POST"
					action="?/submit"
					use:enhance={({ cancel }) => {
						// カードは同じ画面の決済部品で払う（Enter キーでの送信もここで止めて決済部品へ回す）
						if (inlineCard) {
							cancel();
							void payRef?.submit();
						}
					}}
					class="space-y-4 rounded-2xl border border-stone-200 bg-white p-5"
				>
					<input type="hidden" name="holdId" value={data.hold.id} />
					<h2 class="font-display text-lg text-brand-900">{m.hold_form_heading()}</h2>

					<!-- 氏名（グローバル正規化: 姓 / 名 / ミドルネーム + カナ） -->
					<div class="grid grid-cols-2 gap-3">
						<label class="block text-sm">
							<span class="text-stone-600">{m.name_family()} <span class="text-red-500">*</span></span>
							<input name="familyName" autocomplete="family-name" required aria-required="true" aria-invalid={form?.errors?.familyName ? 'true' : undefined} value={form?.values?.familyName ?? data.member?.familyName ?? ''} placeholder="山田" class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.familyName ? 'border-red-400' : 'border-stone-300'}" />
						</label>
						<label class="block text-sm">
							<span class="text-stone-600">{m.name_given()} <span class="text-red-500">*</span></span>
							<input name="givenName" autocomplete="given-name" required aria-required="true" aria-invalid={form?.errors?.givenName ? 'true' : undefined} value={form?.values?.givenName ?? data.member?.givenName ?? ''} placeholder="太郎" class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.givenName ? 'border-red-400' : 'border-stone-300'}" />
						</label>
					</div>
					<label class="block text-sm">
						<span class="text-stone-600">{m.name_middle()} <span class="text-xs text-stone-400">{m.name_optional()}</span></span>
						<input name="middleName" autocomplete="additional-name" value={form?.values?.middleName ?? data.member?.middleName ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
					</label>
					<div class="grid grid-cols-2 gap-3">
						<label class="block text-sm">
							<span class="text-stone-600">{m.name_family_kana()}</span>
							<input name="familyNameKana" value={form?.values?.familyNameKana ?? data.member?.familyNameKana ?? ''} placeholder="ヤマダ" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
						</label>
						<label class="block text-sm">
							<span class="text-stone-600">{m.name_given_kana()}</span>
							<input name="givenNameKana" value={form?.values?.givenNameKana ?? data.member?.givenNameKana ?? ''} placeholder="タロウ" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
						</label>
					</div>
					{#each [
						{ key: 'phone', label: m.hold_field_phone(), ph: '090-0000-0000', def: data.member?.phone, ac: 'tel' as const, type: 'tel', im: 'tel' as const },
						{ key: 'email', label: m.hold_field_email(), ph: 'mail@example.com', def: data.member?.email, ac: 'email' as const, type: 'email', im: 'email' as const }
					] as field}
						<label class="block text-sm">
							<span class="text-stone-600">{field.label} <span class="text-red-500">*</span></span>
							<input
								name={field.key}
								type={field.type}
								inputmode={field.im}
								autocomplete={field.ac}
								required
								aria-required="true"
								aria-invalid={form?.errors?.[field.key] ? 'true' : undefined}
								aria-describedby={form?.errors?.[field.key] ? `err-${field.key}` : undefined}
								value={form?.values?.[field.key as 'phone'] ?? field.def ?? ''}
								placeholder={field.ph}
								class="mt-1 w-full rounded-md border px-3 py-2 {form?.errors?.[field.key] ? 'border-red-400' : 'border-stone-300'}"
							/>
							{#if form?.errors?.[field.key]}
								<span id="err-{field.key}" class="text-xs text-red-600">{form.errors[field.key]}</span>
							{/if}
						</label>
					{/each}

					<div class="grid gap-4 sm:grid-cols-2">
						<label class="block text-sm">
							<span class="text-stone-600">{m.hold_field_arrival()}</span>
							<select name="arrival" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">
								{#each ['15:00', '16:00', '17:00', '18:00 以降'] as t}
									<option>{t}</option>
								{/each}
							</select>
						</label>
						{#if data.facility.access.shuttle.available}
							<label class="flex items-end gap-2 pb-2 text-sm">
								<input type="checkbox" name="shuttle" class="h-4 w-4" />
								<span>{m.hold_field_shuttle()}<span class="block text-xs text-stone-400">{data.facility.access.shuttle.note}</span></span>
							</label>
						{/if}
					</div>

					<label class="block text-sm">
						<span class="text-stone-600">{m.hold_field_notes()}</span>
						<textarea name="notes" rows="3" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder={m.hold_field_notes_ph()}></textarea>
					</label>

					{#if data.member}
						<div class="rounded-lg bg-emerald-50 p-3 text-sm">
							<p class="font-medium text-emerald-800">{m.hold_points_label({ balance: String(data.member.balance), earn: String(data.member.earn) })}</p>
							<div class="mt-2 flex items-center gap-2">
								<input type="number" name="points" min="0" max={data.member.balance} bind:value={pointsInput} readonly={paying} class="w-32 rounded-md border border-stone-300 px-3 py-1.5" />
								<span class="text-stone-500">{m.hold_points_use()}</span>
							</div>
						</div>
					{/if}

					<!-- お支払い方法: オンライン決済 / 現地決済 の2グループ -->
					<fieldset class="space-y-2 rounded-lg border border-stone-200 p-3 text-sm" disabled={paying}>
						<legend class="px-1 font-medium text-brand-900">{m.pay_choose()}</legend>
						<input type="hidden" name="payment" value={payValue} />

						{#if onlineOptions.length > 0}
							<div class="rounded-md border transition {group === 'online' ? 'border-accent-500 bg-amber-50/60' : 'border-stone-200'}">
								<label class="flex cursor-pointer items-center gap-2 px-3 py-2.5">
									<input type="radio" name="payGroup" value="online" checked={group === 'online'} onchange={() => (selectedGroup = 'online')} class="h-4 w-4" />
									<span class="flex-1 font-medium">{m.pay_group_online()}</span>
									{#if prepayAmount > 0}
										<span class="rounded-full bg-red-50 px-2 py-0.5 text-xs font-bold text-red-600">{m.pay_prepay_save({ amount: formatPrice(prepayAmount) })}</span>
									{/if}
									{#if bonusPoints > 0}
										<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700">{m.pay_points_badge({ points: bonusPoints.toLocaleString() })}</span>
									{/if}
								</label>
								{#if prepay && (prepayAmount > 0 || prepay.showLadder)}
									<!-- 予約時決済の割引の案内（選択に関係なく常に表示）。割引は金額で見せ、現地払いの額は消し線にしない。
									     返金しない旨は割引額と同じ大きさで出す。カウントダウン・在庫の煽りはしない -->
									<div class="space-y-2 border-t border-stone-200/80 px-3 py-2.5 pl-9 text-sm">
										{#if prepayAmount > 0}
											<p class="font-medium text-brand-900">
												{#if hasOnsite}
													{m.pay_prepay_compare({ onsite: formatPrice(data.hold.quote.total), online: formatPrice(data.hold.quote.total - prepayAmount), save: formatPrice(prepayAmount) })}
												{:else}
													{discountLabel} −{formatPrice(prepayAmount)} ／ {m.pay_discount_total()} {formatPrice(data.hold.quote.total - prepayAmount)}
												{/if}
											</p>
											<p class="font-medium text-brand-900">{m.pay_early_nonrefund({ amount: formatPrice(prepayAmount) })}</p>
										{/if}
										{#if bonusPoints > 0}
											<!-- 早期決済ポイント: 金額は下がらないのでポイントで見せる。会員ランクの通常ポイントとは別に付く -->
											<p class="font-medium text-emerald-800">{m.pay_points_compare({ points: bonusPoints.toLocaleString() })}</p>
											{#if data.member}
												<p class="text-xs text-stone-600">{m.pay_points_grant({ rate: bonusRate, points: bonusPoints.toLocaleString() })}</p>
											{:else}
												<p class="text-xs text-stone-700">
													{m.pay_points_guest({ rate: bonusRate, points: bonusPoints.toLocaleString() })}
													<a href={registerHref} target="_blank" rel="noopener" class="ml-1 font-medium text-accent-600 underline hover:text-accent-500">{m.pay_points_register()}</a>
												</p>
											{/if}
											<p class="text-xs text-stone-500">{m.pay_points_cancel_note()}</p>
										{/if}
										{#if prepay.showLadder}
											<div class="rounded-md border border-stone-200 bg-white/80 p-2.5">
												<p class="text-xs text-stone-600">{isPoints ? m.pay_points_heading() : m.pay_early_heading()}</p>
												<p class="mt-1 font-medium text-brand-900">
													{#if isPoints}
														{currentTierPermille > 0
															? m.pay_points_lead({ days: String(prepay.detail.leadDays), rate: percentText(currentTierPermille / 10) })
															: m.pay_points_lead_none({ days: String(Math.max(0, prepay.detail.leadDays)), min: String(prepay.tiers[0]?.days ?? 0) })}
													{:else}
														{currentTierPermille > 0
															? m.pay_early_lead({ days: String(prepay.detail.leadDays), rate: percentText(currentTierPermille / 10) })
															: m.pay_early_lead_none({ days: String(Math.max(0, prepay.detail.leadDays)), min: String(prepay.tiers[0]?.days ?? 0) })}
													{/if}
												</p>
												<ol class="mt-1.5 flex flex-wrap gap-1.5" aria-label={isPoints ? m.pay_points_name() : m.pay_early_name()}>
													{#each prepay.tiers as t (t.days)}
														{@const current = Math.round(t.percent * 10) === currentTierPermille}
														<li
															class="rounded-full border px-2.5 py-0.5 text-xs tabular-nums {current ? 'border-red-300 bg-red-50 font-bold text-red-700' : 'border-stone-200 text-stone-500'}"
															aria-current={current ? 'true' : undefined}
														>
															{isPoints
																? m.pay_points_tier({ days: String(t.days), rate: percentText(t.percent) })
																: `${m.pay_early_tier({ days: String(t.days) })} ${percentText(t.percent)}%`}
														</li>
													{/each}
												</ol>
												{#if prepay.drop}
													<p class="mt-1.5 text-xs text-stone-600">
														{isPoints
															? m.pay_points_drop({ days: String(prepay.drop.inDays), from: percentText(prepay.drop.fromPercent), to: percentText(prepay.drop.toPercent), diff: prepay.drop.diff.toLocaleString() })
															: m.pay_early_drop({ days: String(prepay.drop.inDays), from: percentText(prepay.drop.fromPercent), to: percentText(prepay.drop.toPercent), diff: formatPrice(prepay.drop.diff) })}
													</p>
												{/if}
												{#if prepay.detail.blackoutNights > 0}
													<p class="mt-1.5 text-xs text-stone-600">{isPoints ? m.pay_points_blackout() : m.pay_early_blackout()}</p>
												{/if}
												{#if !isPoints && currentTierPermille > 0 && prepay.detail.flatPermille >= currentTierPermille}
													<p class="mt-1.5 text-xs text-stone-600">{m.pay_early_flat_note({ rate: percentText(prepay.detail.flatPermille / 10) })}</p>
												{/if}
											</div>
										{/if}
									</div>
								{/if}
								{#if group === 'online'}
									<div class="space-y-1.5 border-t border-amber-200/60 px-3 py-2.5 pl-9">
										{#if onlineOptions.length > 1}
											{#each onlineOptions as v (v)}
												<label class="flex cursor-pointer items-center gap-2">
													<input type="radio" name="payOnline" value={v} checked={payValue === v} onchange={() => (selectedOnline = v)} class="h-4 w-4" />
													{#if v === 'paypay'}<span class="rounded bg-[#ff0033] px-1.5 py-0.5 text-[11px] font-bold text-white">PayPay</span>{/if}
													<span>{v === 'card' ? m.pay_card() : m.pay_paypay()}</span>
												</label>
											{/each}
										{:else}
											<p class="text-stone-600">{onlineOptions[0] === 'card' ? m.pay_card() : m.pay_paypay()}</p>
										{/if}
										{#if !data.inline}<p class="text-xs text-stone-500">{m.pay_prepay_note()}</p>{/if}
									</div>
								{/if}
							</div>
						{/if}

						{#if hasOnsite}
							<div class="rounded-md border transition {group === 'onsite' ? 'border-accent-500 bg-amber-50/60' : 'border-stone-200'}">
								<label class="flex cursor-pointer items-center gap-2 px-3 py-2.5">
									<input type="radio" name="payGroup" value="onsite" checked={group === 'onsite'} onchange={() => (selectedGroup = 'onsite')} class="h-4 w-4" />
									<span class="flex-1 font-medium">{m.pay_group_onsite()}</span>
								</label>
								{#if group === 'onsite'}
									<div class="border-t border-amber-200/60 px-3 py-2.5 pl-9">
										<p class="mb-1.5 text-xs text-stone-500">{m.pay_onsite_how()}</p>
										<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.pay_onsite_how()}>
											{#each ONSITE_METHODS as v (v)}
												<label class="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 {onsiteMethod === v ? 'border-accent-500 bg-white font-medium' : 'border-stone-300 bg-white/70'}">
													<input type="radio" name="payOnsite" value={v} checked={onsiteMethod === v} onchange={() => (onsiteMethod = v)} class="h-3.5 w-3.5" />
													{#if v === 'paypay'}<span class="rounded bg-[#ff0033] px-1.5 py-0.5 text-[10px] font-bold text-white">PayPay</span>{:else}{onsiteMethodLabel(v)}{/if}
												</label>
											{/each}
										</div>
										{#if onsiteMethod === 'paypay'}
											<p class="mt-2 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{m.pay_onsite_paypay_note()}</p>
										{/if}
									</div>
								{/if}
							</div>
						{/if}

						{#if data.payFallback}
							<p class="text-xs text-stone-500">{m.pay_fallback_note()}</p>
						{:else if data.memberOnsiteHint}
							<!-- 非会員は予約時決済のみのプラン。会員なら現地払いも選べる（控えめに案内） -->
							<p class="text-xs text-stone-500">
								{m.pay_member_onsite_hint()}
								<a href="/auth/login?next={encodeURIComponent(page.url.pathname + page.url.search)}" class="ml-1 underline hover:text-brand-800">{m.pay_member_onsite_login()}</a>
							</p>
						{/if}
						{#if form?.errors && 'payment' in form.errors && form.errors.payment}
							<p role="alert" class="text-xs text-red-600">{form.errors.payment}</p>
						{/if}
					</fieldset>

					{#if inlineCard}
						<!-- カードを選んだらこの場で入力（Apple Pay / Google Pay は入力欄の上）。Link の保存欄は出さない -->
						<section class="space-y-3 rounded-lg border border-stone-200 p-3">
							<div class="flex items-baseline justify-between gap-3">
								<h3 class="text-sm font-medium text-brand-900">{m.pay_card_heading()}</h3>
								<p class="text-sm font-medium tabular-nums text-brand-900">{m.pay_total_due()} {formatPrice(charge.charge)}</p>
							</div>
							<StripePayment
								bind:this={payRef}
								publishableKey={data.publishableKey}
								mode="payment"
								amount={charge.charge}
								locale={stripeLocale()}
								texts={payTexts}
								unavailableText={m.pay_unavailable()}
								validate={validateGuest}
								prepare={preparePayment}
								onconfirmed={onPaid}
								onbusychange={(b) => (paying = b)}
								onerror={() => (payMessage = '')}
							/>
							<p class="text-xs text-stone-500">{m.pay_inline_note()}</p>
						</section>
					{/if}

					{#if payMessage}
						<p class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{payMessage}</p>
					{/if}

					<button
						type="submit"
						disabled={paying || (inlineCard && !data.publishableKey)}
						class="w-full rounded-lg bg-accent-600 py-3 text-base font-medium text-white hover:bg-accent-500 disabled:opacity-50"
					>
						{#if inlineCard}
							{paying ? m.pay_processing_inline() : m.pay_submit_inline({ amount: formatPrice(charge.charge) })}
						{:else}
							{isPrepay ? m.hold_submit_card() : m.hold_submit_local()}
						{/if}
					</button>
					{#if !isPrepay}
						<p class="text-center text-xs text-stone-400">{m.hold_local_payment_note()}</p>
					{/if}
				</form>
			</div>

			<!-- 予約内容サマリ（明細は常に表示: 宿泊料金・ポイント・入湯税・お支払い合計） -->
			<aside id="hold-summary" class="h-fit scroll-mt-20 rounded-2xl border border-stone-200 bg-white p-5 md:sticky md:top-20">
				<h2 class="mb-3 font-medium text-brand-900">{m.hold_summary_heading()}</h2>
				<img src={data.room.photos[0]?.url} alt="" class="mb-3 h-32 w-full rounded-lg object-cover" />
				<dl class="space-y-1.5 text-sm">
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_facility()}</dt><dd>{data.facility.name}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_room()}</dt><dd class="text-right">{data.room.name}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_plan()}</dt><dd class="max-w-[60%] text-right">{data.plan.name}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_checkin()}</dt><dd>{formatDateLong(data.hold.checkin)}</dd></div>
					<div class="flex justify-between"><dt class="text-stone-500">{m.hold_summary_nights_adults()}</dt><dd>{m.hold_nights_adults_val({ nights: String(data.hold.nights), guests: guestsLabel(data.hold.adults) })}</dd></div>
				</dl>
				<div class="mt-4 border-t border-stone-200 pt-3">
					<PriceBreakdown quote={{ ...data.hold.quote, pointsUsed: pointsApplied, payable: data.hold.quote.total - pointsApplied }} />
					{#if inlineCard && charge.discount > 0}
						<div class="mt-1.5 flex justify-between text-sm text-red-600">
							<span>{discountLabel}</span>
							<span class="tabular-nums">-{formatPrice(charge.discount)}</span>
						</div>
					{/if}
					{#if inlineCard && data.bathTax > 0}
						<div class="mt-1.5 flex justify-between text-sm text-stone-600">
							<span>{m.pay_bath_tax_detail({ people: String(data.hold.adults), nights: String(data.hold.nights) })}</span>
							<span class="tabular-nums">{formatPrice(charge.bathTax)}</span>
						</div>
					{/if}
					{#if inlineCard && (data.bathTax > 0 || charge.discount > 0)}
						<div class="mt-1.5 flex justify-between border-t border-stone-200 pt-1.5 text-base font-bold text-brand-900">
							<span>{m.pay_total_due()}</span>
							<span class="tabular-nums">{formatPrice(charge.charge)}</span>
						</div>
					{:else if data.bathTax > 0 && !inlineCard}
						<p class="mt-2 text-xs text-stone-500">{m.pay_bath_tax_onsite({ amount: formatPrice(data.bathTax) })}</p>
					{/if}
				</div>
				<p class="mt-3 rounded bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
					<CancelPolicyNote policy={data.plan.cancellationPolicy} checkin={data.hold.checkin} />
				</p>
			</aside>
		</div>
	{/if}
</div>
