<script lang="ts">
	import { formatYen, formatDateLongJa } from '$lib/format';
	import { directRefundDueOf } from '$lib/direct-payment';
	import { page } from '$app/state';

	let { data, form } = $props();

	// 会員登録ページ（お客様へ電話で伝える）
	const registerUrl = $derived(`${page.url.origin}/auth/register`);
	let b = $derived(data.detail.booking);
	let g = $derived(data.detail.guest);
	let policy = $derived(data.detail.cancel_policy);

	let showCancel = $state(false);
	let waive = $state(false);

	// 取消前の返金の見込み（オンライン決済済みのとき）。予約時決済の割引額は返金しない:
	// 差し引く額 = max(キャンセル料, 割引額)。施設都合（キャンセル料免除）は全額返金（DB の direct_payment_refund_due と同じ）
	let cancelRefund = $derived.by(() => {
		const p = data.payment;
		if (!p || p.status !== 'paid') return null;
		const discount = Math.max(0, p.prepay_discount_amount ?? 0);
		const rule = waive ? 0 : Math.max(0, data.feePreview ?? 0);
		const bathTax = Math.max(0, p.bath_tax_amount ?? 0);
		const refund = directRefundDueOf({ amount: p.amount, fee: rule, refunded: p.refunded_amount, prepayDiscount: discount, waived: waive, bathTax });
		const ruleCapped = Math.min(rule, p.amount);
		// 返金しない割引額は入湯税を除いた支払額まで（入湯税は必ず返す）
		const deducted = waive ? ruleCapped : Math.max(ruleCapped, Math.min(discount, Math.max(p.amount - bathTax, 0)));
		return { paid: p.amount, rule: ruleCapped, discount, deducted, kept: Math.max(0, deducted - ruleCapped), refund };
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
		booking_cancelled: 'キャンセル受付'
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
		b.source === 'autumn_booking'
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

{#if form?.cancelled}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		キャンセル処理を実行しました（キャンセル料 {formatYen(form.fee ?? 0)}・監査ログに記録）。お客様にキャンセル受付メールを送信します。
	</p>
	{#if form.refund?.kind === 'refunded'}
		<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">オンライン決済の {formatYen(form.refund.amount)} をカードへ返金しました（支払額 {formatYen(form.refund.paid)} − {form.refund.kept > 0 ? '返金しない予約時決済の割引額' : 'キャンセル料'} {formatYen(form.refund.fee)}）。PMS に返金行の電文を送りました。</p>
	{:else if form.refund?.kind === 'nothing_due'}
		<p class="mb-3 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">オンライン決済の支払額（{formatYen(form.refund.paid)}）が差し引く額（キャンセル料・返金しない割引額の大きい方 {formatYen(form.refund.fee)}）以下のため、返金はありません。</p>
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
{#if form?.rotated}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		取り消しリンクを再発行し、新しいリンク入りの確認メールを送信キューに入れました。古いリンクは無効になりました。
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
				<div>
					<dt class="text-xs text-stone-400">チェックイン</dt>
					<dd>{formatDateLongJa(b.check_in_date)}・{b.nights}泊</dd>
				</div>
				<div>
					<dt class="text-xs text-stone-400">客室 / プラン</dt>
					<dd>{b.room_name ?? '—'} ／ {b.plan_name ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-xs text-stone-400">ゲスト</dt>
					<dd>{g.name ?? '—'}{g.kana ? `（${g.kana}）` : ''} 大人{b.adult_count}名</dd>
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
		</div>

		<!-- 非会員の予約を会員に紐づける（「会員になりたい」という電話への対応） -->
		{#if data.live && data.isDirect && b.source === 'autumn_booking' && !b.is_member && b.booking_status !== 'cancelled'}
			{@const mf = form as {
				memberScope?: boolean;
				memberQuery?: string;
				memberError?: string;
				candidates?: { user_id: string; member_code: string; name: string | null; kana: string | null; email: string | null; phone: string | null; guest_id: string | null }[];
			} | null}
			<div class="rounded-xl border border-sky-200 bg-sky-50/40 p-5 text-sm">
				<h2 class="font-medium text-stone-700">会員に紐づける（非会員の予約）</h2>
				<p class="mt-1 text-xs leading-relaxed text-stone-500">
					「非会員で予約したが会員になりたい」というお問い合わせのときに使います。まずお客様に会員登録をしていただき
					（登録ページ: <span class="select-all font-mono">{registerUrl}</span>）、登録後の会員番号（YM-）・メールアドレス・電話番号で探して紐づけます。
					紐づけると、この予約が会員のマイページに表示され、ご宿泊後に会員ランクのポイントが付きます（宿泊済みの予約は次の確定処理で付与）。
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
				{#if mf?.memberScope && mf.memberError}<p class="mt-2 text-xs text-red-600">{mf.memberError}</p>{/if}
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
			</div>
		{/if}

		<!-- キャンセル規定 -->
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
						{#if data.refundDue.kept > 0}
							<dt class="text-stone-500">返金しない割引額</dt>
							<dd>{formatYen(data.refundDue.kept)}（予約時決済の割引 {formatYen(data.refundDue.prepayDiscount)} のうち、キャンセル料を超える分）</dd>
						{/if}
						{#if data.refundDue.due > 0}<dt class="text-stone-500">返金の残り</dt><dd>{formatYen(data.refundDue.due)}</dd>{/if}
					{/if}
					{#if p.paid_at}<dt class="text-stone-500">支払日時</dt><dd>{new Date(p.paid_at).toLocaleString('ja-JP')}</dd>{/if}
					{#if p.payment_intent_id}<dt class="text-stone-500">Stripe</dt><dd class="break-all font-mono text-xs">{p.payment_intent_id}</dd>{/if}
					{#if p.refund_error}<dt class="text-stone-500">返金エラー</dt><dd class="text-red-700">{p.refund_error}</dd>{/if}
				</dl>
				{#if data.canOperate && p.status === 'paid' && b.booking_status === 'cancelled' && p.refund_status !== 'full'}
					<form method="POST" action="?/retryRefund" class="mt-3">
						<button type="submit" class="rounded-md border border-stone-300 px-3 py-1.5 text-sm">返金を再実行する（支払額 − 差し引く額 の残り）</button>
					</form>
				{/if}
			</div>
		{/if}

		{#if data.live}
			<!-- メール -->
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
		{#if !data.isDirect}
			<p class="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-600">
				OTA・電話経由のご予約です。取り消しは OTA 側で行ってください（PMS へ反映されます）。
			</p>
		{:else if data.canOperate && b.stay_status === 'reserved'}
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
									{#if waive}
										（施設都合のため、予約時決済の割引も含めて全額返金）
									{:else if cancelRefund.discount > 0}
										（キャンセル料 {formatYen(cancelRefund.rule)} と、返金しない予約時決済の割引額 {formatYen(cancelRefund.discount)} の大きい方）
									{/if}
								</p>
							{/if}
						</div>
						<label class="flex items-start gap-2 text-sm">
							<input type="checkbox" name="waive" bind:checked={waive} class="mt-1" />
							<span>施設都合（キャンセル料を免除する）</span>
						</label>
						<p class="text-sm text-stone-700">
							適用キャンセル料：{waive ? formatYen(0) : formatYen(data.feePreview ?? 0)}
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
								>この予約をキャンセルする</button
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
