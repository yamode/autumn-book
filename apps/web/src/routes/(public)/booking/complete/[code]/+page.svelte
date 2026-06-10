<script lang="ts">
	import Stepper from '$lib/components/Stepper.svelte';
	import { formatPrice, formatDateLong } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data } = $props();
	let b = $derived(data.booking);
	let isCard = $derived(b.payment !== 'onsite');

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

		<dl class="mx-auto mt-6 max-w-md space-y-1.5 rounded-xl bg-stone-50 p-4 text-left text-sm">
			<div class="flex justify-between"><dt class="text-stone-500">{m.complete_facility()}</dt><dd>{data.facility.name}</dd></div>
			<div class="flex justify-between"><dt class="text-stone-500">{m.complete_checkin()}</dt><dd>{formatDateLong(b.checkin)} {data.facility.checkinTime}〜</dd></div>
			<div class="flex justify-between"><dt class="text-stone-500">{m.complete_room_nights()}</dt><dd>{m.complete_nights_room({ room: data.room.name, nights: String(b.nights) })}</dd></div>
			<div class="flex justify-between"><dt class="text-stone-500">{m.complete_guest()}</dt><dd>{m.complete_guest_val({ name: b.guest.name, adults: String(b.adults) })}</dd></div>
			<div class="flex justify-between border-t border-stone-200 pt-1.5 font-medium">
				<dt>{isCard ? m.complete_paid() : m.complete_local_pay()}</dt>
				<dd>
					{formatPrice(b.total - b.pointsUsed)}
					{#if b.payment === 'paypay'}<span class="ml-1 rounded bg-[#ff0033] px-1.5 py-0.5 text-[10px] font-bold text-white">PayPay</span>{/if}
				</dd>
			</div>
			{#if b.discountAmount}
				<div class="flex justify-between text-red-600"><dt>{m.pay_discount_line({ rate: String(Math.round((b.prepayDiscountRate ?? 0) * 100)) })}</dt><dd>-{formatPrice(b.discountAmount)}</dd>
			</div>
			{/if}
			{#if b.pointsEarned > 0}
				<div class="flex justify-between text-emerald-700"><dt>{m.complete_points_earned()}</dt><dd>+{b.pointsEarned.toLocaleString()}{m.common_point_unit()}</dd></div>
			{/if}
		</dl>

		<div class="mt-6 flex flex-wrap justify-center gap-3">
			<a href="data:text/calendar," download="{b.code}.ics" class="rounded-lg border border-stone-300 px-5 py-2 text-sm hover:bg-stone-50">{m.complete_calendar()}</a>
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

		<!-- クロスセル枠（P6: オプション予約 §15.2 をここに接続） -->
		<div class="mt-6 rounded-xl border border-stone-200 p-4 text-left text-sm text-stone-500">
			<p class="font-medium text-stone-600">{m.complete_cross_sell_heading()}</p>
			<p class="mt-1 text-xs">{m.complete_cross_sell_msg()}</p>
		</div>
	</div>
</div>
