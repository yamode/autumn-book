<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatDateLong, formatPrice } from '$lib/format';
	import * as m from '$lib/paraglide/messages';

	let { data, form } = $props();
	// 1 室だけ取り消した後は、action が返した最新の表示（残りのお部屋）を使う（URL から ?t= を落としているため再読込できない）
	let v = $derived(form && 'view' in form && form.view ? form.view : data);
	/** 1 室ずつの取消（M2）: 確認を開いている部屋の番号 */
	let confirmRoom = $state<number | null>(null);

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
		if (v.state === 'ready' && typeof history !== 'undefined' && location.search) {
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
		room_not_cancellable: { h: m.gcancel_err_room_h(), body: m.gcancel_err_room(), phone: true },
		// 特別会員の専用ページ経由の予約（取消・変更は専用ページのご予約一覧から・docs/vip-member-page.md §13.4.4）
		member_page: { h: m.gcancel_member_page_h(), body: m.gcancel_member_page(), phone: false },
		error: { h: m.gcancel_err_generic_h(), body: m.gcancel_err_generic(), phone: true }
	};

	let blocked = $derived(
		v.state === 'blocked' ? (REASON_TEXT[v.reason] ?? REASON_TEXT.not_found) : null
	);
	// 特別会員の専用ページの予約詳細（/p/<token>/bookings/<予約番号>）。会員ログインのうえで開く
	let memberPageUrl = $derived.by(() => {
		const fromView = v.state === 'blocked' && 'memberPage' in v ? v.memberPage?.url : null;
		const fromForm = form && 'memberPage' in form ? (form.memberPage as { url: string | null } | undefined)?.url : null;
		const url = fromView ?? fromForm ?? null;
		// 同じサイトの相対パスだけ（念のため）
		return url && url.startsWith('/p/') ? url : null;
	});

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
			facility: v.state === 'ready' || v.state === 'blocked' ? (v.booking?.facility_name ?? '') : ''
		})}</title
	>
	<meta name="robots" content="noindex,nofollow" />
	<meta name="referrer" content="same-origin" />
</svelte:head>

<div class="mx-auto max-w-2xl px-4 py-10">
	<h1 class="font-display text-2xl text-brand-900">{m.gcancel_heading()}</h1>

	{#if v.unavailable}
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
			{#if form?.refund?.kind === 'refunded'}
				<p class="mt-2 text-stone-700">{m.cancel_refund_done({ amount: formatPrice(form.refund.amount) })}</p>
				{#if form.refund.kept > 0 && form.refund.reason === 'admin_fee'}<p class="mt-1 text-sm text-stone-600">{m.cancel_refund_kept_admin_fee({ amount: formatPrice(form.refund.adminFee), percent: `${form.refund.adminFeePercent ?? ''}%` })}</p>
				{:else if form.refund.kept > 0}<p class="mt-1 text-sm text-stone-600">{m.cancel_refund_kept({ amount: formatPrice(form.refund.kept) })}</p>{/if}
			{:else if form?.refund?.kind === 'failed'}
				<p class="mt-2 text-red-700">{m.cancel_refund_failed()}</p>
			{:else if form?.refund?.kind === 'nothing_due'}
				<p class="mt-2 text-stone-700">{m.cancel_refund_none()}</p>
			{/if}
			{#if v.state === 'ready'}
				<p class="mt-2 text-sm text-stone-500">
					{m.gcancel_done_mail({ email: v.booking.email_masked })}
				</p>
				<p class="mt-4 text-stone-600">{m.gcancel_done_thanks()}</p>
				<a
					class="mt-6 inline-block rounded-lg border border-brand-800 px-5 py-2.5 text-brand-800"
					href="/yamado/{v.booking.facility_slug}"
					>{m.gcancel_to_facility({ facility: v.booking.facility_name })}</a
				>
			{/if}
		</div>
	{:else if v.state === 'reload'}
		<div class="mt-6 rounded-xl border border-stone-200 bg-white p-6">
			<h2 class="text-lg text-brand-900">{m.gcancel_reload_h()}</h2>
			<p class="mt-2 text-stone-600">{m.gcancel_reload()}</p>
		</div>
	{:else if v.state === 'rate_limited'}
		<div class="mt-6 rounded-xl border border-stone-200 bg-white p-6">
			<h2 class="text-lg text-brand-900">しばらく時間をおいてお試しください</h2>
			<p class="mt-2 text-stone-600">
				アクセスが集中しています。{Math.ceil((v.retryInSec ?? 60) / 60)}分ほどおいてから、もう一度リンクをお開きください。
			</p>
		</div>
	{:else if v.state === 'error'}
		<div class="mt-6 rounded-xl border border-stone-200 bg-white p-6">
			<h2 class="text-lg text-brand-900">{m.gcancel_err_generic_h()}</h2>
			<p class="mt-2 text-stone-600">{m.gcancel_err_generic()}</p>
		</div>
	{:else if v.state === 'blocked' && blocked}
		<div class="mt-6 rounded-xl border border-stone-200 bg-white p-6">
			<h2 class="text-lg text-brand-900">{blocked.h}</h2>
			<p class="mt-2 text-stone-600">
				{#if v.reason === 'token_used' || v.reason === 'already_cancelled'}
					{m.gcancel_err_used({ code: v.booking?.code ?? '' })}
				{:else}
					{blocked.body}
				{/if}
			</p>
			{#if v.reason === 'member_page'}
				{#if memberPageUrl}
					<a class="mt-4 inline-block rounded-lg bg-brand-800 px-5 py-2.5 text-white hover:bg-brand-700" href={memberPageUrl}>{m.gcancel_member_page_link()}</a>
				{/if}
			{:else if blocked.phone}
				<p class="mt-4 text-stone-700">
					{#if v.booking?.facility_phone}
						{m.gcancel_phone({ phone: v.booking.facility_phone })}
					{:else}
						山人-yamado- 0197-82-2222 ／ 山人-oga- 0185-47-7776
					{/if}
				</p>
			{:else if v.booking}
				<a
					class="mt-4 inline-block rounded-lg border border-brand-800 px-5 py-2.5 text-brand-800"
					href="/yamado/{v.booking.facility_slug}"
					>{m.gcancel_to_facility({ facility: v.booking.facility_name })}</a
				>
			{/if}
		</div>
	{:else if v.state === 'ready'}
		{#if form && 'roomCancelled' in form && form.roomCancelled}
			<!-- 1 室だけ取り消した（M2）。予約は残りのお部屋で続く -->
			<div class="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">
				<p class="font-medium">{m.gcancel_room_done({ n: String(form.roomCancelled.index) })}</p>
				<p class="mt-1">{form.roomCancelled.fee > 0 ? m.gcancel_done_fee({ fee: formatPrice(form.roomCancelled.fee) }) : m.gcancel_fee_none()}</p>
				{#if form.refund?.kind === 'refunded'}
					<p class="mt-1">{m.cancel_refund_done({ amount: formatPrice(form.refund.amount) })}</p>
				{:else if form.refund?.kind === 'failed'}
					<p class="mt-1 text-red-700">{m.cancel_refund_failed()}</p>
				{/if}
				<p class="mt-1 text-emerald-700">{m.gcancel_room_done_mail({ email: v.booking.email_masked })}</p>
			</div>
		{/if}
		<p class="mt-4 whitespace-pre-line text-stone-700">
			{m.gcancel_intro({ name: v.booking.guest_name })}
		</p>

		<!-- ご予約内容 -->
		<dl class="mt-6 space-y-2 rounded-xl border border-stone-200 bg-white p-5 text-sm">
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">予約番号</dt>
				<dd class="font-bold tracking-wider text-brand-900">{v.booking.code}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">ご宿泊施設</dt>
				<dd>{v.booking.facility_name}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">チェックイン</dt>
				<dd>{formatDateLong(v.booking.check_in_date)}</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">チェックアウト</dt>
				<dd>{formatDateLong(v.booking.check_out_date)}・{v.booking.nights}泊</dd>
			</div>
			{#if v.multi}
				<!-- 複数室: 部屋ごとのカード（M1）・この部屋を取り消す（M2） -->
				<div>
					<dt class="text-stone-500">{m.hold_rooms_label({ n: String(v.roomsView.length) })}</dt>
					<dd class="mt-1 space-y-2">
						{#each v.roomsView as r (r.index)}
							<div class="rounded-lg border border-stone-200 p-3 {r.cancelled ? 'bg-stone-50 text-stone-400' : ''}">
								<p class="flex justify-between gap-2">
									<span>{m.complete_room_line({ n: String(r.index), room: r.roomName, plan: r.planName, adults: String(r.adults) })}</span>
									<span class="whitespace-nowrap tabular-nums">{r.cancelled ? m.reservation_room_cancelled() : formatPrice(r.charge)}</span>
								</p>
								{#if !r.cancelled}
									<p class="mt-1 text-xs text-stone-600">
										{r.fee > 0 ? m.gcancel_room_fee({ fee: formatPrice(r.fee), rate: String(Math.round(r.rate * 100)) }) : m.gcancel_fee_none()}
										{#if r.refund}・{r.refund.refund > 0 ? m.reservation_room_refund_preview({ refund: formatPrice(r.refund.refund), deducted: formatPrice(r.refund.deducted) }) : m.cancel_refund_none()}{/if}
									</p>
									{#if confirmRoom !== r.index}
										<button type="button" class="mt-2 h-10 w-full rounded-lg border border-red-300 text-sm text-red-600" onclick={() => (confirmRoom = r.index)}>{m.reservation_room_cancel_btn()}</button>
									{:else}
										<div class="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
											<p class="text-brand-900">{m.reservation_room_cancel_confirm({ n: String(r.index) })}</p>
											<p class="mt-1 text-stone-700">{m.gcancel_confirm_irreversible()}</p>
											{#if v.liveRooms === 1}<p class="mt-1 text-stone-700">{m.reservation_room_cancel_last()}</p>{/if}
											<form
												method="POST"
												action="?/cancelRoom"
												class="mt-3 flex gap-2"
												use:enhance={() => {
													submitting = true;
													return async ({ update }) => {
														await update({ invalidateAll: false });
														submitting = false;
														confirmRoom = null;
													};
												}}
											>
												<input type="hidden" name="token" value={v.token} />
												<input type="hidden" name="roomIndex" value={r.index} />
												<button type="button" class="h-11 flex-1 rounded-lg border border-stone-300 bg-white" disabled={submitting} onclick={() => (confirmRoom = null)}>{m.gcancel_back()}</button>
												<button type="submit" class="h-11 flex-1 rounded-lg bg-red-600 text-white disabled:opacity-60" disabled={submitting}>{submitting ? m.gcancel_submitting() : m.gcancel_submit()}</button>
											</form>
										</div>
									{/if}
								{/if}
							</div>
						{/each}
					</dd>
				</div>
			{:else}
				{#if v.booking.room_name}
					<div class="flex justify-between gap-4">
						<dt class="shrink-0 text-stone-500">お部屋</dt>
						<dd class="text-right">{v.booking.room_name}</dd>
					</div>
				{/if}
				{#if v.booking.plan_name}
					<div class="flex justify-between gap-4">
						<dt class="shrink-0 text-stone-500">プラン</dt>
						<dd class="text-right">{v.booking.plan_name}</dd>
					</div>
				{/if}
				<div class="flex justify-between gap-4">
					<dt class="text-stone-500">ご人数</dt>
					<dd>大人{v.booking.adult_count}名</dd>
				</div>
			{/if}
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">ご宿泊料金</dt>
				<dd>{formatPrice(v.booking.total_amount)}（税込・現地払い）</dd>
			</div>
			<div class="flex justify-between gap-4">
				<dt class="text-stone-500">ご連絡先</dt>
				<dd>{v.booking.phone_masked} ／ {v.booking.email_masked}</dd>
			</div>
		</dl>

		<!-- キャンセル料 -->
		<h2 class="mt-8 text-sm text-stone-500">
			{m.gcancel_fee_heading({ date: formatDateLong(v.fee.as_of) })}
		</h2>
		<div class="mt-2 rounded-xl border border-stone-200 bg-white p-5">
			<p class="text-2xl font-bold text-brand-900">
				{v.fee.fee > 0 ? formatPrice(v.fee.fee) : m.gcancel_fee_none()}
			</p>
			{#if v.fee.fee > 0}
				{@const d = daysUntil(v.booking.check_in_date, v.fee.as_of)}
				<p class="mt-1 text-sm text-stone-600">
					{#if d <= 0}
						{m.gcancel_fee_today({ rate: String(Math.round(v.fee.rate * 100)) })}
					{:else}
						{m.gcancel_fee_line({
							rate: String(Math.round(v.fee.rate * 100)),
							days: String(d)
						})}
					{/if}
				</p>
			{/if}
			{#if v.fee.rules.length > 0}
				<details class="mt-3">
					<summary class="cursor-pointer text-sm text-brand-800">
						{v.fee.rules_source === 'plan' ? m.gcancel_rules_plan() : m.gcancel_rules_rank()}
					</summary>
					<table class="mt-2 text-sm">
						<tbody>
							{#each [...v.fee.rules].sort((a, b) => b.days_before - a.days_before) as r (r.days_before)}
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
		{#if v.refund}
			<!-- オンライン決済済み: キャンセル料を差し引いてカードへ返金（入湯税はキャンセル料の対象外） -->
			<p class="mt-2 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
				{#if v.refund.refund <= 0}
					{m.cancel_refund_none()}
				{:else if v.refund.adminFeePercent != null && v.refund.reason !== 'prepay_discount'}
					<!-- 事務手数料（2026-10-07）: キャンセル料と事務手数料の大きい方を差し引く -->
					{m.cancel_refund_preview_admin_fee({
						paid: formatPrice(v.refund.paid),
						fee: formatPrice(v.refund.fee),
						adminFee: formatPrice(v.refund.adminFee),
						percent: `${v.refund.adminFeePercent}%`,
						deducted: formatPrice(v.refund.deducted),
						refund: formatPrice(v.refund.refund)
					})}
				{:else if v.refund.discount > 0}
					<!-- 予約時決済の割引額は返金しない: キャンセル料と割引額の大きい方を差し引く -->
					{m.cancel_refund_preview_discount({
						paid: formatPrice(v.refund.paid),
						fee: formatPrice(v.refund.fee),
						discount: formatPrice(v.refund.discount),
						deducted: formatPrice(v.refund.deducted),
						refund: formatPrice(v.refund.refund)
					})}
				{:else}
					{m.cancel_refund_preview({ paid: formatPrice(v.refund.paid), fee: formatPrice(v.refund.fee), refund: formatPrice(v.refund.refund) })}
				{/if}
			</p>
		{:else if v.fee.fee > 0}
			<p class="mt-2 text-sm text-stone-500">{m.gcancel_fee_note()}</p>
		{/if}

		<!-- 取消（二段確認） -->
		{#if form?.reason}
			<p class="mt-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
				{REASON_TEXT[form.reason]?.body || m.gcancel_err_generic()}
				{#if form.reason === 'member_page' && memberPageUrl}
					<a href={memberPageUrl} class="mt-2 block font-medium underline">{m.gcancel_member_page_link()}</a>
				{/if}
			</p>
		{/if}

		{#if !confirming}
			<button
				type="button"
				class="mt-6 h-[52px] w-full rounded-lg bg-brand-800 text-white"
				onclick={() => (confirming = true)}>{v.multi ? m.gcancel_btn_all() : m.gcancel_btn()}</button
			>
		{:else}
			<div class="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
				<h2 class="text-lg text-brand-900">{m.gcancel_confirm_heading()}</h2>
				<p class="mt-2 text-stone-700">{m.gcancel_confirm_irreversible()}</p>
				<p class="mt-1 text-stone-700">
					{#if v.fee.fee > 0}
						{m.gcancel_confirm_fee({ fee: formatPrice(v.fee.fee) })}
					{:else}
						{m.gcancel_fee_none()}
					{/if}
				</p>
				<p class="mt-1 text-sm text-stone-600">
					{m.gcancel_confirm_mail({ email: v.booking.email_masked })}
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
					<input type="hidden" name="token" value={v.token} />
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
		{#if v.booking.facility_phone}
			<p class="text-sm text-stone-500">
				{m.gcancel_phone({ phone: v.booking.facility_phone })}
			</p>
		{/if}
	{/if}
</div>
