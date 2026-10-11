<script lang="ts">
	import PartnerCancelFeeFields from '$lib/components/admin/PartnerCancelFeeFields.svelte';
	import PartnerAttachments from '$lib/components/PartnerAttachments.svelte';
	import { formatYen, formatDateLongJa } from '$lib/format';
	import { directRefundDueOf } from '$lib/direct-payment';
	import { deductionOf, keptReasonLabel } from '$lib/cancel-admin-fee';
	import {
		canRetryPartnerCharge,
		canStaffCancelPartnerBooking,
		partnerBookingStatusLabel,
		partnerPaymentStatusLabel
	} from '$lib/partner-reservation';
	import { page } from '$app/state';
	import { nightGroups, remainingRefundPreview, roomRefundPreview } from '$lib/multi-room';

	let { data, form } = $props();

	// 会員登録ページ（お客様へ電話で伝える）
	const registerUrl = $derived(`${page.url.origin}/auth/register`);
	let b = $derived(data.detail.booking);
	// 公式の複数室予約の部屋（admin_booking_detail の booking.rooms。1 室・取引先・OTA は空か 1 件）
	let adminRooms = $derived(b.rooms ?? []);
	let g = $derived(data.detail.guest);
	let policy = $derived(data.detail.cancel_policy);

	let showCancel = $state(false);
	let waive = $state(false);
	// 取消の範囲（複数室 M2）: all＝予約全体（残りの全室）／room＝この部屋だけ
	let cancelScope = $state<'all' | 'room'>('all');
	let cancelRoomIndex = $state<number | null>(null);
	// 生きている部屋（取り消していない）
	let liveAdminRooms = $derived(adminRooms.filter((r) => !r.cancelled));
	// 操作できる状態か。2 室以上は「生きている部屋がすべて reserved」のときだけ（DB の全室一括・1 室取消と同じ条件）。
	// 代表の 1 室目が取消済みでも、残りが予約中なら取り消せる
	let canCancelNow = $derived(
		adminRooms.length > 1
			? b.booking_status !== 'cancelled' && liveAdminRooms.length > 0 && liveAdminRooms.every((r) => r.stay_status === 'reserved')
			: b.stay_status === 'reserved'
	);
	/** 生きている部屋ごとの今日のキャンセル料（admin_booking_detail の cancel_policy.rooms[]）。
	 *  生きている部屋が 1 室だけのとき DB は rooms[] を返さず、全体の fee がその部屋の値 */
	function roomFeeOf(index: number): number {
		const hit = (policy.rooms ?? []).find((x) => x.room_index === index);
		if (hit) return hit.fee ?? 0;
		if ((policy.rooms ?? []).length === 0 && liveAdminRooms.length === 1 && liveAdminRooms[0].room_index === index) return policy.fee ?? 0;
		return 0;
	}
	// 事務手数料も免除する（予約時決済で率の残っている予約だけ。既定は差し引く・2026-10-07）
	let adminWaive = $state(false);

	// 取引先予約（source='rms_partner'）の台帳。取引先予約でない・台帳を引けないときは null
	let pl = $derived(data.isPartner ? data.partner.ledger : null);
	let showPartnerCancel = $state(false);

	// 取消前の返金の見込み（オンライン決済済みのとき）。予約時決済の割引額・事務手数料は返金しない:
	// 差し引く額 = max(キャンセル料, 割引額, 事務手数料)。施設都合（キャンセル料免除）は割引額も返す。事務手数料は「事務手数料も免除」のときだけ返す
	// （DB の direct_payment_refund_due と同じ・lib/cancel-admin-fee.ts の deductionOf）
	let adminPercent = $derived(data.payment?.cancel_admin_fee_percent == null ? null : Number(data.payment.cancel_admin_fee_percent));
	let cancelRefund = $derived.by(() => {
		const p = data.payment;
		if (!p || p.status !== 'paid') return null;
		// 複数室（M2）: この部屋だけ／残りの全室は、部屋の支払分から（DB の _room_cancel_kept・direct_payment_refund_due と同じ式）
		if (adminRooms.length > 1 && adminRooms.every((r) => r.paid_share != null)) {
			const terms = { adminFeePercent: adminPercent, adminFeeWaived: adminWaive, waived: waive };
			const shareOf = (r: (typeof adminRooms)[number]) => ({ paidShare: r.paid_share ?? 0, bathTax: r.bath_tax, prepayDiscount: r.prepay_discount });
			const target = cancelScope === 'room' ? liveAdminRooms.find((r) => r.room_index === cancelRoomIndex) : null;
			const rp =
				cancelScope === 'room'
					? target
						? roomRefundPreview(shareOf(target), roomFeeOf(target.room_index), terms)
						: null
					: remainingRefundPreview(
							{ amount: p.amount, refunded: p.refunded_amount, bathTax: p.bath_tax_amount, prepayDiscount: p.prepay_discount_amount ?? 0 },
							liveAdminRooms.map((r) => ({ ...shareOf(r), fee: roomFeeOf(r.room_index) })),
							adminRooms.filter((r) => r.cancelled).map((r) => ({ cancelKept: r.cancel_kept ?? 0 })),
							terms
						);
			if (!rp) return null;
			return { paid: rp.paid, rule: rp.fee, discount: rp.discount, deducted: rp.deducted, kept: rp.kept, refund: rp.refund, adminFee: rp.adminFee, reason: rp.reason };
		}
		const discount = Math.max(0, p.prepay_discount_amount ?? 0);
		const rule = waive ? 0 : Math.max(0, data.feePreview ?? 0);
		const bathTax = Math.max(0, p.bath_tax_amount ?? 0);
		const refund = directRefundDueOf({
			amount: p.amount,
			fee: rule,
			refunded: p.refunded_amount,
			prepayDiscount: discount,
			waived: waive,
			bathTax,
			adminFeePercent: adminPercent,
			adminFeeWaived: adminWaive
		});
		const d = deductionOf({ paid: p.amount, bathTax, fee: rule, discount: waive ? 0 : discount, adminFeePercent: adminPercent, adminFeeWaived: adminWaive });
		const ruleCapped = Math.min(rule, p.amount);
		return { paid: p.amount, rule: ruleCapped, discount, deducted: d.kept, kept: Math.max(0, d.kept - ruleCapped), refund, adminFee: d.adminFee, reason: d.reason };
	});
	/** 送信内容を開いている outbox 行 */
	let openMail = $state<string | null>(null);

	const STAY_STATUS: Record<string, string> = {
		reserved: '予約済',
		checked_in: 'チェックイン済',
		checked_out: '宿泊済',
		stayed: '宿泊済',
		cancelled: 'キャンセル',
		no_show: '不泊'
	};

	const MAIL_KIND: Record<string, string> = {
		booking_confirmation: '予約確認',
		booking_cancelled: 'キャンセル受付',
		booking_room_cancelled: '1室の取消受付'
	};

	const MAIL_STATUS: Record<string, string> = {
		sent: '送信済',
		pending: '送信待ち',
		processing: '送信中',
		failed: '失敗'
	};

	const CANCELLED_BY: Record<string, string> = {
		guest_token: 'お客様（メールのリンク）',
		member: 'お客様（会員）',
		admin: '管理者',
		staff: 'スタッフ'
	};

	function ruleLabel(daysBefore: number): string {
		if (daysBefore < 0) return '不泊';
		if (daysBefore === 0) return '当日';
		return `${daysBefore}日前`;
	}

	function dt(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
	}

	// 支払の表示。オンライン決済（Stripe）の記録があればそれを正とし、無ければ現地払い。
	// 現地払いの内訳（PayPay / カード / 現金）は予約時に備考の先頭へ【現地○○決済希望】で入る（v0.44.0）
	let paymentLabel = $derived.by(() => {
		// 取引先予約は台帳の支払方法・支払状況が正（booking.bookings の payment_status は見ない）
		if (data.isPartner) {
			if (!pl) return { text: '取引先の条件に従う（台帳を確認できません）', prepaid: false };
			const status = partnerPaymentStatusLabel(pl.paymentStatus, pl.cardLabel);
			return { text: `${pl.paymentName ?? '—'}・${status}`, prepaid: pl.paymentStatus === 'paid' };
		}
		const p = data.payment;
		if (p) {
			if (p.status === 'paid') return { text: 'オンライン決済済み（カード）', prepaid: true };
			if (p.status === 'late') return { text: 'オンライン決済：期限後の支払（予約にせず返金）', prepaid: false };
			return { text: 'オンライン決済：支払待ち', prepaid: false };
		}
		if (b.payment_status === 'paid') return { text: '事前決済済み', prepaid: true };
		if (b.source !== 'autumn_booking') return { text: '経路（OTA 等）の条件に従う', prepaid: false };
		const m = /【現地(PayPay|カード|現金)決済希望】/.exec(g.guest_notes ?? '');
		return { text: m ? `現地払い（${m[1]}希望）` : '現地払い', prepaid: false };
	});

	let channelLabel = $derived(
		data.isPartner
			? `取引先予約${pl ? `（${pl.partnerName}）` : ''}`
			: b.source === 'autumn_booking'
			? b.client === 'app'
				? 'アプリ'
				: 'サイト'
			: (b.channel_code ?? b.source ?? '—')
	);

	/** 送信済みの確認メールがあるか（再送で取消リンクが切り替わる旨を出すかの判断） */
	let hasSentConfirmation = $derived(
		data.detail.mails.some((m) => m.kind === 'booking_confirmation' && m.status === 'sent')
	);

	let token = $derived(data.detail.cancel_token);
	let tokenState = $derived(
		!token
			? '未発行'
			: token.revoked_at
				? '無効化済'
				: token.used_at
					? '使用済（取り消しに使われました）'
					: new Date(token.expires_at) < new Date()
						? '期限切れ'
						: `有効（${formatDateLongJa(token.expires_at.slice(0, 10))} まで）`
	);
</script>

<svelte:head><title>{b.code} ｜ 予約管理</title></svelte:head>

<nav class="mb-3 text-xs text-stone-400">
	<a href="/admin/reservations" class="hover:underline">予約管理</a> / {b.code}
</nav>

{#if form?.cancelled || form?.roomCancelled}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		{#if form?.roomCancelled && !form.roomCancelled.bookingCancelled}
			{form.roomCancelled.index}室目だけを取り消しました（この部屋のキャンセル料 {formatYen(form.fee ?? 0)}・監査ログに記録）。お客様に「お部屋のお取り消し」のメールを送信します。予約は残りのお部屋で続きます。
		{:else}
			キャンセル処理を実行しました（キャンセル料 {formatYen(form?.fee ?? 0)}・監査ログに記録）。お客様にキャンセル受付メールを送信します。
		{/if}
	</p>
	{#if form.refund?.kind === 'refunded'}
		<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">オンライン決済の {formatYen(form.refund.amount)} をカードへ返金しました（支払額 {formatYen(form.refund.paid)} − {keptReasonLabel(form.refund.reason, form.refund.adminFeePercent) || 'キャンセル料'} {formatYen(form.refund.fee)}）。PMS に返金行の電文を送りました。</p>
	{:else if form.refund?.kind === 'nothing_due'}
		<p class="mb-3 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">オンライン決済の支払額（{formatYen(form.refund.paid)}）が差し引く額（キャンセル料・返金しない割引額・事務手数料の大きい方 {formatYen(form.refund.fee)}）以下のため、返金はありません。</p>
	{:else if form.refund?.kind === 'failed'}
		<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">取消は完了しましたが、カードへの返金（{formatYen(form.refund.amount)}）に失敗しました: {form.refund.message}。下の「オンライン決済」から返金を再実行してください。</p>
	{/if}
{/if}
{#if form?.refundRetried}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		{form.refund.kind === 'refunded' ? `${formatYen(form.refund.amount)} を返金しました。` : '返金が必要な残りはありません。'}
	</p>
{/if}
{#if form?.resent}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		予約確認メールを送信キューに入れました（2分以内に送信されます）。
	</p>
{/if}
{#if (form as { linked?: { member_code: string; guest_moved: boolean; refinalize: boolean } } | null)?.linked}
	{@const l = (form as { linked: { member_code: string; guest_moved: boolean; refinalize: boolean } }).linked}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		会員 {l.member_code} に紐づけました。{l.guest_moved ? '予約のお客様情報を会員の情報に付け替えました（マイページに表示されます）。' : ''}
		{l.refinalize ? '宿泊済みの予約のため、次の確定処理（毎日 12:00 ごろ）で会員ランクのポイントが付きます。' : 'ご宿泊後に会員ランクのポイントが付きます。'}
	</p>
{/if}
{#if (form as { registered?: { memberCode: string; refinalize: boolean; mailSent: boolean } } | null)?.registered}
	{@const r = (form as { registered: { memberCode: string; refinalize: boolean; mailSent: boolean } }).registered}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		会員登録を代行しました（会員番号 {r.memberCode}）。この予約は会員の予約になりました。
		{r.mailSent ? 'お客様に会員登録のお知らせメールを送りました。' : 'お知らせメールは送れませんでした（メール送信の設定を確認してください）。ログイン方法をお電話でお伝えください。'}
		{r.refinalize ? '宿泊済みのため、次の確定処理（毎日 12:00 ごろ）で会員ランクのポイントが付きます。' : ''}
	</p>
{/if}
{#if form?.rotated}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		取り消しリンクを再発行し、新しいリンク入りの確認メールを送信キューに入れました。古いリンクは無効になりました。
	</p>
{/if}
{#if form?.partnerCancelled}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		取引先予約 {form.partnerCancelled} を取り消しました（PMS へ反映。取引先の設定に従い、予約者・取引先へ取消のお知らせメールを送ります）。{form.partnerPaymentStatus === 'refunded'
			? 'オンライン決済は全額返金しました。'
			: form.partnerPaymentStatus === 'refund_failed'
				? '返金に失敗しました。Stripe で対応してください。'
				: ''}宿泊者へはメールしません。
	</p>
{/if}
{#if form?.partnerCharge}
	<p
		class="mb-3 rounded-lg px-3 py-2 text-sm {form.partnerCharge.status === 'paid'
			? 'bg-emerald-50 text-emerald-800'
			: 'bg-red-50 text-red-700'}"
	>
		{form.partnerCharge.status === 'paid'
			? '登録カードへの請求が完了しました。'
			: form.partnerCharge.status === 'failed'
				? `請求に失敗しました: ${form.partnerCharge.message ?? ''}`
				: `請求しませんでした: ${form.partnerCharge.message ?? ''}`}
	</p>
{/if}
{#if form?.message}
	<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}

<div class="grid gap-4 lg:grid-cols-[1fr_320px]">
	<div class="space-y-4">
		<div class="rounded-xl border border-stone-200 bg-white p-5">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h1 class="text-lg font-bold tracking-wider text-stone-800">{b.code}</h1>
				<span
					class="rounded-full px-3 py-1 text-xs {b.stay_status === 'reserved'
						? 'bg-emerald-50 text-emerald-700'
						: b.stay_status === 'cancelled' || b.stay_status === 'no_show'
							? 'bg-stone-100 text-stone-500'
							: 'bg-blue-50 text-blue-600'}"
				>
					{STAY_STATUS[b.stay_status] ?? b.stay_status}
				</span>
				{#if paymentLabel.prepaid}
					<span class="rounded-full bg-emerald-600 px-3 py-1 text-xs font-medium text-white">事前決済済・現地精算なし</span>
				{/if}
			</div>

			<dl class="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
				<div><dt class="text-xs text-stone-400">施設</dt><dd>{b.facility_name}</dd></div>
				<div>
					<dt class="text-xs text-stone-400">経路</dt>
					<dd>
						{channelLabel}{#if b.source === 'autumn_booking'}（{b.is_member ? '会員' : '非会員'}）{/if}
					</dd>
				</div>
				{#if b.memberPage}
					<!-- 特別会員の専用ページ経由（docs/vip-member-page.md §13.4.5）。部屋ごとの特典は下の部屋の表・1 室なら下の行 -->
					<div class="sm:col-span-2">
						<dt class="text-xs text-stone-400">特別会員</dt>
						<dd>
							<span class="rounded bg-amber-100 px-1.5 text-xs text-amber-800">専用ページ経由</span>
							<a href="/admin/partners/{b.memberPage.partnerId}" class="ml-1 text-accent-600 hover:underline">{b.memberPage.pageName}</a>
							<span class="text-xs text-stone-500">・キャンセル料: {b.memberPage.cancelModeLabel}{b.memberPage.via === 'family' ? '・家族のつながりで予約' : ''}</span>
							{#if adminRooms.length <= 1 && adminRooms[0]?.memberPerks?.length}
								<span class="block text-xs text-amber-800">専用特典: {adminRooms[0].memberPerks.map((p) => p.title).join('／')}</span>
							{/if}
						</dd>
					</div>
				{/if}
				<div>
					<dt class="text-xs text-stone-400">チェックイン</dt>
					<dd>{formatDateLongJa(b.check_in_date)}・{b.nights}泊</dd>
				</div>
				<div>
					<dt class="text-xs text-stone-400">客室 / プラン</dt>
					<dd>{b.room_name ?? pl?.roomName ?? '—'} ／ {b.plan_name ?? (pl?.planName || '—')}</dd>
				</div>
				<div>
					<dt class="text-xs text-stone-400">ゲスト</dt>
					<dd>{g.name ?? '—'}{g.kana ? `（${g.kana}）` : ''} 大人{adminRooms.length > 1 ? adminRooms.reduce((s, r) => s + r.adults, 0) : b.adult_count}名</dd>
				</div>
				<div>
					<dt class="text-xs text-stone-400">連絡先</dt>
					<dd>{g.phone ?? '—'}<br />{g.email ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-xs text-stone-400">到着予定 / 送迎</dt>
					<dd>{g.arrival || '—'} ／ {g.shuttle ? '希望あり' : 'なし'}</dd>
				</div>
				<div>
					<dt class="text-xs text-stone-400">連絡事項</dt>
					<dd class="whitespace-pre-line">{g.guest_notes || '—'}</dd>
				</div>
				<div>
					<dt class="text-xs text-stone-400">金額</dt>
					<dd>
						{b.total_amount != null ? formatYen(b.total_amount) : '—'}
						<span class="text-xs text-stone-500">
							{#if b.discount > 0}／クーポン −{formatYen(b.discount)}{b.coupon_name
									? `「${b.coupon_name}」`
									: ''}{/if}
							{#if b.points_used > 0}／ポイント利用 {b.points_used}pt{/if}
							{#if b.points_earned > 0}／付与予定 {b.points_earned}pt{/if}
						</span>
					</dd>
				</div>
				<div>
					<dt class="text-xs text-stone-400">支払</dt>
					<dd class={paymentLabel.prepaid ? 'font-medium text-emerald-700' : ''}>{paymentLabel.text}</dd>
				</div>
				<div><dt class="text-xs text-stone-400">受付日時</dt><dd>{dt(b.created_at)}</dd></div>
				{#if b.cancelled_at}
					<div>
						<dt class="text-xs text-stone-400">キャンセル</dt>
						<dd>
							{dt(b.cancelled_at)}／{formatYen(b.cancellation_fee ?? 0)}
							{#if b.cancelled_by}（{CANCELLED_BY[b.cancelled_by] ?? b.cancelled_by}）{/if}
						</dd>
					</div>
				{/if}
			</dl>

			{#if adminRooms.length > 1}
				<!-- 公式の複数室予約（M1）: 部屋ごとの表（状態・プラン・部屋・人数・金額・キャンセル料）と料金の明細（泊の見出し → 部屋の行） -->
				<div class="mt-5 border-t border-stone-100 pt-4">
					<h3 class="text-sm font-medium text-stone-700">お部屋（{adminRooms.length}室）</h3>
					<div class="mt-2 overflow-x-auto">
						<table class="w-full min-w-[36rem] text-sm">
							<thead class="text-left text-xs text-stone-400">
								<tr><th class="py-1 pr-2 font-normal">部屋</th><th class="py-1 pr-2 font-normal">滞在コード</th><th class="py-1 pr-2 font-normal">客室 / プラン</th><th class="py-1 pr-2 font-normal">人数</th><th class="py-1 pr-2 text-right font-normal">金額</th><th class="py-1 text-right font-normal">状態</th></tr>
							</thead>
							<tbody class="divide-y divide-stone-100">
								{#each adminRooms as r (r.room_index)}
									<tr class={r.cancelled ? 'text-stone-400' : ''}>
										<td class="py-1.5 pr-2 whitespace-nowrap">{r.room_index}室目</td>
										<td class="py-1.5 pr-2 font-mono text-xs">{r.reservation_code}</td>
										<td class="py-1.5 pr-2">{r.room_name ?? '—'} ／ {r.plan_name ?? '—'}{#if r.memberPerks?.length}<span class="block text-xs text-amber-800">特典: {r.memberPerks.map((p) => p.title).join('／')}</span>{/if}</td>
										<td class="py-1.5 pr-2 whitespace-nowrap">大人{r.adults}名{#if r.male != null && r.female != null}<span class="block text-xs text-stone-500">男性{r.male}・女性{r.female}</span>{/if}</td>
										<td class="py-1.5 pr-2 text-right tabular-nums">{formatYen(r.charge)}{#if r.coupon_share > 0}<span class="block text-xs text-stone-500">クーポン −{formatYen(r.coupon_share)}</span>{/if}</td>
										<td class="py-1.5 text-right text-xs whitespace-nowrap">{r.cancelled ? `取消済み（キャンセル料 ${formatYen(r.cancel_fee ?? 0)}${(r.cancel_kept ?? 0) > 0 ? `・返金しない額 ${formatYen(r.cancel_kept ?? 0)}` : ''}）` : (STAY_STATUS[r.stay_status] ?? r.stay_status)}{#if !r.cancelled && r.paid_share != null && data.payment?.status === 'paid'}<span class="block text-stone-500">支払分 {formatYen(r.paid_share)}</span>{/if}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					<div class="mt-3 space-y-1 text-xs text-stone-600">
						{#each nightGroups(adminRooms.map((r) => ({ lines: (r.price_lines ?? []).map((l) => ({ date: l.date, unitPrice: l.unit_price, adults: l.adults, subtotal: l.subtotal })) }))) as ng (ng.date)}
							<p class="font-medium text-stone-500">{ng.night}泊目: {formatDateLongJa(ng.date)}</p>
							{#each ng.rows as row (row.room)}
								<p class="flex justify-between pl-3"><span>{row.room + 1}室目　1名様 {formatYen(row.unitPrice)} × {row.adults}名様</span><span class="tabular-nums">{formatYen(row.subtotal)}</span></p>
							{/each}
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if data.isPartner}
			<!-- 取引先予約（限定URL /p/<token> から入った予約）の台帳。取消・再請求は右の「取引先予約の操作」から -->
			<div class="rounded-xl border border-amber-200 bg-amber-50/40 p-5 text-sm">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<h2 class="flex flex-wrap items-center gap-2 font-medium text-stone-700">
						取引先予約
						{#if pl?.billedToPartner}
							<!-- 取引先払い（2026-10-02 指示）: 宿泊料金・入湯税は取引先へ月末に請求。お客様には請求しない -->
							<span class="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-bold text-red-700">取引先へ請求（お客様には請求しない）</span>
						{/if}
					</h2>
					{#if pl?.partnerId}
						<a href={`/admin/partners/${pl.partnerId}`} class="text-xs text-accent-600 hover:underline">取引先の管理画面で見る →</a>
					{/if}
				</div>
				{#if !pl}
					<p class="mt-2 text-xs text-amber-800">{data.partner.error ?? '取引先予約の台帳を読み込めませんでした。'}</p>
				{:else}
					<dl class="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-stone-700">
						<dt class="text-stone-500">取引先</dt>
						<dd>{pl.partnerName}</dd>
						<dt class="text-stone-500">予約番号</dt>
						<dd class="font-mono">{pl.bookingCode}{#if pl.roomCount > 1}<span class="ml-1 font-sans text-xs text-stone-500">（{pl.roomCount}室・この画面は {b.code} の1室分）</span>{/if}</dd>
						<dt class="text-stone-500">状態</dt>
						<dd>{partnerBookingStatusLabel(pl.status, pl.checkedIn)}{#if pl.cancelledAt}<span class="text-xs text-stone-500">（{dt(pl.cancelledAt)}・{pl.cancelledBy === 'staff' ? '宿' : pl.cancelledBy === 'system' ? '自動' : '取引先'}）</span>{/if}{#if pl.cancelFee}<span class="block text-xs text-stone-700">キャンセル料 {pl.cancelFee.fee > 0 ? `${pl.cancelFee.fee.toLocaleString('ja-JP')}円（${pl.cancelFee.basis}・不課税）${pl.cancelFee.settlement ? ` ${pl.cancelFee.settlement}` : ''}` : `なし${pl.cancelFee.waived ? '（免除）' : ''}`}{#if pl.cancelFee.kept}<span class="block text-stone-600">{pl.cancelFee.kept}</span>{/if}{#if pl.cancelFee.note}<span class="text-stone-500">・{pl.cancelFee.note}</span>{/if}{#if pl.cancelFee.status === 'charge_failed'}<span class="block text-rose-700">カードへの請求に失敗したため請求書へ回しました{pl.cancelFee.error ? `（${pl.cancelFee.error}）` : ''}</span>{/if}</span>{/if}</dd>
						<dt class="text-stone-500">予約したログインID</dt>
						<dd class="font-mono text-xs">{pl.bookedBy ?? '—'}</dd>
						<dt class="text-stone-500">予約者</dt>
						<dd>{pl.booker ?? '—'}</dd>
						<dt class="text-stone-500">交通手段</dt>
						<dd>{pl.transport ?? '—'}</dd>
						<dt class="text-stone-500">取引先特典</dt>
						<dd>
							{#if pl.perks.length}
								{#each pl.perks as perk (perk.title)}
									<span class="block">{perk.title}{#if perk.description}<span class="text-xs text-stone-500">（{perk.description}）</span>{/if}</span>
								{/each}
							{:else}—{/if}
						</dd>
						<dt class="text-stone-500">部屋・プラン</dt>
						<dd>{pl.roomName} × {pl.roomCount}室・大人{pl.adultTotal}名／{pl.planName || '—'}</dd>
						<dt class="text-stone-500">支払方法</dt>
						<dd>
							{pl.paymentName ?? '—'}
							{#if pl.depositText}<span class="block text-xs font-medium text-amber-800">{pl.depositText}</span>{/if}
							{#if pl.billedToPartner}<span class="block text-xs font-medium text-red-700">{pl.depositText ? '残額' : '宿泊料金・入湯税'}は {pl.partnerName} 様へ月末に請求します（お客様には請求しない）</span>{/if}
						</dd>
						<dt class="text-stone-500">支払状況</dt>
						<dd class={pl.paymentStatus === 'charge_failed' || pl.paymentStatus === 'refund_failed' ? 'text-red-700' : ''}>
							{partnerPaymentStatusLabel(pl.paymentStatus, pl.cardLabel)}
							{#if pl.paidAt}<span class="text-xs text-stone-500">（{dt(pl.paidAt)}{pl.paidAmount != null ? `・${formatYen(pl.paidAmount)}` : ''}）</span>{/if}
							{#if pl.chargeError}<span class="block text-xs text-red-700">{pl.chargeError}</span>{/if}
							{#if pl.refundError}<span class="block text-xs text-red-700">{pl.refundError}</span>{/if}
						</dd>
						<dt class="text-stone-500">請求額</dt>
						<dd>
							{formatYen(pl.chargeAmount)}
							<span class="text-xs text-stone-500">（宿泊料金 {formatYen(pl.lodging)}{pl.bathTax > 0 ? `・入湯税 ${formatYen(pl.bathTax)}` : ''}{pl.prepayDiscount > 0 ? `・予約時決済割引 −${formatYen(pl.prepayDiscount)}` : ''}）</span>
						</dd>
						{#if pl.guestEmail}
							<dt class="text-stone-500">宿泊者のメール</dt>
							<dd>{pl.guestEmail}<span class="block text-xs text-stone-500">取引先予約の確認・取消メールは予約者（取引先）宛てで、宿泊者へは送りません。</span></dd>
						{/if}
						<dt class="text-stone-500">受付日時</dt>
						<dd>{dt(pl.createdAt)}</dd>
					</dl>
					{#if pl.attachments}
						<!-- 添付ファイル（2026-10-07）: 取引先ページで付けたもの＋スタッフが付けたもの。PMS の予約詳細にも同じファイルが出る（取込後・数分以内） -->
						<div class="mt-3 border-t border-stone-200 pt-3">
							<p class="mb-1 text-sm font-medium text-stone-700">添付ファイル（{pl.attachments.items.length}件）</p>
							<p class="mb-2 text-xs text-stone-500">PMS の予約詳細にも同じファイルが出ます（取込後・数分以内）。PMS からは削除できないので、削除はここで行ってください。</p>
							<PartnerAttachments
								items={pl.attachments.items}
								uploadUrl={pl.attachments.canAdd ? `/admin/reservations/${encodeURIComponent(b.code)}/attachments` : null}
								notifyUrl={`/admin/reservations/${encodeURIComponent(b.code)}/attachments/notify`}
								accept={pl.attachments.accept}
								hint={pl.attachments.hint}
								note={pl.attachments.note}
								notifiedText="PMS へは数分以内に反映されます。"
							/>
						</div>
					{/if}
				{/if}
			</div>
		{/if}

		<!-- 非会員の予約を会員に紐づける（「会員になりたい」という電話への対応） -->
		{#if data.live && data.isDirect && !data.isPartner && b.source === 'autumn_booking' && !b.is_member && b.booking_status !== 'cancelled'}
			{@const mf = form as {
				memberScope?: boolean;
				memberQuery?: string;
				memberError?: string;
				candidates?: { user_id: string; member_code: string; name: string | null; kana: string | null; email: string | null; phone: string | null; guest_id: string | null }[];
			} | null}
			<div class="rounded-xl border border-sky-200 bg-sky-50/40 p-5 text-sm">
				<h2 class="font-medium text-stone-700">会員登録を代行する（非会員の予約）</h2>
				<p class="mt-1 text-xs leading-relaxed text-stone-500">
					「非会員で予約したが会員になりたい」というお電話のときに、施設側で会員登録をします。予約のお客様情報で会員になり、
					この予約は会員の予約になります（マイページに表示・入会ボーナス（会員の画面で設定）・ご宿泊後に会員ポイント）。
					パスワードはありません。お客様はこのメールアドレスでログインし、届く確認コードで入れます（登録のお知らせメールを送ります）。
				</p>
				{#if mf?.memberScope && mf.memberError}<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{mf.memberError}</p>{/if}
				<form
					method="POST"
					action="?/registerMember"
					class="mt-3 space-y-2"
					onsubmit={(e) => {
						if (!confirm(`${g.name ?? 'お客様'} 様を会員に登録し、予約 ${b.code} を会員の予約にします。よろしいですか？`)) e.preventDefault();
					}}
				>
					<div class="flex flex-wrap items-center gap-2">
						<span class="w-24 text-xs text-stone-500">お名前</span>
						<span>{g.name ?? '（未登録）'}{g.kana ? `（${g.kana}）` : ''}</span>
					</div>
					<label class="flex flex-wrap items-center gap-2">
						<span class="w-24 text-xs text-stone-500">メールアドレス</span>
						<input name="email" type="email" required value={g.email ?? ''} class="w-72 rounded-md border border-stone-300 px-2 py-1.5" />
						<span class="text-xs text-stone-400">ログインに使います。お電話で確認してください</span>
					</label>
					<label class="flex items-center gap-2 text-xs text-stone-600">
						<input type="checkbox" name="mailOptIn" checked class="h-4 w-4" />
						お知らせメール（メルマガ）の受け取りにも同意いただいた
					</label>
					<label class="flex items-center gap-2 text-xs font-medium text-stone-700">
						<input type="checkbox" name="consent" required class="h-4 w-4" />
						会員登録（会員規約・プライバシーポリシー）についてお客様の同意を得た
					</label>
					<button class="rounded-md bg-sky-700 px-4 py-1.5 text-xs text-white hover:bg-sky-800">会員登録を代行する</button>
				</form>

				<details class="mt-4 rounded-lg border border-stone-200 bg-white p-3" open={!!mf?.candidates}>
					<summary class="cursor-pointer text-xs font-medium text-stone-600">すでに会員の方の場合（会員に紐づける）</summary>
				<p class="mt-2 text-xs leading-relaxed text-stone-500">
					お客様がすでに会員（別のメールアドレスで登録済みなど）のときは、会員番号（YM-）・メールアドレス・電話番号で探して、この予約を紐づけます。
					お客様ご自身で登録していただく場合の登録ページ: <span class="select-all font-mono">{registerUrl}</span>
				</p>
				<form method="POST" action="?/findMember" class="mt-3 flex flex-wrap items-center gap-2">
					<input
						name="q"
						value={mf?.memberQuery ?? g.email ?? ''}
						placeholder="YM-001234 / メールアドレス / 電話番号"
						class="w-72 rounded-md border border-stone-300 px-2 py-1.5"
					/>
					<button class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs hover:bg-stone-50">会員を探す</button>
				</form>
				{#if mf?.candidates}
					{#if mf.candidates.length === 0}
						<p class="mt-2 text-xs text-stone-500">見つかりませんでした。会員登録が済んでいるか、入力を確かめてください。</p>
					{:else}
						<ul class="mt-3 space-y-2">
							{#each mf.candidates as c (c.user_id)}
								<li class="rounded-lg border border-stone-200 bg-white p-3">
									<div class="flex flex-wrap items-baseline gap-x-3">
										<span class="font-medium">{c.name ?? '（氏名未登録）'}</span>
										<span class="font-mono text-xs text-stone-500">{c.member_code}</span>
										<span class="text-xs text-stone-500">{c.email ?? ''}{c.phone ? `・${c.phone}` : ''}</span>
									</div>
									<form method="POST" action="?/linkMember" class="mt-2 flex flex-wrap items-center gap-3 text-xs">
										<input type="hidden" name="memberUserId" value={c.user_id} />
										<label class="flex items-center gap-1.5 text-stone-600">
											<input type="checkbox" name="moveGuest" checked class="h-4 w-4" />
											予約のお客様情報をこの会員の情報に付け替える（マイページに表示するため）
										</label>
										<button
											class="rounded-md bg-sky-700 px-3 py-1.5 text-white hover:bg-sky-800"
											onclick={(e) => {
												if (!confirm(`予約 ${b.code} を会員 ${c.member_code}（${c.name ?? ''}）に紐づけます。よろしいですか？`)) e.preventDefault();
											}}>この会員に紐づける</button
										>
									</form>
								</li>
							{/each}
						</ul>
					{/if}
				{/if}
				</details>
			</div>
		{/if}

		<!-- キャンセル規定（取引先予約は取引先の設定に従うので出さない） -->
		{#if !data.isPartner}
		<div class="rounded-xl border border-stone-200 bg-white p-5 text-sm">
			<h2 class="font-medium text-stone-700">
				キャンセル規定{policy.rules_source === 'rank' ? '（当館の基本規定）' : '（プラン規定）'}
			</h2>
			{#if policy.rules?.length}
				<p class="mt-1 text-stone-600">
					{[...policy.rules]
						.sort((a, c) => c.days_before - a.days_before)
						.map((r) => `${ruleLabel(r.days_before)} ${Math.round(r.rate * 100)}%`)
						.join(' / ')}
				</p>
			{:else}
				<p class="mt-1 text-amber-600">規定が未設定です（キャンセル料 0 円になります）。</p>
			{/if}
			{#if data.feePreview !== null}
				<p class="mt-2 text-stone-700">
					本日時点のキャンセル料 <span class="font-bold">{formatYen(data.feePreview)}</span>
					{#if policy.rate}（{Math.round((policy.rate ?? 0) * 100)}%）{/if}
				</p>
			{/if}
		</div>
		{/if}

		{#if data.payment}
			<!-- オンライン決済（公式サイト予約・Stripe）。取消時は「支払額 − キャンセル料」を自動で返金する -->
			{@const p = data.payment}
			<div class="rounded-xl border border-stone-200 bg-white p-5 text-sm">
				<h2 class="font-medium text-stone-700">オンライン決済（Stripe）</h2>
				<dl class="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-stone-700">
					<dt class="text-stone-500">状態</dt>
					<dd>{p.status === 'paid' ? '支払済み' : p.status === 'late' ? '期限後の支払（予約にせず返金）' : '支払待ち'}{#if p.refund_status === 'full'}・全額返金済み{:else if p.refund_status === 'partial'}・一部返金済み{:else if p.refund_status === 'failed'}<span class="text-red-700">・返金失敗</span>{/if}</dd>
					<dt class="text-stone-500">支払額</dt>
					<dd>{formatYen(p.amount)}（宿泊料金 {formatYen(p.lodging_amount)}{(p.prepay_discount_amount ?? 0) > 0 ? `・予約時決済割引 −${formatYen(p.prepay_discount_amount ?? 0)}` : ''}{p.bath_tax_amount > 0 ? `・入湯税 ${formatYen(p.bath_tax_amount)}` : ''}{p.points_used > 0 ? `・ポイント ${p.points_used.toLocaleString()}pt 利用後` : ''}）</dd>
					{#if p.refunded_amount > 0}<dt class="text-stone-500">返金済み</dt><dd>{formatYen(p.refunded_amount)}</dd>{/if}
					{#if data.refundDue}
						<!-- 取消後: 支払額から差し引いた額（規定のキャンセル料と、返金しない予約時決済の割引額の大きい方） -->
						<dt class="text-stone-500">差し引いた額</dt>
						<dd>
							{formatYen(data.refundDue.fee)}{#if data.refundDue.cancellationFee != null}（規定のキャンセル料 {formatYen(data.refundDue.cancellationFee)}）{/if}
						</dd>
						{#if data.refundDue.kept > 0 && data.refundDue.reason === 'admin_fee'}
							<dt class="text-stone-500">事務手数料</dt>
							<dd>{formatYen(data.refundDue.adminFee)}（お支払額の {data.refundDue.adminFeePercent}%・キャンセル料より大きいため差し引き）</dd>
						{:else if data.refundDue.kept > 0}
							<dt class="text-stone-500">返金しない割引額</dt>
							<dd>{formatYen(data.refundDue.kept)}（予約時決済の割引 {formatYen(data.refundDue.prepayDiscount)} のうち、キャンセル料を超える分）</dd>
						{/if}
						{#if data.refundDue.adminFeeWaived}<dt class="text-stone-500">事務手数料</dt><dd>免除</dd>{/if}
						{#if data.refundDue.due > 0}<dt class="text-stone-500">返金の残り</dt><dd>{formatYen(data.refundDue.due)}</dd>{/if}
					{/if}
					{#if p.paid_at}<dt class="text-stone-500">支払日時</dt><dd>{new Date(p.paid_at).toLocaleString('ja-JP')}</dd>{/if}
					{#if p.payment_intent_id}<dt class="text-stone-500">Stripe</dt><dd class="break-all font-mono text-xs">{p.payment_intent_id}</dd>{/if}
					{#if p.refund_error}<dt class="text-stone-500">返金エラー</dt><dd class="text-red-700">{p.refund_error}</dd>{/if}
				</dl>
				{#if data.canOperate && p.status === 'paid' && (b.booking_status === 'cancelled' || adminRooms.some((r) => r.cancelled)) && p.refund_status !== 'full'}
					<form method="POST" action="?/retryRefund" class="mt-3">
						<button type="submit" class="rounded-md border border-stone-300 px-3 py-1.5 text-sm">返金を再実行する（支払額 − 差し引く額 の残り）</button>
					</form>
				{/if}
			</div>
		{/if}

		{#if data.live}
			<!-- メール（取引先予約は予約者＝取引先宛てに別経路で送るので、book のメール履歴は出さない） -->
			{#if !data.isPartner}
			<div class="rounded-xl border border-stone-200 bg-white p-5 text-sm">
				<h2 class="font-medium text-stone-700">メール</h2>
				{#if data.detail.mails.length === 0}
					<p class="mt-2 text-stone-400">送信履歴はありません。</p>
				{:else}
					<ul class="mt-2 space-y-1.5">
						{#each data.detail.mails as mail (mail.id)}
							<li class="flex flex-wrap items-center gap-2">
								<span class="text-stone-500">{dt(mail.sent_at ?? mail.created_at)}</span>
								<span>{MAIL_KIND[mail.kind] ?? mail.kind}</span>
								<span
									class={mail.status === 'sent'
										? 'text-emerald-600'
										: mail.status === 'failed'
											? 'text-red-600'
											: 'text-amber-600'}
								>
									{MAIL_STATUS[mail.status] ?? mail.status}{mail.attempts > 1
										? `（${mail.attempts}回目）`
										: ''}
								</span>
								<span class="text-xs text-stone-400">{mail.to_email}</span>
								{#if mail.last_error}<span class="text-xs text-red-500">{mail.last_error}</span>{/if}
								{#if data.canOperate && mail.body_text}
									<button
										type="button"
										class="text-xs text-accent-600 hover:underline"
										onclick={() => (openMail = openMail === mail.id ? null : mail.id)}
										>{openMail === mail.id ? '閉じる' : '送信内容を見る'}</button
									>
								{/if}
							</li>
							{#if openMail === mail.id}
								<li class="rounded-lg bg-stone-50 p-3">
									<p class="font-medium text-stone-700">{mail.subject}</p>
									<pre class="mt-2 whitespace-pre-wrap text-xs text-stone-600">{mail.body_text}</pre>
								</li>
							{/if}
						{/each}
					</ul>
				{/if}
			</div>
			{/if}

			{#if data.isDirect}
				<!-- 取り消しリンク -->
				<div class="rounded-xl border border-stone-200 bg-white p-5 text-sm">
					<h2 class="font-medium text-stone-700">取り消しリンク（お客様用）</h2>
					<p class="mt-1 text-stone-600">
						{tokenState}{#if token}・最終閲覧 {dt(token.last_seen_at)}・閲覧 {token.view_count} 回{/if}
					</p>
					<p class="mt-1 text-xs text-stone-400">
						リンクの URL は保存していません（推測できない値のハッシュだけを保持しています）。
					</p>
				</div>
			{/if}

			<!-- 変更・監査 -->
			<div class="rounded-xl border border-stone-200 bg-white p-5 text-sm">
				<h2 class="font-medium text-stone-700">変更履歴・操作ログ</h2>
				<p class="mt-1 text-stone-600">予約変更 {b.amendments} 件</p>
				{#if data.detail.audits.length > 0}
					<ul class="mt-2 space-y-1 text-xs text-stone-500">
						{#each data.detail.audits as a (a.at)}
							<li>{dt(a.at)} {a.action}</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	</div>

	<!-- 操作 -->
	<div class="space-y-3">
		{#if data.isPartner}
			<!-- 取引先予約: book 側の操作（取消・メール再送・取消リンク）は出さない。取消は取引先予約として行う -->
			<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<h2 class="font-medium text-stone-700">取引先予約の操作</h2>
				<p class="mt-1 text-xs leading-relaxed text-stone-500">
					取引先ページ（限定URL）からのご予約です。予約確認・取消のメールは予約者（取引先）宛てで、宿泊者へは送りません。
				</p>
				{#if !pl}
					<p class="mt-2 text-xs text-stone-500">台帳を確認できないため操作できません。</p>
				{:else if !data.canOperate}
					<p class="mt-2 text-xs text-stone-500">取消・再請求は管理者のみ行えます（スタッフは閲覧のみ）。</p>
				{:else}
					{#if canRetryPartnerCharge(pl, data.today)}
						<form method="POST" action="?/partnerRetryCharge" class="mt-3">
							<button type="submit" class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
								>{pl.paymentStatus === 'charge_failed' ? '登録カードへ再請求する' : '登録カードへ今すぐ請求する'}（{formatYen(pl.chargeAmount)}）</button
							>
						</form>
					{/if}
					{#if canStaffCancelPartnerBooking(pl)}
						{#if !showPartnerCancel}
							<button
								type="button"
								class="mt-4 w-full rounded-md bg-red-600 px-3 py-2 text-sm text-white"
								onclick={() => (showPartnerCancel = true)}>取引先予約を取り消す</button
							>
						{:else}
							<form method="POST" action="?/partnerCancel" class="mt-4 space-y-2 rounded-lg bg-amber-50 p-3">
								<!-- 取り違え防止: どの予約を取り消すのかを確定前に必ず見せる -->
								<div class="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
									<p class="text-xs text-stone-500">この取引先予約を取り消します</p>
									<p class="font-medium text-stone-800">{pl.partnerName}・<span class="font-mono">{pl.bookingCode}</span></p>
									<p class="text-xs text-stone-600">
										{g.name ?? '—'} 様・{formatDateLongJa(pl.checkIn)} から {pl.nights}泊・{pl.roomName} × {pl.roomCount}室
									</p>
									{#if pl.roomCount > 1}
										<p class="mt-1 text-xs text-amber-700">複数室の予約です。{pl.roomCount}室すべてが取り消されます。</p>
									{/if}
								</div>
								<PartnerCancelFeeFields preview={pl.cancelPreview} paid={pl.paymentStatus === 'paid'} card={pl.hasCard} invoiceMonth={pl.invoiceMonth} />
								{#if pl.paymentStatus === 'paid'}
									<label class="flex items-start gap-2 text-sm">
										<input type="checkbox" name="refund" checked class="mt-1" />
										<span>オンライン決済を返金する（{formatYen(pl.paidAmount ?? pl.chargeAmount)} からキャンセル料を差し引く。免除なら全額）</span>
									</label>
								{/if}
								<input
									name="reason"
									required
									maxlength="500"
									placeholder="理由（必須・取引先の台帳に記録）"
									class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
								/>
								<p class="text-xs text-stone-500">
									PMS に取消を反映し、取引先（予約者・ログインID・連絡先）へ取消のお知らせメールを送ります。キャンセル料は支払方法に応じて、月末の請求書・登録カード・予約時決済からの差し引きで精算します。
								</p>
								<div class="flex gap-2">
									<button
										type="button"
										class="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm"
										onclick={() => (showPartnerCancel = false)}>戻る</button
									>
									<button type="submit" class="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm text-white"
										>取り消す</button
									>
								</div>
							</form>
						{/if}
					{:else if pl.status === 'confirmed' && pl.checkedIn}
						<p class="mt-2 text-xs text-stone-500">チェックイン済みのため取り消せません。</p>
					{/if}
				{/if}
			</div>
		{:else if !data.isDirect}
			<p class="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
				OTA・電話経由のご予約です。取り消しは OTA 側で行ってください（PMS へ反映されます）。
			</p>
		{:else if data.canOperate && canCancelNow}
			<div class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="text-sm font-medium text-stone-700">操作</h2>

				{#if data.live}
					<form method="POST" action="?/resend" class="mt-3">
						<button type="submit" class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
							>予約確認メールを再送する</button
						>
						{#if hasSentConfirmation}
							<p class="mt-1 text-xs text-stone-500">
								送信済みのメールを再送すると、取り消しリンクは新しいものに切り替わります（古いリンクは無効になります）。
							</p>
						{/if}
					</form>

					<form method="POST" action="?/rotateToken" class="mt-2">
						<button type="submit" class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
							>取り消しリンクを無効化して再発行</button
						>
						<p class="mt-1 text-xs text-stone-500">
							リンクの漏洩が疑われるときに使います。新しいリンク入りの確認メールを送ります。
						</p>
					</form>
				{/if}

				{#if !showCancel}
					<button
						type="button"
						class="mt-4 w-full rounded-md bg-red-600 px-3 py-2 text-sm text-white"
						onclick={() => (showCancel = true)}>キャンセル処理</button
					>
				{:else}
					<form method="POST" action="?/cancel" class="mt-4 space-y-2 rounded-lg bg-amber-50 p-3">
						{#if liveAdminRooms.length > 1}
							<!-- 複数室（M2）: 予約全体か、この部屋だけか -->
							<fieldset class="space-y-1 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
								<legend class="px-1 text-xs text-stone-500">取り消す範囲</legend>
								<label class="flex items-center gap-2">
									<input type="radio" name="scope" value="all" bind:group={cancelScope} />
									<span>予約全体（残りの {liveAdminRooms.length} 室すべて）</span>
								</label>
								<label class="flex items-center gap-2">
									<input type="radio" name="scope" value="room" bind:group={cancelScope} />
									<span>この部屋だけ</span>
								</label>
								{#if cancelScope === 'room'}
									<select name="roomIndex" bind:value={cancelRoomIndex} required class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm">
										<option value={null} disabled>お部屋を選んでください</option>
										{#each liveAdminRooms as r (r.room_index)}
											<option value={r.room_index}>{r.room_index}室目・{r.room_name ?? '—'}／{r.plan_name ?? '—'}・大人{r.adults}名（{r.reservation_code}）</option>
										{/each}
									</select>
								{/if}
							</fieldset>
						{/if}
						<!-- 取り違え防止: どの予約を取り消すのかを確定前に必ず見せる -->
						<div class="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
							<p class="text-xs text-stone-500">この予約をキャンセルします</p>
							<p class="font-medium text-stone-800">{g.name ?? '—'} 様・<span class="font-mono">{b.code}</span></p>
							<p class="text-xs text-stone-600">
								{formatDateLongJa(b.check_in_date)} から {b.nights}泊・大人{b.adult_count}名・{b.room_name ?? '—'}
							</p>
							{#if cancelRefund}
								<p class="mt-1 text-xs text-emerald-700">
									オンライン決済済み：支払額 {formatYen(cancelRefund.paid)} から {formatYen(cancelRefund.deducted)} を差し引いた {formatYen(cancelRefund.refund)} を自動で返金します。
									{#if cancelRefund.deducted > 0}
										（差し引く額: {keptReasonLabel(cancelRefund.reason, adminPercent)}。キャンセル料 {formatYen(cancelRefund.rule)}{cancelRefund.discount > 0 && !waive ? `・返金しない予約時決済の割引額 ${formatYen(cancelRefund.discount)}` : ''}{adminPercent != null ? `・事務手数料 ${formatYen(cancelRefund.adminFee)}${adminWaive ? '（免除）' : ''}` : ''} のうち大きい方）
									{:else}
										（全額返金）
									{/if}
								</p>
							{/if}
						</div>
						<label class="flex items-start gap-2 text-sm">
							<input type="checkbox" name="waive" bind:checked={waive} class="mt-1" />
							<span>施設都合（キャンセル料を免除する）</span>
						</label>
						{#if cancelRefund && adminPercent != null}
							<label class="flex items-start gap-2 text-sm">
								<input type="checkbox" name="adminFeeWaive" bind:checked={adminWaive} class="mt-1" />
								<span>事務手数料（予約時決済の取消で返金しない {adminPercent}%）も免除する</span>
							</label>
						{/if}
						<p class="text-sm text-stone-700">
							適用キャンセル料：{waive ? formatYen(0) : formatYen(cancelScope === 'room' && cancelRoomIndex != null ? roomFeeOf(cancelRoomIndex) : (data.feePreview ?? 0))}
						</p>
						<input
							name="reason"
							required
							placeholder="理由（必須・監査ログに記録）"
							class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
						/>
						<p class="text-xs text-stone-500">
							お客様へキャンセル受付メールを自動送信します（理由は載りません）。
						</p>
						<div class="flex gap-2">
							<button
								type="button"
								class="flex-1 rounded-md border border-stone-300 px-3 py-2 text-sm"
								onclick={() => (showCancel = false)}>戻る</button
							>
							<button type="submit" class="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm text-white"
								>{cancelScope === 'room' ? 'この部屋だけキャンセルする' : 'この予約をキャンセルする'}</button
							>
						</div>
					</form>
				{/if}
			</div>
		{:else if !data.canOperate}
			<p class="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
				スタッフ権限では閲覧のみ可能です。キャンセル等の操作・連絡先の表示は管理者にご依頼ください。
			</p>
		{/if}

		<p class="text-xs text-stone-400">※ 部屋割り・チェックイン操作は PMS で行ってください。</p>
	</div>
</div>
