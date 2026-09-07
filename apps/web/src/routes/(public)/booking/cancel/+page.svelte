<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDateLong, formatPrice } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();

	/** 主ボタン → 確認パネル → 確定、の二段。ブラウザ confirm() は文言が読みにくいので使わない */
	let confirming = $state(false);
	let submitting = $state(false);

	// 取り消し済みの表示は、成功したときと「既に取り消されていた」ときの両方で使う
	let done = $derived(form?.cancelled === true);

	/**
	 * 共有 PC の履歴・スクリーンショットにトークン入り URL を残さないため、
	 * 表示できたら URL から ?t= を落とす。落とした後にリロードすると
	 * 「リンクをもう一度お開きください」になる（トークンはページ状態にだけ持つ）。
	 */
	$effect(() => {
		if (data.state === 'ready' && typeof history !== 'undefined' && location.search) {
			history.replaceState(history.state, '', location.pathname);
		}
	});

	const REASON_TEXT: Record<string, { h: string; body: string; phone: boolean }> = {
		not_found: { h: m.gcancel_err_not_found_h(), body: m.gcancel_err_not_found(), phone: true },
		token_expired: { h: m.gcancel_err_expired_h(), body: m.gcancel_err_expired(), phone: true },
		past_checkin: { h: m.gcancel_err_expired_h(), body: m.gcancel_err_expired(), phone: true },
		token_used: { h: m.gcancel_err_used_h(), body: '', phone: false },
		already_cancelled: { h: m.gcancel_err_used_h(), body: '', phone: false },
		token_revoked: { h: m.gcancel_err_revoked_h(), body: m.gcancel_err_revoked(), phone: true },
		checked_in: { h: m.gcancel_err_stayed_h(), body: m.gcancel_err_stayed(), phone: false },
		checked_out: { h: m.gcancel_err_stayed_h(), body: m.gcancel_err_stayed(), phone: false },
		error: { h: m.gcancel_err_generic_h(), body: m.gcancel_err_generic(), phone: true }
	};

	let blocked = $derived(
		data.state === 'blocked' ? (REASON_TEXT[data.reason] ?? REASON_TEXT.not_found) : null
	);

	function ruleLabel(daysBefore: number): string {
		if (daysBefore < 0) return 'ご連絡なく不泊';
		if (daysBefore === 0) return '当日';
		return `${daysBefore}日前から`;
	}

	/** チェックインまでの残日数（JST 基準の日付文字列同士の差） */
	function daysUntil(checkin: string, asOf: string): number {
		const a = Date.parse(`${asOf}T00:00:00Z`);
		const b = Date.parse(`${checkin}T00:00:00Z`);
		return Math.round((b - a) / 86400000);
	}
</script>

<svelte:head>
	<title
		>{m.gcancel_title({
			facility: data.state === 'ready' || data.state === 'blocked' ? (data.booking?.facility_name ?? '') : ''
		})}</title
	>
	<meta name="robots" content="noindex,nofollow" />
	<meta name="referrer" content="no-referrer" />
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="font-display text-2xl text-brand-900">{m.gcancel_heading()}</h1>

	{#if data.unavailable}
		<p class="mt-6 rounded-xl bg-stone-50 p-4 text-stone-600">
			この画面は本番環境でのみご利用いただけます。
		</p>
	{:else if done}
		<!-- 完了 -->
		<div class="mt-6 rounded-2xl border border-stone-200 bg-white p-8 text-center">
			<p class="text-4xl text-emerald-600">✔</p>
			<h2 class="font-display mt-3 text-xl text-brand-900">{m.gcancel_done_heading()}</h2>
			<p class="mt-3 text-stone-700">{m.gcancel_done_body({ code: form?.code ?? '' })}</p>
			<p class="mt-2 text-stone-700">
				{#if (form?.fee ?? 0) > 0}
					{m.gcancel_done_fee({ fee: formatPrice(form?.fee ?? 0) })}
				{:else}
					{m.gcancel_fee_none()}
				{/if}
			</p>
			{#if data.state === 'ready'}
				<p class="mt-2 text-sm text-stone-500">
					{m.gcancel_done_mail({ email: data.booking.email_masked })}
				</p>
				<p class="mt-4 text-stone-600">{m.gcancel_done_thanks()}</p>
				<a
					class="mt-6 inline-block rounded-lg border border-brand-800 px-5 py-2.5 text-brand-800"
					href="/yamado/{data.booking.facility_slug}"
					>{m.gcancel_to_facility({ facility: data.booking.facility_name })}</a
				>
			{/if}
		</div>
	{:else if data.state === 'reload'}
		<div class="mt-6 rounded-xl border border-stone-200 bg-white p-6">
			<h2 class="text-lg text-brand-900">{m.gcancel_reload_h()}</h2>
			<p class="mt-2 text-stone-600">{m.gcancel_reload()}</p>
		</div>
	{:else if data.state === 'rate_limited'}
		<div class="mt-6 rounded-xl border border-stone-200 bg-white p-6">
			<h2 class="text-lg text-brand-900">しばらく時間をおいてお試しください</h2>
			<p class="mt-2 text-stone-600">
				アクセスが集中しています。{Math.ceil((data.retryInSec ?? 60) / 60)}分ほどおいてから、もう一度リンクをお開きください。
			</p>
		</div>
	{:else if data.state === 'error'}
		<div class="mt-6 rounded-xl border border-stone-200 bg-white p-6">
			<h2 class="text-lg text-brand-900">{m.gcancel_err_generic_h()}</h2>
			<p class="mt-2 text-stone-600">{m.gcancel_err_generic()}</p>
		</div>
	{:else if data.state === 'blocked' && blocked}
		<div class="mt-6 rounded-xl border border-stone-200 bg-white p-6">
			<h2 class="text-lg text-brand-900">{blocked.h}</h2>
			<p class="mt-2 text-stone-600">
				{#if data.reason === 'token_used' || data.reason === 'already_cancelled'}
					{m.gcancel_err_used({ code: data.booking?.code ?? '' })}
				{:else}
					{blocked.body}
				{/if}
			</p>
			{#if blocked.phone}
				<p class="mt-4 text-stone-700">
					{#if data.booking?.facility_phone}
						{m.gcancel_phone({ phone: data.booking.facility_phone })}
					{:else}
						山人-yamado- 0197-82-2222 ／ 山人-oga- 0185-47-7776
					{/if}
				</p>
			{:else if data.booking}
				<a
					class="mt-4 inline-block rounded-lg border border-brand-800 px-5 py-2.5 text-brand-800"
					href="/yamado/{data.booking.facility_slug}"
					>{m.gcancel_to_facility({ facility: data.booking.facility_name })}</a
				>
			{/if}
		</div>
	{:else if data.state === 'ready'}
		<p class="mt-4 whitespace-pre-line text-stone-700">
			{m.gcancel_intro({ name: data.booking.guest_name })}
		</p>

		<!-- ご予約内容 -->
		<dl class="mt-6 space-y-2 rounded-xl border border-stone-200 bg-white p-5 text-sm">
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">予約番号</dt>
				<dd class="font-bold tracking-wider text-brand-900">{data.booking.code}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">ご宿泊施設</dt>
				<dd>{data.booking.facility_name}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">チェックイン</dt>
				<dd>{formatDateLong(data.booking.check_in_date)}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">チェックアウト</dt>
				<dd>{formatDateLong(data.booking.check_out_date)}・{data.booking.nights}泊</dd>
			</div>
			{#if data.booking.room_name}
				<div class="flex justify-between gap-4">
					<dt class="shrink-0 text-stone-500">お部屋</dt>
					<dd class="text-right">{data.booking.room_name}</dd>
				</div>
			{/if}
			{#if data.booking.plan_name}
				<div class="flex justify-between gap-4">
					<dt class="shrink-0 text-stone-500">プラン</dt>
					<dd class="text-right">{data.booking.plan_name}</dd>
				</div>
			{/if}
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">ご人数</dt>
				<dd>大人{data.booking.adult_count}名</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">ご宿泊料金</dt>
				<dd>{formatPrice(data.booking.total_amount)}（税込・現地払い）</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">ご連絡先</dt>
				<dd>{data.booking.phone_masked} ／ {data.booking.email_masked}</dd>
			</div>
		</dl>

		<!-- キャンセル料 -->
		<h2 class="mt-8 text-sm text-stone-500">
			{m.gcancel_fee_heading({ date: formatDateLong(data.fee.as_of) })}
		</h2>
		<div class="mt-2 rounded-xl border border-stone-200 bg-white p-5">
			<p class="text-2xl font-bold text-brand-900">
				{data.fee.fee > 0 ? formatPrice(data.fee.fee) : m.gcancel_fee_none()}
			</p>
			{#if data.fee.fee > 0}
				{@const d = daysUntil(data.booking.check_in_date, data.fee.as_of)}
				<p class="mt-1 text-sm text-stone-600">
					{#if d <= 0}
						{m.gcancel_fee_today({ rate: String(Math.round(data.fee.rate * 100)) })}
					{:else}
						{m.gcancel_fee_line({
							rate: String(Math.round(data.fee.rate * 100)),
							days: String(d)
						})}
					{/if}
				</p>
			{/if}
			{#if data.fee.rules.length > 0}
				<details class="mt-3">
					<summary class="cursor-pointer text-sm text-brand-800">
						{data.fee.rules_source === 'plan' ? m.gcancel_rules_plan() : m.gcancel_rules_rank()}
					</summary>
					<table class="mt-2 text-sm">
						<tbody>
							{#each [...data.fee.rules].sort((a, b) => b.days_before - a.days_before) as r (r.days_before)}
								<tr>
									<td class="py-0.5 pr-6 text-stone-600">{ruleLabel(r.days_before)}</td>
									<td class="py-0.5">ご宿泊料金の{Math.round(r.rate * 100)}%</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</details>
			{/if}
		</div>
		{#if data.fee.fee > 0}
			<p class="mt-2 text-sm text-stone-500">{m.gcancel_fee_note()}</p>
		{/if}

		<!-- 取消（二段確認） -->
		{#if form?.reason}
			<p class="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
				{REASON_TEXT[form.reason]?.body || m.gcancel_err_generic()}
			</p>
		{/if}

		{#if !confirming}
			<button
				type="button"
				class="mt-6 h-[52px] w-full rounded-lg bg-brand-800 text-white"
				onclick={() => (confirming = true)}>{m.gcancel_btn()}</button
			>
		{:else}
			<div class="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
				<h2 class="text-lg text-brand-900">{m.gcancel_confirm_heading()}</h2>
				<p class="mt-2 text-stone-700">{m.gcancel_confirm_irreversible()}</p>
				<p class="mt-1 text-stone-700">
					{#if data.fee.fee > 0}
						{m.gcancel_confirm_fee({ fee: formatPrice(data.fee.fee) })}
					{:else}
						{m.gcancel_fee_none()}
					{/if}
				</p>
				<p class="mt-1 text-sm text-stone-600">
					{m.gcancel_confirm_mail({ email: data.booking.email_masked })}
				</p>
				<form
					method="POST"
					action="?/cancel"
					class="mt-4 flex gap-3"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							await update();
							submitting = false;
							confirming = false;
						};
					}}
				>
					<input type="hidden" name="token" value={data.token} />
					<button
						type="button"
						class="h-[52px] flex-1 rounded-lg border border-stone-300"
						disabled={submitting}
						onclick={() => (confirming = false)}>{m.gcancel_back()}</button
					>
					<button
						type="submit"
						class="h-[52px] flex-1 rounded-lg bg-red-600 text-white disabled:opacity-60"
						disabled={submitting}
						>{submitting ? m.gcancel_submitting() : m.gcancel_submit()}</button
					>
				</form>
			</div>
		{/if}

		<p class="mt-6 text-sm text-stone-500">{m.gcancel_keep()}</p>
		{#if data.booking.facility_phone}
			<p class="text-sm text-stone-500">
				{m.gcancel_phone({ phone: data.booking.facility_phone })}
			</p>
		{/if}
	{/if}
</div>
