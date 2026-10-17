<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { askConfirm } from '$lib/components/admin/confirm-dialog.svelte';

	import ConfirmPanel from '$lib/components/admin/ConfirmPanel.svelte';
	import CouponFields from '$lib/components/admin/CouponFields.svelte';
	import Unavailable from '$lib/components/admin/Unavailable.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import type { MemberCouponRow } from '$lib/server/admin-app-data';

	let { data, form } = $props();

	const isAdmin = $derived(data.user?.role === 'admin');
	const coupon = $derived(data.coupon);
	// 1件でも配布したら割引条件は凍結する
	const frozen = $derived(
		!!coupon && coupon.issued + coupon.used + coupon.revoked + coupon.expired > 0
	);

	const RANKS = ['standard', 'silver', 'gold', 'platinum'];
	const STATUS_LABEL: Record<string, string> = {
		issued: '配布済',
		used: '使用済',
		revoked: '取消',
		expired: '期限切れ'
	};

	// 状態のバッジの色（配布済=青・使用済=緑・取消/期限切れ=灰）
	const STATUS_TONE: Record<string, string> = {
		issued: 'bg-sky-50 text-sky-700',
		used: 'bg-emerald-50 text-emerald-700',
		revoked: 'bg-stone-100 text-stone-500',
		expired: 'bg-stone-100 text-stone-500'
	};

	let mode = $state('all');
	let confirmingIssue = $state(false);
	let confirmingDeactivate = $state(false);
	let statusFilter = $state('all');

	// countTargets の結果（配布ボタンはこれが無いと押せない）
	const counted = $derived(form?.counted ?? null);

	const dt = (s: string | null) =>
		s
			? new Date(s).toLocaleString('ja-JP', {
					month: 'numeric',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
			: '—';

	const visibleList = $derived(
		(data.issuedList ?? []).filter(
			(r: MemberCouponRow) => statusFilter === 'all' || r.status === statusFilter
		)
	);
</script>

<svelte:head><title>{coupon?.name ?? 'クーポン'} ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-xs text-stone-500"><a href="/admin/coupons" class="hover:underline">← クーポン一覧</a></p>

{#if data.unavailable}
	<Unavailable authMode={data.authMode} dataSource={data.dataSource} />
{:else if !coupon}
	<div class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
		{data.error ?? 'クーポンが見つかりません。'}
	</div>
{:else}
	<PageHeader title={coupon.name}>
		{#snippet actions()}
			{#if coupon.is_active}
				<span class="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs text-emerald-700">有効</span>
			{:else}
				<span class="rounded-full bg-stone-100 px-2.5 py-0.5 text-xs text-stone-500">無効</span>
			{/if}
		{/snippet}
	</PageHeader>

	{#if form?.message}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{form.message}
		</div>
	{/if}
	{#if form?.saved}
		<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
			保存しました。
		</div>
	{/if}
	{#if form?.issued != null}
		<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
			{form.issued} 名に配布しました。会員のアプリに通知が届きます。
		</div>
	{/if}
	{#if form?.revoked != null}
		<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
			{form.revoked} 件の配布を取り消しました。
		</div>
	{/if}

	<!-- 割引条件 -->
	<form
		method="POST"
		action="?/save"
		use:enhance
		class="max-w-3xl rounded-xl border border-stone-200 bg-white p-4"
	>
		<CouponFields {coupon} facilities={data.facilities ?? []} {frozen} disabled={!isAdmin} />
		{#if isAdmin}
			<button type="submit" class="mt-5 min-h-10 rounded-lg bg-brand-800 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700">
				保存
			</button>
		{/if}
	</form>

	<!-- 配布状況 -->
	<h2 class="mt-6 mb-2 text-sm font-bold text-stone-700">配布状況</h2>
	<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
		配布 {coupon.issued} ／ 使用 {coupon.used} ／ 取消 {coupon.revoked} ／ 期限切れ {coupon.expired}
		{#if coupon.issued + coupon.used > 0}
			　使用率 {Math.round((coupon.used / (coupon.issued + coupon.used)) * 100)}%
		{/if}
		{#if coupon.last_used_at}　最終使用 {dt(coupon.last_used_at)}{/if}
	</div>

	{#if isAdmin}
		<!-- 配布 -->
		<h2 class="mt-6 mb-2 text-sm font-bold text-stone-700">配布する</h2>
		<div class="max-w-3xl rounded-xl border border-stone-200 bg-white p-4">
			<form method="POST" action="?/countTargets" use:enhance>
				<div class="space-y-2 text-sm">
					<label class="flex items-center gap-2">
						<input type="radio" name="mode" value="all" bind:group={mode} /> 全会員
					</label>
					<label class="flex items-center gap-2">
						<input type="radio" name="mode" value="rank" bind:group={mode} /> ランク指定
					</label>
					{#if mode === 'rank'}
						<div class="ml-6 flex flex-wrap gap-3">
							{#each RANKS as r}
								<label class="flex items-center gap-1 text-sm">
									<input type="checkbox" name="ranks" value={r} />
									{r}
								</label>
							{/each}
						</div>
					{/if}
					<label class="flex items-center gap-2">
						<input type="radio" name="mode" value="stayed" bind:group={mode} /> 宿泊実績
					</label>
					{#if mode === 'stayed'}
						<div class="ml-6 flex flex-wrap items-center gap-2 text-sm">
							<select name="stayedFacility" class="rounded-md border border-stone-300 px-2 py-1.5">
								<option value="">すべての施設</option>
								{#each data.facilities ?? [] as f}
									<option value={f.id}>{f.name}</option>
								{/each}
							</select>
							<input type="date" name="stayedFrom" class="rounded-md border border-stone-300 px-2 py-1.5" />
							<span class="text-stone-400">〜</span>
							<input type="date" name="stayedUntil" class="rounded-md border border-stone-300 px-2 py-1.5" />
						</div>
					{/if}
					<label class="flex items-center gap-2">
						<input type="radio" name="mode" value="search" bind:group={mode} /> 氏名・会員番号で検索
					</label>
					{#if mode === 'search'}
						<div class="ml-6">
							<input
								name="q"
								placeholder="山田 / YM-000123"
								class="w-64 max-w-full rounded-md border border-stone-300 px-2 py-1.5 text-sm"
							/>
						</div>
					{/if}
				</div>

				<button
					type="submit"
					class="mt-3 min-h-10 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
				>
					対象を数える
				</button>
			</form>

			{#if counted}
				<div class="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
					<p class="font-medium text-stone-800">
						対象 {counted.total} 名（うち既に配布済み {counted.already} 名 → 新規配布
						{counted.ids.length} 名）
					</p>
					{#if counted.preview.length > 0}
						<p class="mt-1 text-xs text-stone-500">
							{counted.preview.map((p) => `${p.name ?? '（氏名なし）'} ${p.memberCode ?? ''}`).join(' ／ ')}
							{counted.ids.length > counted.preview.length ? ' …' : ''}
						</p>
					{/if}

					{#if counted.ids.length === 0}
						<p class="mt-2 text-xs text-amber-700">配布できる会員がいません。</p>
					{:else if !confirmingIssue}
						<button
							type="button"
							onclick={() => (confirmingIssue = true)}
							class="mt-3 min-h-10 rounded-lg bg-accent-600 px-4 py-2 text-sm font-medium text-white hover:bg-accent-500"
						>
							{counted.ids.length} 名に配布する
						</button>
					{:else}
						<form method="POST" action="?/issue" use:enhance class="mt-3">
							<input type="hidden" name="targetIds" value={JSON.stringify(counted.ids)} />
							<ConfirmPanel
								message={`この操作は取り消せません。${counted.ids.length} 名に配布し、アプリ通知「クーポンが届きました」を送ります。`}
								requireCount={counted.ids.length >= 50 ? counted.ids.length : null}
								confirmLabel="配布を実行する"
								submit
								oncancel={() => (confirmingIssue = false)}
							/>
						</form>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- 配布先一覧 -->
	<h2 class="mt-6 mb-2 text-sm font-bold text-stone-700">
		配布先一覧（{(data.issuedList ?? []).length} 件）
	</h2>
	<label class="mb-2 block text-sm text-stone-600">
		状態:
		<select bind:value={statusFilter} class="rounded-md border border-stone-300 px-2 py-1.5 text-sm">
			<option value="all">すべて</option>
			<option value="issued">配布済</option>
			<option value="used">使用済</option>
			<option value="revoked">取消</option>
		</select>
	</label>

	{#if visibleList.length === 0}
		<p class="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
			{(data.issuedList ?? []).length === 0
				? 'まだ誰にも配布していません。上の「配布する」から対象を選びます。'
				: 'この状態の配布はありません。'}
		</p>
	{:else}
		{#snippet revokeForm(r: MemberCouponRow)}
			<form
				method="POST"
				action="?/revoke"
				use:enhance={async ({ cancel }) => {
					if (!(await askConfirm({ message: `${r.member_code ?? ''} ${r.member_name ?? ''} さんへの配布を取り消します。会員のアプリから消えます。よろしいですか？`, confirmLabel: '配布を取り消す' }))) cancel();
				}}
			>
				<input type="hidden" name="memberUserId" value={r.member_user_id} />
				<button type="submit" class="py-1 text-xs text-red-700 underline">配布を取り消す</button>
			</form>
		{/snippet}
		<!-- スマホ: カード状の並び（md 以上は表） -->
		<ul class="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white md:hidden">
			{#each visibleList as r (r.id)}
				<li class="px-4 py-3 text-sm">
					<div class="flex items-start justify-between gap-2">
						<span class="min-w-0 font-medium text-stone-800">{r.member_name ?? '—'}</span>
						<span class="shrink-0 rounded-full px-2 py-0.5 text-xs {STATUS_TONE[r.status] ?? 'bg-stone-100 text-stone-600'}">{STATUS_LABEL[r.status] ?? r.status}</span>
					</div>
					<p class="mt-0.5 text-xs text-stone-500"><span class="font-mono">{r.member_code ?? '—'}</span>・{r.rank_code ?? '—'}</p>
					<p class="mt-0.5 text-xs text-stone-500">
						配布 {dt(r.issued_at)}{#if r.used_at}・使用 {dt(r.used_at)}{/if}{#if r.booking_code}・<span class="font-mono">{r.booking_code}</span>{/if}
					</p>
					{#if isAdmin && r.status === 'issued'}<div class="mt-1">{@render revokeForm(r)}</div>{/if}
				</li>
			{/each}
		</ul>
		<div class="hidden overflow-x-auto rounded-xl border border-stone-200 bg-white md:block">
			<table class="w-full min-w-[760px] text-sm">
				<thead class="bg-stone-50 text-xs text-stone-500">
					<tr>
						<th class="px-3 py-2 text-left">会員番号</th>
						<th class="px-3 py-2 text-left">氏名</th>
						<th class="px-3 py-2 text-left">ランク</th>
						<th class="px-3 py-2 text-left">状態</th>
						<th class="px-3 py-2 text-left">配布日</th>
						<th class="px-3 py-2 text-left">使用日</th>
						<th class="px-3 py-2 text-left">予約番号</th>
						<th class="px-3 py-2"></th>
					</tr>
				</thead>
				<tbody>
					{#each visibleList as r (r.id)}
						<tr class="border-t border-stone-100">
							<td class="px-3 py-2 font-mono text-xs text-stone-600">{r.member_code ?? '—'}</td>
							<td class="px-3 py-2 text-stone-800">{r.member_name ?? '—'}</td>
							<td class="px-3 py-2 text-stone-500">{r.rank_code ?? '—'}</td>
							<td class="px-3 py-2"><span class="rounded-full px-2 py-0.5 text-xs {STATUS_TONE[r.status] ?? 'bg-stone-100 text-stone-600'}">{STATUS_LABEL[r.status] ?? r.status}</span></td>
							<td class="px-3 py-2 text-xs text-stone-500">{dt(r.issued_at)}</td>
							<td class="px-3 py-2 text-xs text-stone-500">{dt(r.used_at)}</td>
							<td class="px-3 py-2 font-mono text-xs text-stone-500">{r.booking_code ?? '—'}</td>
							<td class="px-3 py-2 text-right">
								{#if isAdmin && r.status === 'issued'}{@render revokeForm(r)}{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- 危険な操作 -->
	{#if isAdmin}
		<h2 class="mt-8 mb-2 text-sm font-bold text-red-800">危険な操作</h2>
		<div class="max-w-3xl rounded-xl border border-red-200 bg-white p-4">
			{#if coupon.is_active}
				{#if !confirmingDeactivate}
					<button
						type="button"
						onclick={() => (confirmingDeactivate = true)}
						class="min-h-10 rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
					>
						このクーポンを無効化する
					</button>
					<p class="mt-2 text-xs text-stone-500">
						会員のアプリで「ご利用可能」から消えます（配布データは残ります）。
					</p>
				{:else}
					<form method="POST" action="?/setActive" use:enhance>
						<input type="hidden" name="active" value="false" />
						<ConfirmPanel
							message={`配布済み ${coupon.issued} 名の会員がこのクーポンを使えなくなります。`}
							confirmLabel="無効化する"
							submit
							oncancel={() => (confirmingDeactivate = false)}
						/>
					</form>
				{/if}
			{:else}
				<form method="POST" action="?/setActive" use:enhance>
					<input type="hidden" name="active" value="true" />
					<button
						type="submit"
						class="min-h-10 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
					>
						再び有効にする
					</button>
				</form>
			{/if}
		</div>
	{/if}
{/if}
