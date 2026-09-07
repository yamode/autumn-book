<script lang="ts">
	import { formatYen, formatDateLongJa } from '$lib/format';

	let { data, form } = $props();

	let b = $derived(data.detail.booking);
	let g = $derived(data.detail.guest);
	let policy = $derived(data.detail.cancel_policy);

	let showCancel = $state(false);
	let waive = $state(false);
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
{/if}
{#if form?.resent}
	<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		予約確認メールを送信キューに入れました（2分以内に送信されます）。
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
				<div><dt class="text-xs text-stone-400">支払</dt><dd>現地払い</dd></div>
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
								>実行</button
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
