<script lang="ts">
	import Stepper from '$lib/components/Stepper.svelte';
	import { formatPrice, formatDateLong, addDays } from '$lib/format';
	import { gaPurchaseOnce } from '$lib/analytics';
	import { guestsLabel } from '$lib/components/guests';
	import * as m from '$lib/paraglide/messages';
	import { percentText } from '$lib/early-prepay';

	let { data } = $props();
	let b = $derived(data.booking);

	// GA4 予約ファネル: 予約確定（purchase に予約金額・設計書 §9）。リロード再送は抑止
	$effect(() => {
		gaPurchaseOnce(b.code, {
			value: b.total - b.pointsUsed,
			currency: 'JPY',
			items: [{ item_id: data.room.id, item_name: data.room.name, item_brand: data.facility.name }]
		});
	});
	let isCard = $derived(b.payment !== 'onsite');
	// 割引行の名前: 早期決済割なら「早期決済割（5%）」（泊ごとに率が違うときは率なし）、定率なら「予約時決済割引（10%OFF）」
	let discountLabel = $derived.by(() => {
		const rate = b.prepayDiscountRate ?? 0;
		if (b.prepayDiscountEarly) return rate > 0 ? m.pay_early_line({ rate: percentText(Math.round(rate * 1000) / 10) }) : m.pay_early_name();
		return m.pay_discount_line({ rate: percentText(Math.round(rate * 1000) / 10) });
	});

	// 「カレンダーに追加」用の .ics（data URI）。チェックイン〜チェックアウトの終日予定としてクライアント側で組み立てる
	const icsEscape = (v: string) => v.replace(/\\/g, '\\\\').replace(/[;,]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
	let icsHref = $derived.by(() => {
		const ymd = (d: string) => d.replaceAll('-', '');
		const checkout = addDays(b.checkin, b.nights);
		// DTSTAMP は SSR とハイドレーションで値がずれないよう予約作成日から固定で作る（現在時刻は使わない）
		const stamp = `${ymd(b.createdAt.slice(0, 10))}T000000Z`;
		const lines = [
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//YAMADO//autumn-book//JA',
			'CALSCALE:GREGORIAN',
			'BEGIN:VEVENT',
			`UID:${b.code}@yamado`,
			`DTSTAMP:${stamp}`,
			`DTSTART;VALUE=DATE:${ymd(b.checkin)}`,
			`DTEND;VALUE=DATE:${ymd(checkout)}`,
			`SUMMARY:${icsEscape(`${data.facility.name}（${b.code}）`)}`,
			`DESCRIPTION:${icsEscape(`${m.complete_booking_number_label()}: ${b.code}\n${data.room.name}\n${m.complete_checkin()} ${data.facility.checkinTime}〜`)}`,
			...(data.facility.addressPublic ? [`LOCATION:${icsEscape(data.facility.addressPublic)}`] : []),
			'END:VEVENT',
			'END:VCALENDAR'
		];
		return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
	});

	let steps = $derived(isCard
		? [m.steps_plan(), m.steps_info(), m.steps_payment(), m.steps_complete()]
		: [m.steps_plan(), m.steps_info(), m.steps_complete()]);
</script>

<svelte:head><title>{m.complete_title({ facility: data.facility.name })}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<Stepper {steps} current={isCard ? 3 : 2} />

	<div class="mt-8 rounded-2xl border border-stone-200 bg-white p-8 text-center">
		<p class="text-4xl text-emerald-600">✔</p>
		<h1 class="font-display mt-3 text-2xl text-brand-900">{m.complete_confirmed()}</h1>
		<p class="mt-2 text-sm text-stone-500">{m.complete_booking_number_label()}</p>
		<p class="text-2xl font-bold tracking-wider text-brand-900">{b.code}</p>
		<p class="mt-3 text-sm text-stone-600">{m.complete_email_sent({ email: b.guest.email })}</p>
		{#if !data.isMember}
			<!-- 非会員はマイページを持たないため、取消の入口が確認メールのリンクしかないことを先に伝える -->
			<p class="mt-1 text-sm text-stone-600">{m.complete_cancel_hint()}</p>
		{/if}

		<dl class="mx-auto mt-6 max-w-md space-y-1.5 rounded-xl bg-stone-50 p-4 text-left text-sm">
			<div class="flex justify-between"><dt class="text-stone-500">{m.complete_facility()}</dt><dd>{data.facility.name}</dd></div>
			<div class="flex justify-between"><dt class="text-stone-500">{m.complete_checkin()}</dt><dd>{formatDateLong(b.checkin)} {data.facility.checkinTime}〜</dd></div>
			<div class="flex justify-between"><dt class="text-stone-500">{m.complete_room_nights()}</dt><dd>{m.complete_nights_room({ room: data.room.name, nights: String(b.nights) })}</dd></div>
			<div class="flex justify-between"><dt class="text-stone-500">{m.complete_guest()}</dt><dd>{m.complete_guest_val({ name: b.guest.name, guests: guestsLabel(b.adults) })}</dd></div>
			<div class="flex justify-between border-t border-stone-200 pt-1.5 font-medium">
				<dt>{isCard ? m.complete_paid() : data.onsiteMethod === 'paypay' ? m.pay_onsite_paypay() : data.onsiteMethod === 'card' ? m.pay_onsite_card() : data.onsiteMethod === 'cash' ? m.pay_onsite_cash() : m.complete_local_pay()}</dt>
				<dd>
					{formatPrice(data.paid ? data.paid.amount : b.total - b.pointsUsed)}
					{#if b.payment === 'paypay' || data.onsiteMethod === 'paypay'}<span class="ml-1 rounded bg-[#ff0033] px-1.5 py-0.5 text-[10px] font-bold text-white">PayPay</span>{/if}
				</dd>
			</div>
			{#if data.paid && data.paid.bathTax > 0}
				<div class="flex justify-between text-xs text-stone-500"><dt>{m.pay_bath_tax()}</dt><dd>{formatPrice(data.paid.bathTax)}</dd></div>
			{/if}
			{#if b.discountAmount}
				<div class="flex justify-between text-red-600"><dt>{discountLabel}</dt><dd>-{formatPrice(b.discountAmount)}</dd>
			</div>
			{/if}
			{#if b.pointsEarned > 0}
				<div class="flex justify-between text-emerald-700"><dt>{m.complete_points_earned()}</dt><dd>+{b.pointsEarned.toLocaleString()}{m.common_point_unit()}</dd></div>
			{/if}
		</dl>

		<div class="mt-6 flex flex-wrap justify-center gap-3">
			<a href={icsHref} download="{b.code}.ics" class="rounded-lg border border-stone-300 px-5 py-2 text-sm hover:bg-stone-50">{m.complete_calendar()}</a>
			{#if data.isMember}
				<a href="/account" class="rounded-lg bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700">{m.complete_mypage()}</a>
			{/if}
		</div>

		{#if !data.isMember}
			<div class="mt-8 rounded-xl bg-amber-50 p-4 text-sm">
				<p class="font-medium text-brand-900">{m.complete_register_prompt({ points: String(Math.floor(b.total / 110)) })}</p>
				<p class="mt-1 text-xs text-stone-500">{m.complete_register_sub()}</p>
				<a href="/auth/register?email={encodeURIComponent(b.guest.email)}&name={encodeURIComponent(b.guest.name)}" class="mt-3 inline-block rounded-lg bg-accent-600 px-5 py-2 text-white hover:bg-accent-500">{m.complete_register_btn()}</a>
			</div>
		{/if}

		<!-- クロスセル枠（P6: オプション予約 §15.2 をここに接続）。中身が空の「準備中」表示は CV に寄与しないため接続まで非表示 -->
	</div>
</div>
