<script lang="ts" module>
	import type { BookingOptionOrder, BookingAmendment } from '$lib/types';

	// 予約詳細の本体（公式マイページ /account/reservations/[code] と、特別会員の専用ページ /p/<token>/bookings/<予約番号> で共用・
	// docs/vip-member-page.md §13.6）。読み出し（reservationDetailOf）と同じ形のうち、画面で使う所だけを型にする。
	export type ReservationDetailRoom = {
		index: number;
		stayCode: string;
		roomName: string;
		planName: string;
		adults: number;
		total: number;
		cancelled: boolean;
		cancelFee: number;
		canCancel: boolean;
		fee: { fee: number } | null;
		refundPreview: { refund: number; deducted: number } | null;
		memberPerks?: { title: string }[] | null;
	};
	export type ReservationDetailData = {
		booking: {
			code: string;
			status: string;
			channel?: string;
			checkin: string;
			nights: number;
			adults: number;
			guest: { name: string; shuttle?: boolean; notes?: string };
			total: number;
			pointsUsed: number;
			pointsEarned: number;
			payment: string;
			paymentStatus?: string | null;
			cancelFee?: number;
			cancellationPolicy: { note?: string | null };
		};
		options?: BookingOptionOrder[] | null;
		amendments?: BookingAmendment[] | null;
		rooms?: ReservationDetailRoom[] | null;
		multiRoom: boolean;
		amend: { canAmend: boolean; remaining: number; datesOnly: boolean };
		plan: { name: string };
		room: { name: string };
		cancelPreview: { fee: number; rate: number; rules?: { days_before: number; rate: number }[] | null; rulesSource?: string | null } | null;
		refundPreview: {
			refund: number;
			paid: number;
			fee: number;
			deducted: number;
			discount: number;
			adminFee: number;
			adminFeePercent: number | null;
			reason?: string | null;
		} | null;
		prepayBonus: { points: number; granted: boolean } | null;
		memberPerks?: { title: string; description?: string }[] | null;
	};
	export type ReservationDetailFacility = {
		name: string;
		checkinTime?: string;
		phone?: string;
		addressPublic?: string;
		lat?: number | string;
		lng?: number | string;
	};
	/** 特別会員の専用ページ経由の予約（見出しの 1 行・キャンセル方式・参照のみのときの専用ページへのリンク） */
	export type ReservationMemberPage = { pageName: string; cancelMode: string; href?: string | null } | null;
</script>

<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatPrice, formatDateLong, formatDate, todayStr } from '$lib/format';
	import * as m from '$lib/paraglide/messages';
	import type { AmendmentKind } from '$lib/types';

	let {
		data,
		form,
		facility,
		hrefs,
		readOnly = false,
		memberPage = null,
		canAmend
	}: {
		data: ReservationDetailData;
		form?: Record<string, unknown> | null;
		facility: ReservationDetailFacility;
		/** 日程変更・オプション追加の行き先（公式は /account/reservations/<code>/…・専用ページは /p/<token>/bookings/<code>/…） */
		hrefs: { amend: string; options: string };
		/** 参照のみ（公式マイページで専用ページ経由の予約を見るとき）: 取消・日程変更・オプションの操作を出さない */
		readOnly?: boolean;
		memberPage?: ReservationMemberPage;
		/** 日程変更のボタンを出すか（省略時は data.amend.canAmend） */
		canAmend?: boolean;
	} = $props();

	let b = $derived(data.booking);
	let showCancelConfirm = $state(false);
	// 1 室ずつの取消（M2）: 確認を開いている部屋の番号
	let confirmRoom = $state<number | null>(null);
	let rooms = $derived(data.rooms ?? []);
	let liveCount = $derived(rooms.filter((r) => !r.cancelled).length);
	// form の中身（取消・オプション取消の結果）。ページごとに形が少し違うので、使う所だけを読む
	type Refund = { kind: string; amount?: number; kept?: number; reason?: string; adminFee?: number; adminFeePercent?: number | null };
	let f = $derived((form ?? {}) as { cancelled?: boolean; roomCancelled?: { index: number; bookingCancelled: boolean }; refund?: Refund; optionCancelled?: boolean; message?: string });

	// 変更履歴・変更可否
	let amendments = $derived(data.amendments ?? []);
	let amend = $derived(data.amend);
	let showAmend = $derived(!readOnly && (canAmend ?? amend?.canAmend ?? false));

	// 特別会員: キャンセル方式の表示名（言語ごと）
	function cancelModeLabel(mode: string): string {
		return mode === 'page' ? m.member_cancel_mode_page() : mode === 'rank' ? m.member_cancel_mode_rank() : m.member_cancel_mode_favorable();
	}
	const perkTitles = (list: { title: string }[] | null | undefined) => (list ?? []).map((p) => p.title).filter(Boolean).join('／');

	// 変更種別バッジの文言
	function amendKindLabel(kind: AmendmentKind): string {
		switch (kind) {
			case 'dates': return m.amend_kind_dates();
			case 'party': return m.amend_kind_party();
			case 'room': return m.amend_kind_room();
			case 'plan': return m.amend_kind_plan();
			default: return m.amend_kind_composite();
		}
	}

	// 支払いステータスラベル
	function paymentStatusLabel(status: string): string {
		switch (status) {
			case 'paid': return m.reservation_payment_paid();
			case 'refunded': return m.reservation_payment_refunded();
			case 'partial_refund': return m.reservation_payment_partial();
			default: return m.reservation_payment_unpaid();
		}
	}

	// オプションのカテゴリラベル
	function categoryLabel(cat: BookingOptionOrder['category']): string {
		switch (cat) {
			case 'meal': return m.options_category_meal();
			case 'spa': return m.options_category_spa();
			case 'activity': return m.options_category_activity();
			case 'amenity': return m.options_category_amenity();
			case 'personalize': return m.options_category_personalize();
			default: return m.options_category_other();
		}
	}

	// 提供日（無ければチェックイン日）の前日まで取消可（表示判定・強制は RPC/store 側）
	function canCancelOption(o: BookingOptionOrder): boolean {
		if (readOnly || o.status !== 'reserved') return false;
		const basis = o.serviceDate ?? b.checkin;
		return todayStr() < basis;
	}

	let options = $derived(data.options ?? []);
	let optionsTotal = $derived(options.reduce((s, o) => s + o.amount, 0));
	// 宿泊日変更でオプションの提供日が滞在期間外になった明細があるか（取り直し導線用）
	let hasNeedsReschedule = $derived(options.some((o) => o.status === 'needs_reschedule'));
</script>

{#if readOnly && memberPage}
	<!-- 特別会員の専用ページ経由の予約は参照のみ（変更・取消・アレンジは専用ページのご予約一覧から・§13.4.4） -->
	<div class="mb-4 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
		<p>{m.member_page_readonly()}</p>
		{#if memberPage.href}
			<a href={memberPage.href} class="mt-2 inline-block rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">{m.member_page_readonly_link()}</a>
		{/if}
	</div>
{/if}
{#if f.cancelled || f.roomCancelled}
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
		{f.roomCancelled && !f.roomCancelled.bookingCancelled ? m.reservation_room_cancelled_ok({ n: String(f.roomCancelled.index) }) : m.reservation_cancelled_ok()}
	</p>
	{#if f.refund?.kind === 'refunded'}
		<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
			{m.cancel_refund_done({ amount: formatPrice(f.refund.amount ?? 0) })}
			{#if (f.refund.kept ?? 0) > 0 && f.refund.reason === 'admin_fee'}<br />{m.cancel_refund_kept_admin_fee({ amount: formatPrice(f.refund.adminFee ?? 0), percent: `${f.refund.adminFeePercent ?? ''}%` })}
			{:else if (f.refund.kept ?? 0) > 0}<br />{m.cancel_refund_kept({ amount: formatPrice(f.refund.kept ?? 0) })}{/if}
		</p>
	{:else if f.refund?.kind === 'failed'}
		<p class="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{m.cancel_refund_failed()}</p>
	{/if}
{/if}
{#if f.optionCancelled}
	<p class="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{m.options_cancel_ok()}</p>
{/if}
{#if f.message}
	<p class="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{f.message}</p>
{/if}
{#if hasNeedsReschedule && !readOnly}
	<div class="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
		{m.amend_needs_reschedule()}
		<a href={hrefs.options} class="ml-1 font-medium underline">{m.amend_needs_reschedule_link()}</a>
	</div>
{/if}

<div class="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
	<div class="min-w-0 rounded-2xl border border-stone-200 bg-white p-6">
		<div class="flex items-center justify-between gap-2">
			<h1 class="min-w-0 text-xl font-semibold text-brand-900">{facility.name}</h1>
			<span class="shrink-0 rounded-full px-3 py-1 text-xs {b.status === 'reserved' ? 'bg-emerald-50 text-emerald-700' : b.status === 'cancelled' ? 'bg-stone-100 text-stone-500' : 'bg-blue-50 text-blue-600'}">
				{b.status === 'reserved' ? m.account_status_reserved() : b.status === 'cancelled' ? m.account_status_cancelled() : m.account_status_stayed()}
			</span>
		</div>
		<p class="mt-1 text-xs text-stone-400">{m.reservation_booking_number({ code: b.code })}{b.channel === 'ota' ? m.reservation_ota_note() : ''}</p>
		{#if memberPage}
			<!-- 特別会員の専用ページ経由（ページ名・キャンセル方式） -->
			<p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
				<span class="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">{m.member_page_badge()}</span>
				<span class="text-stone-600">{m.member_page_via({ page: memberPage.pageName })}</span>
			</p>
			<p class="mt-1 text-xs text-stone-500">{m.member_page_cancel_mode({ mode: cancelModeLabel(memberPage.cancelMode) })}</p>
		{/if}

		<dl class="mt-5 space-y-2 text-sm">
			<div class="flex justify-between gap-3 border-b border-stone-100 pb-2"><dt class="shrink-0 text-stone-500">{m.reservation_checkin()}</dt><dd class="text-right">{formatDateLong(b.checkin)} {facility.checkinTime ?? ''}{facility.checkinTime ? '〜' : ''}</dd></div>
			<div class="flex justify-between gap-3 border-b border-stone-100 pb-2"><dt class="shrink-0 text-stone-500">{m.reservation_nights_adults()}</dt><dd>{b.nights}泊・大人{b.adults}名</dd></div>
			{#if data.multiRoom}
				<!-- 複数室（M1）: 部屋ごとのカード（部屋名／プラン名／人数／金額／状態） -->
				<div class="border-b border-stone-100 pb-2">
					<dt class="text-stone-500">{m.reservation_rooms_heading({ n: String(rooms.length) })}</dt>
					<dd class="mt-1.5 space-y-1.5">
						{#each rooms as r (r.index)}
							<div class="rounded-lg border border-stone-200 px-3 py-2 {r.cancelled ? 'bg-stone-50 text-stone-400' : ''}">
								<p class="flex items-center justify-between gap-2 text-xs text-stone-500">
									<span>{m.hold_room_n({ n: String(r.index) })}・{r.stayCode}</span>
									{#if r.cancelled}<span class="rounded-full bg-stone-100 px-2 py-0.5">{m.reservation_room_cancelled()}</span>{/if}
								</p>
								<p class="font-medium text-brand-900">{r.roomName || '—'}</p>
								<p class="text-xs text-stone-600">{r.planName || '—'}</p>
								<p class="flex justify-between text-xs text-stone-600"><span>{m.hold_room_adults({ adults: String(r.adults) })}</span><span class="tabular-nums">{formatPrice(r.total)}</span></p>
								{#if perkTitles(r.memberPerks)}
									<p class="mt-0.5 text-xs text-amber-800">{m.member_page_perks()}: {perkTitles(r.memberPerks)}</p>
								{/if}
								{#if r.cancelled && r.cancelFee > 0}
									<p class="mt-0.5 text-right text-xs text-red-600">{m.reservation_cancel_fee()} {formatPrice(r.cancelFee)}</p>
								{/if}
								{#if r.canCancel && !readOnly}
									<!-- 1 室ずつの取消（M2）。押すと確認（キャンセル料・返金の見込み）→ 確定 -->
									{#if confirmRoom !== r.index}
										<button type="button" onclick={() => (confirmRoom = r.index)} class="mt-1.5 w-full rounded-md border border-red-200 py-1 text-xs text-red-600 hover:bg-red-50">{m.reservation_room_cancel_btn()}</button>
									{:else}
										<div class="mt-1.5 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
											<p class="font-medium">{m.reservation_room_cancel_confirm({ n: String(r.index) })}</p>
											<p class="mt-0.5">{m.reservation_room_cancel_fee({ fee: formatPrice(r.fee?.fee ?? 0) })}</p>
											{#if r.refundPreview}
												{@const rp = r.refundPreview}
												<p class="mt-0.5">{rp.refund > 0 ? m.reservation_room_refund_preview({ refund: formatPrice(rp.refund), deducted: formatPrice(rp.deducted) }) : m.cancel_refund_none()}</p>
											{/if}
											{#if liveCount === 1}<p class="mt-0.5">{m.reservation_room_cancel_last()}</p>{/if}
											<form method="POST" action="?/cancelRoom" use:enhance={() => async ({ update }) => { await update(); confirmRoom = null; }} class="mt-1.5 flex gap-2">
												<input type="hidden" name="roomIndex" value={r.index} />
												<button type="submit" class="flex-1 rounded bg-red-600 py-1 text-white hover:bg-red-500">{m.reservation_cancel_confirm_btn()}</button>
												<button type="button" onclick={() => (confirmRoom = null)} class="flex-1 rounded border border-stone-300 bg-white py-1 text-stone-700">{m.reservation_back()}</button>
											</form>
										</div>
									{/if}
								{/if}
							</div>
						{/each}
					</dd>
				</div>
			{:else}
				<div class="flex justify-between gap-3 border-b border-stone-100 pb-2"><dt class="shrink-0 text-stone-500">{m.reservation_room()}</dt><dd class="text-right">{data.room.name}</dd></div>
				<div class="flex justify-between gap-3 border-b border-stone-100 pb-2"><dt class="shrink-0 text-stone-500">{m.reservation_plan()}</dt><dd class="max-w-[60%] text-right">{data.plan.name}</dd></div>
				{#if perkTitles(data.memberPerks)}
					<div class="flex justify-between gap-3 border-b border-stone-100 pb-2"><dt class="shrink-0 text-stone-500">{m.member_page_perks()}</dt><dd class="max-w-[60%] text-right text-amber-800">{perkTitles(data.memberPerks)}</dd></div>
				{/if}
			{/if}
			<div class="flex justify-between gap-3 border-b border-stone-100 pb-2"><dt class="shrink-0 text-stone-500">{m.reservation_guest()}</dt><dd class="text-right">{m.reservation_guest_val({ name: b.guest.name })}</dd></div>
			{#if b.guest.shuttle}
				<div class="flex justify-between gap-3 border-b border-stone-100 pb-2"><dt class="shrink-0 text-stone-500">{m.reservation_shuttle()}</dt><dd>{m.reservation_shuttle_val()}</dd></div>
			{/if}
			{#if b.guest.notes}
				<div class="flex justify-between gap-3 border-b border-stone-100 pb-2"><dt class="shrink-0 text-stone-500">{m.reservation_notes()}</dt><dd class="max-w-[60%] break-words text-right">{b.guest.notes}</dd></div>
			{/if}
			<div class="flex justify-between pt-1 font-medium"><dt>{m.reservation_total()}</dt><dd>{formatPrice(b.total)}</dd></div>
			{#if b.pointsUsed > 0}
				<div class="flex justify-between text-emerald-700"><dt>{m.reservation_points_used()}</dt><dd>-{b.pointsUsed.toLocaleString()}{m.common_point_unit()}</dd></div>
			{/if}
			{#if data.prepayBonus}
				<!-- 早期決済ポイント（予約時決済で宿泊後に上乗せ付与。会員ランクの通常ポイントとは別） -->
				<div class="flex justify-between text-emerald-700">
					<dt>{data.prepayBonus.granted ? m.reservation_prepay_points_granted() : m.reservation_prepay_points()}</dt>
					<dd>+{data.prepayBonus.points.toLocaleString()}{m.common_point_unit()}</dd>
				</div>
			{/if}
			<div class="flex justify-between gap-3 text-stone-500"><dt>{m.reservation_payment()}</dt><dd class="text-right">{b.payment !== 'onsite' ? `${m.reservation_payment_card()}（${paymentStatusLabel(b.paymentStatus ?? '')}）` : m.reservation_payment_local()}</dd></div>
			{#if b.cancelFee !== undefined}
				<div class="flex justify-between text-red-600"><dt>{m.reservation_cancel_fee()}</dt><dd>{formatPrice(b.cancelFee)}</dd></div>
			{/if}
		</dl>
	</div>

	<aside class="min-w-0 space-y-4">
		{#if b.status === 'reserved' && data.cancelPreview}
			<div class="rounded-2xl border border-stone-200 bg-white p-5 text-sm">
				<h2 class="font-medium text-brand-900">{m.reservation_cancel_section()}</h2>
				<p class="mt-2 rounded bg-stone-50 px-3 py-2 text-stone-600">
					{m.reservation_cancel_today_fee()}
					<strong class="{data.cancelPreview.fee > 0 ? 'text-red-600' : 'text-emerald-700'}">
						{formatPrice(data.cancelPreview.fee)}（{Math.round(data.cancelPreview.rate * 100)}%）
					</strong>
				</p>

				<!-- 適用される規定（会員グレードの規定・プランの規定・特別会員の専用ページの規定） -->
				<div class="mt-2 rounded border border-stone-100 bg-white px-3 py-2 text-xs">
					<p class="font-medium text-brand-900">{data.cancelPreview.rulesSource === 'member_page' ? m.member_page_rules_heading() : m.cancelrank_your_grade()}</p>
					{#if (data.cancelPreview.rules ?? []).length === 0}
						<p class="mt-1 text-emerald-700">{m.cancelrank_none()}</p>
					{:else}
						<ul class="mt-1 space-y-0.5 text-stone-600">
							{#each data.cancelPreview.rules ?? [] as rule}
								<li>{m.cancelrank_rule_line({ days: String(rule.days_before), rate: String(Math.round(rule.rate * 100)) })}</li>
							{/each}
						</ul>
						{#if data.cancelPreview.rulesSource === 'plan'}
							<p class="mt-1 text-stone-400">{m.cancelrank_plan_note()}</p>
						{/if}
					{/if}
				</div>

				{#if b.cancellationPolicy.note}<p class="mt-2 text-xs text-stone-400">{b.cancellationPolicy.note}</p>{/if}

				{#if !readOnly}
					{#if data.multiRoom}
						<!-- 2 室以上（M2）: お部屋ごとに取り消せる（左のお部屋のカード）。ここは残りのお部屋をすべて取り消す -->
						<p class="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">{m.reservation_multi_cancel_note()}</p>
					{/if}
					{#if !showCancelConfirm}
						<button type="button" onclick={() => (showCancelConfirm = true)} class="mt-3 w-full rounded-lg border border-red-300 py-2 text-red-600 hover:bg-red-50">{data.multiRoom ? m.reservation_cancel_all_btn() : m.reservation_cancel_btn()}</button>
					{:else}
						<div class="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
							<p class="font-medium text-red-700">{m.reservation_cancel_confirm_heading()}</p>
							<ul class="mt-1 list-disc pl-4 text-xs text-red-600">
								<li>{m.reservation_cancel_fee_notice({ fee: formatPrice(data.cancelPreview.fee) })}</li>
								{#if data.refundPreview}
									<!-- オンライン決済済み: 返金の見込み（予約時決済の割引額は返金しない＝キャンセル料と大きい方を差し引く） -->
									{@const rp = data.refundPreview}
									<li>
										{#if rp.refund <= 0}
											{m.cancel_refund_none()}
										{:else if rp.adminFeePercent != null && rp.reason !== 'prepay_discount'}
											{m.cancel_refund_preview_admin_fee({ paid: formatPrice(rp.paid), fee: formatPrice(rp.fee), adminFee: formatPrice(rp.adminFee), percent: `${rp.adminFeePercent}%`, deducted: formatPrice(rp.deducted), refund: formatPrice(rp.refund) })}
										{:else if rp.discount > 0}
											{m.cancel_refund_preview_discount({ paid: formatPrice(rp.paid), fee: formatPrice(rp.fee), discount: formatPrice(rp.discount), deducted: formatPrice(rp.deducted), refund: formatPrice(rp.refund) })}
										{:else}
											{m.cancel_refund_preview({ paid: formatPrice(rp.paid), fee: formatPrice(rp.fee), refund: formatPrice(rp.refund) })}
										{/if}
									</li>
								{:else if b.payment !== 'onsite'}<li>{m.reservation_cancel_refund_notice()}</li>{/if}
								{#if b.pointsUsed > 0}<li>{m.reservation_cancel_points_notice({ points: String(b.pointsUsed) })}</li>{/if}
								{#if b.pointsEarned > 0}<li>{m.reservation_cancel_earn_notice()}</li>{/if}
							</ul>
							<form method="POST" action="?/cancel" use:enhance class="mt-2 flex gap-2">
								<button type="submit" class="flex-1 rounded-md bg-red-600 py-1.5 text-white hover:bg-red-500">{m.reservation_cancel_confirm_btn()}</button>
								<button type="button" onclick={() => (showCancelConfirm = false)} class="flex-1 rounded-md border border-stone-300 bg-white py-1.5">{m.reservation_back()}</button>
							</form>
						</div>
					{/if}

					<div class="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-500">
						{#if showAmend}
							<p class="mb-2">{m.amend_intro({ n: String(amend.remaining) })}</p>
							<a href={hrefs.amend} class="block w-full rounded-lg border border-brand-300 py-2 text-center font-medium text-brand-800 hover:bg-brand-50">{amend.datesOnly ? m.amend_dates_button() : m.amend_button()}</a>
						{:else}
							<p>
								{m.amend_call_us()}<br />
								{#if facility.phone}<a href="tel:{facility.phone}" class="font-medium text-brand-800">{facility.phone}</a>（{facility.name}）{:else}{facility.name}{/if}
							</p>
						{/if}
					</div>
				{/if}
			</div>

			<!-- 滞在アレンジ（オプション事前予約・現地精算） -->
			<div class="rounded-2xl border border-stone-200 bg-white p-5 text-sm">
				<div class="flex items-center justify-between">
					<h2 class="font-medium text-brand-900">{m.options_heading()}</h2>
					{#if !readOnly}<a href={hrefs.options} class="text-xs font-medium text-accent-600 hover:underline">{m.options_add()}</a>{/if}
				</div>

				{#if options.length === 0}
					<p class="mt-2 text-xs text-stone-400">{m.options_none()}</p>
				{:else}
					<ul class="mt-3 space-y-2">
						{#each options as o (o.orderId)}
							<li class="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
								<div class="flex items-start justify-between gap-2">
									<div class="min-w-0">
										<p class="truncate font-medium text-stone-700">{o.name}</p>
										<p class="mt-0.5 text-xs text-stone-400">
											{categoryLabel(o.category)}
											{#if data.multiRoom && o.roomIndex}・{m.hold_room_n({ n: String(o.roomIndex) })}{/if}
											{#if o.serviceDate}・{formatDate(o.serviceDate)}{/if}
											{#if o.quantity > 1}・{m.options_qty({ n: String(o.quantity) })}{/if}
										</p>
										{#if o.note}<p class="mt-0.5 text-xs text-stone-400">{o.note}</p>{/if}
										{#if o.status === 'needs_reschedule'}
											<p class="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">{m.options_needs_reschedule()}</p>
										{/if}
									</div>
									<span class="shrink-0 text-xs font-medium {o.amount === 0 ? 'text-emerald-700' : 'text-stone-700'}">
										{o.amount === 0 ? m.options_free() : formatPrice(o.amount)}
									</span>
								</div>
								{#if canCancelOption(o)}
									<form method="POST" action="?/cancelOption" use:enhance class="mt-1.5 text-right">
										<input type="hidden" name="orderId" value={o.orderId} />
										<button type="submit" class="text-xs text-red-500 hover:underline">{m.options_cancel()}</button>
									</form>
								{:else if o.status === 'reserved' && !readOnly}
									<p class="mt-1 text-right text-xs text-stone-400">{m.options_cancel_phone()}</p>
								{/if}
							</li>
						{/each}
					</ul>
					<div class="mt-3 flex justify-between border-t border-stone-100 pt-2 text-xs">
						<span class="text-stone-500">{m.options_local_payment()}</span>
						<span class="font-medium text-stone-700">{optionsTotal === 0 ? m.options_free() : formatPrice(optionsTotal)}</span>
					</div>
				{/if}
			</div>
		{/if}

		{#if facility.addressPublic}
			<div class="rounded-2xl bg-stone-100 p-5 text-sm">
				<p class="font-medium text-brand-900">{m.reservation_access()}</p>
				<p class="mt-1 text-xs text-stone-600">{facility.addressPublic}</p>
				{#if facility.lat != null && facility.lng != null}
					<a href="https://www.google.com/maps/dir/?api=1&destination={facility.lat},{facility.lng}" target="_blank" rel="noopener" class="mt-2 inline-block text-xs text-accent-600 underline">{m.reservation_map_link()}</a>
				{/if}
			</div>
		{/if}
	</aside>
</div>

{#if amendments.length > 0}
	<section class="mt-6 rounded-2xl border border-stone-200 bg-white p-6">
		<h2 class="text-sm font-medium text-brand-900">{m.amend_history_heading()}</h2>
		<ul class="mt-3 space-y-2 text-sm">
			{#each [...amendments].reverse() as a (a.amendmentNo)}
				<li class="flex items-center justify-between gap-3 border-b border-stone-100 pb-2 last:border-0">
					<div class="flex items-center gap-2">
						<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{amendKindLabel(a.kind)}</span>
						<span class="text-xs text-stone-400">{formatDate((a.createdAt ?? '').slice(0, 10))}</span>
					</div>
					<div class="text-right">
						<span class="text-xs {a.diffAmount > 0 ? 'text-red-600' : a.diffAmount < 0 ? 'text-emerald-700' : 'text-stone-500'}">
							{a.diffAmount > 0 ? '+' : ''}{formatPrice(a.diffAmount)}
						</span>
						{#if a.pointsRefund > 0}
							<span class="ml-2 text-xs text-emerald-700">{m.amend_refund_points({ points: String(a.pointsRefund) })}</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}
