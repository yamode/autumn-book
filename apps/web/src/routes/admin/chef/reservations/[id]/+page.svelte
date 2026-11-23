<script lang="ts">
	import { enhance } from '$lib/enhance';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { CHEF_AREA_LABEL, CHEF_PAYMENT_LABEL, CHEF_PAY_DEADLINE_MESSAGE, CHEF_STATUS_LABEL, CHEF_STYLE_LABEL, chefDateLabel, chefPayDeadline, chefIsStale, chefPartyLabel, chefTimeLabel, yen } from '$lib/chef';

	let { data, form } = $props();

	const EVENT_LABEL: Record<string, string> = {
		requested: '仮予約の受付',
		checkout_created: '決済画面を作成（お客さま）',
		paid: 'オンライン決済の完了',
		paid_amount_mismatch: '決済の金額が合わない通知（要確認）',
		paid_in_wrong_state: '確定前・取消後の決済通知（要確認）',
		double_payment: '二重決済の通知（要確認・返金してください）',
		confirm: '確定',
		decline: 'お断り',
		cancel: '取消',
		onsite_paid: '現地で受領',
		to_onsite: '現地払いに切り替え',
		note: '社内メモの保存'
	};
	const at = (s: string | null) => (s ? new Date(s).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
	const failed = (action: string) => form && !('ok' in form) && 'action' in form && form.action === action;
</script>

<svelte:head><title>出張シェフ・予約詳細 ｜ 山人管理</title></svelte:head>

{#if data.unavailable || !data.item}
	<PageHeader title="出張シェフ・予約詳細" />
	<p class="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{data.unavailable}</p>
{:else}
	{@const r = data.item}
	<PageHeader title="{r.name} 様　{chefDateLabel(r.date)}" facility="出張シェフ">
		{#snippet actions()}
			<a href="/admin/chef/reservations" class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-50">← 予約一覧</a>
		{/snippet}
	</PageHeader>

	{#if form?.message}
		<p class="mb-3 rounded-lg px-3 py-2 text-sm {'ok' in form ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}">{form.message}</p>
	{/if}
	{#if form && 'warning' in form && form.warning}<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm whitespace-pre-line text-amber-800">{form.warning}</p>{/if}

	<div class="mb-4 flex flex-wrap items-center gap-2 text-sm">
		<span class="rounded bg-stone-800 px-2 py-0.5 text-white">{CHEF_STATUS_LABEL[r.status] ?? r.status}</span>
		{#if chefIsStale(r.status, r.created_at)}<span class="rounded bg-red-100 px-2 py-0.5 text-red-700">仮予約のまま3日以上たっています</span>{/if}
		<span class="text-stone-500">受付 {at(r.created_at)}</span>
		{#if data.chefName}<span class="text-stone-500">シェフ：{data.chefName}</span>{/if}
	</div>

	<div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
		<div class="space-y-4">
			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="mb-2 text-sm font-medium text-stone-800">ご予約の内容</h2>
				<dl class="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
					<dt class="text-stone-500">ご利用日時</dt><dd>{chefDateLabel(r.date)} {chefTimeLabel(r.start_time)}〜</dd>
					<dt class="text-stone-500">形式</dt><dd>{CHEF_STYLE_LABEL[r.style] ?? r.style}</dd>
					<dt class="text-stone-500">人数</dt><dd>{chefPartyLabel(r)}</dd>
					<dt class="text-stone-500">地域</dt><dd>{CHEF_AREA_LABEL[r.area] ?? r.area}</dd>
					<dt class="text-stone-500">訪問先の住所</dt><dd class="whitespace-pre-wrap">{r.address}</dd>
					<dt class="text-stone-500">コンロの口数</dt><dd>{r.stove || '—'}</dd>
					<dt class="text-stone-500">アレルギー</dt><dd class="whitespace-pre-wrap {r.allergies ? 'font-medium text-red-700' : ''}">{r.allergies || 'なし'}</dd>
					<dt class="text-stone-500">利用シーン</dt><dd>{r.purpose || '—'}</dd>
					<dt class="text-stone-500">そのほか</dt><dd class="whitespace-pre-wrap">{r.notes || '—'}</dd>
				</dl>
			</section>

			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="mb-2 text-sm font-medium text-stone-800">お客さま</h2>
				<dl class="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
					<dt class="text-stone-500">お名前</dt><dd>{r.name}{#if r.kana}<span class="ml-2 text-stone-500">（{r.kana}）</span>{/if}</dd>
					<dt class="text-stone-500">メール</dt><dd class="break-all"><a href="mailto:{r.email}" class="underline">{r.email}</a></dd>
					<dt class="text-stone-500">電話</dt><dd><a href="tel:{r.tel}" class="underline">{r.tel}</a></dd>
				</dl>
			</section>

			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="mb-2 text-sm font-medium text-stone-800">金額</h2>
				<dl class="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
					<dt class="text-stone-500">料理代（税抜）</dt><dd>{yen(r.subtotal)}{#if r.minimum_applied}<span class="ml-2 text-xs text-stone-500">最低料金 20,000円 を適用</span>{/if}</dd>
					<dt class="text-stone-500">出張費（税抜）</dt><dd>{yen(r.travel_fee)}</dd>
					<dt class="text-stone-500">税抜合計</dt><dd>{yen(r.amount_ex_tax)}</dd>
					<dt class="text-stone-500">消費税</dt><dd>{yen(r.tax)}</dd>
					<dt class="text-stone-500">税込合計</dt><dd class="font-medium">{yen(r.amount_total)}</dd>
					<dt class="text-stone-500">お支払い方法</dt><dd>{CHEF_PAYMENT_LABEL[r.payment_method] ?? r.payment_method}{#if r.payment_method === 'online'}<span class="ml-2 text-xs text-stone-500">期限 {chefDateLabel(chefPayDeadline(r.date))}</span>{/if}</dd>
					{#if r.paid_at}<dt class="text-stone-500">受領日時</dt><dd>{at(r.paid_at)}</dd>{/if}
					{#if r.stripe_payment_intent}<dt class="text-stone-500">Stripe</dt><dd class="break-all text-xs text-stone-500">{r.stripe_payment_intent}</dd>{/if}
					{#if r.confirmed_at}<dt class="text-stone-500">確定日時</dt><dd>{at(r.confirmed_at)}</dd>{/if}
					{#if r.declined_reason}<dt class="text-stone-500">{r.status === 'cancelled' ? '取消の理由' : 'お断りの理由'}</dt><dd class="whitespace-pre-wrap">{r.declined_reason}</dd>{/if}
					{#if r.cancel_fee !== null}<dt class="text-stone-500">キャンセル料</dt><dd>{yen(r.cancel_fee)}</dd>{/if}
				</dl>
			</section>

			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="mb-2 text-sm font-medium text-stone-800">操作の記録</h2>
				{#if data.events.length === 0}
					<p class="text-sm text-stone-500">記録はありません。</p>
				{:else}
					<ul class="space-y-1.5 text-sm">
						{#each data.events as ev (ev.id)}
							<li class="flex flex-wrap gap-x-3">
								<span class="text-xs whitespace-nowrap text-stone-500">{at(ev.created_at)}</span>
								<span>{EVENT_LABEL[ev.action] ?? ev.action}</span>
								<span class="text-xs text-stone-500">{ev.actor_id ? 'スタッフ' : 'お客さま・システム'}</span>
								{#if ev.detail?.reason}<span class="text-xs text-stone-600">理由：{ev.detail.reason}</span>{/if}
								{#if ev.detail?.cancel_fee != null}<span class="text-xs text-stone-600">キャンセル料：{yen(Number(ev.detail.cancel_fee))}</span>{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		</div>

		<div class="space-y-4">
			{#if r.status === 'requested'}
				<section class="rounded-xl border border-stone-200 bg-white p-4">
					<h2 class="mb-1 text-sm font-medium text-stone-800">確定</h2>
					<p class="mb-3 text-xs text-stone-500">
						{r.payment_method === 'online' ? 'お客さまに支払いのリンク（期限：利用日の3日前）入りの確定メールを送ります。' : 'お客さまに当日現地でお支払いいただく旨の確定メールを送ります。'}
					</p>
					{#if data.payDeadlinePassed}
						<p class="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{CHEF_PAY_DEADLINE_MESSAGE}</p>
					{/if}
					<form method="POST" use:enhance={({ cancel }) => { if (!confirm('この予約を確定し、お客さまにメールを送ります。よろしいですか？')) cancel(); }}>
						<input type="hidden" name="action" value="confirm" />
						<input type="hidden" name="revision" value={r.revision} />
						<button
							disabled={data.payDeadlinePassed}
							title={data.payDeadlinePassed ? CHEF_PAY_DEADLINE_MESSAGE : ''}
							class="w-full rounded-md bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-stone-300"
						>確定してメールを送る</button>
					</form>
				</section>
				<section class="rounded-xl border border-stone-200 bg-white p-4">
					<h2 class="mb-1 text-sm font-medium text-stone-800">お断り</h2>
					<p class="mb-2 text-xs text-stone-500">理由はお客さまへのメールに入ります。枠はまた空きます。</p>
					<form method="POST" use:enhance class="space-y-2">
						<input type="hidden" name="action" value="decline" />
						<input type="hidden" name="revision" value={r.revision} />
						<textarea name="reason" required maxlength="1000" rows="3" class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" placeholder="理由（必須）" value={failed('decline') && form && 'reason' in form ? String(form.reason ?? '') : ''}></textarea>
						<button class="w-full rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">お断りしてメールを送る</button>
					</form>
				</section>
			{/if}

			{#if (r.status === 'requested' || r.status === 'confirmed') && r.payment_method === 'online'}
				<section class="rounded-xl border border-stone-200 bg-white p-4">
					<h2 class="mb-1 text-sm font-medium text-stone-800">現地払いに切り替え</h2>
					<p class="mb-3 text-xs text-stone-500">
						{r.status === 'confirmed'
							? 'オンライン決済をやめ、当日現地でお支払いいただく形にします。お客さまの決済画面を閉じ、「お支払いは当日現地で」とメールを送ります。'
							: 'オンライン決済をやめ、当日現地でお支払いいただく形にします（メールは送りません。確定のメールで現地払いとお伝えします）。'}
					</p>
					<form
						method="POST"
						use:enhance={({ cancel }) => {
							const msg = r.status === 'confirmed'
								? 'お支払い方法を当日現地払いに切り替え、お客さまにメールを送ります。よろしいですか？'
								: 'お支払い方法を当日現地払いに切り替えます。よろしいですか？';
							if (!confirm(msg)) cancel();
						}}
					>
						<input type="hidden" name="action" value="to_onsite" />
						<input type="hidden" name="revision" value={r.revision} />
						<button class="w-full rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">現地払いに切り替える</button>
					</form>
				</section>
			{/if}

			{#if r.status === 'confirmed' && r.payment_method === 'onsite'}
				<section class="rounded-xl border border-stone-200 bg-white p-4">
					<h2 class="mb-1 text-sm font-medium text-stone-800">現地で受領</h2>
					<p class="mb-3 text-xs text-stone-500">当日、シェフが {yen(r.amount_total)} を受け取ったら記録します。</p>
					<form method="POST" use:enhance={({ cancel }) => { if (!confirm(`${yen(r.amount_total)} を現地で受け取ったことを記録します。よろしいですか？`)) cancel(); }}>
						<input type="hidden" name="action" value="onsite_paid" />
						<input type="hidden" name="revision" value={r.revision} />
						<button class="w-full rounded-md bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700">受領を記録する</button>
					</form>
				</section>
			{/if}

			{#if (r.status === 'confirmed' || r.status === 'paid') && data.cancelGuide}
				{@const g = data.cancelGuide}
				<section class="rounded-xl border border-stone-200 bg-white p-4">
					<h2 class="mb-1 text-sm font-medium text-stone-800">取消</h2>
					<p class="mb-2 text-xs text-stone-500">
						目安：利用日まで{g.daysBefore >= 0 ? `あと${g.daysBefore}日` : `${-g.daysBefore}日過ぎ`}のため {Math.round(g.rate * 100)}%（5日前まで0%・4〜2日前25%・前日50%・当日100%）。
						{#if r.status === 'paid' && r.payment_method === 'online'}オンライン決済の返金は Stripe で別に行ってください。{:else if r.status === 'confirmed' && r.stripe_session_id}お客さまの決済画面は取消と同時に閉じます。{/if}
					</p>
					<form method="POST" use:enhance class="space-y-2">
						<input type="hidden" name="action" value="cancel" />
						<input type="hidden" name="revision" value={r.revision} />
						<textarea name="reason" required maxlength="1000" rows="3" class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" placeholder="理由（必須）" value={failed('cancel') && form && 'reason' in form ? String(form.reason ?? '') : ''}></textarea>
						<label class="flex items-center gap-2 text-sm">
							<span class="text-stone-600">キャンセル料</span>
							<input name="cancel_fee" type="number" min="0" max={r.amount_total} step="1" required value={g.fee} class="w-32 rounded-md border border-stone-300 px-2 py-1.5 text-right" />
							<span class="text-stone-600">円</span>
						</label>
						<button class="w-full rounded-md border border-red-300 px-4 py-2 text-sm text-red-700 hover:bg-red-50">取り消してメールを送る</button>
					</form>
				</section>
			{/if}

			<section class="rounded-xl border border-stone-200 bg-white p-4">
				<h2 class="mb-1 text-sm font-medium text-stone-800">社内メモ</h2>
				<p class="mb-2 text-xs text-stone-500">お客さまには見えません。</p>
				<form method="POST" use:enhance class="space-y-2">
					<input type="hidden" name="action" value="note" />
					<input type="hidden" name="revision" value={r.revision} />
					<textarea name="staff_note" maxlength="2000" rows="5" class="w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm" value={r.staff_note}></textarea>
					<button class="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">保存</button>
				</form>
			</section>
		</div>
	</div>
{/if}
