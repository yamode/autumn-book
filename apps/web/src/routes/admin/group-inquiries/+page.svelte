<script lang="ts">
	// 管理画面: 団体照会の一覧（全取引先・docs/partner-group-booking.md §8.3・§14.4）。
	// 束（取引先が一括送信したまとまり）ごとに1枚のカード。束に対して「全件を受けられるにする」（自動計算額で一括回答）。
	// 料金を変える回答・受付枠超過の承認は詳細（./[id]）で管理者が行う。
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';
	import { describeGroupStay, describeRoomAdults, type GroupInquiryStatus } from '$lib/partner-group';
	import type { PageData } from './$types';

	type FormResult = { batchAnswered?: number; skipped?: { inquiryCode: string; reason: string }[]; mailed?: number; message?: string } | null | undefined;
	let { data, form }: { data: PageData; form?: FormResult } = $props();

	type Row = PageData['inquiries'][number];
	const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
	const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'short', timeStyle: 'short' }) : '—');

	const STATUS_FILTERS: { value: string; label: string }[] = [
		{ value: 'open', label: '回答待ち＋回答済み（既定）' },
		{ value: 'submitted', label: '新着（回答待ち）' },
		{ value: 'offered', label: '回答済み・承諾待ち' },
		{ value: 'accepted', label: '予約確定' },
		{ value: 'declined,rejected,withdrawn,expired', label: '終了（受けられない・辞退・取り下げ・期限切れ）' },
		{ value: 'all', label: 'すべて' }
	];
	const statusTone = (s: GroupInquiryStatus) =>
		s === 'submitted'
			? 'bg-amber-500 text-white'
			: s === 'offered'
				? 'bg-sky-100 text-sky-800'
				: s === 'accepted'
					? 'bg-emerald-100 text-emerald-800'
					: 'bg-stone-200 text-stone-600';
	const amountOf = (r: Row) => {
		const lodging = r.answer_total ?? r.quote_total;
		if (lodging == null) return null;
		return { total: lodging + ((r.answer_total != null ? r.answer_bath_tax : r.quote_bath_tax) ?? 0), answered: r.answer_total != null };
	};
	// 束の一括回答の対象（回答待ちで自動計算できた件）
	const batchTargets = (items: Row[]) => items.filter((r) => r.status === 'submitted' && r.quote_status === 'ok' && r.quote_rooms);
	let openBatch = $state<string | null>(null);
	let busyBatch = $state<string | null>(null);
	const filtered = $derived(page.url.search.length > 0);
</script>

<svelte:head><title>団体照会 ｜ 山人管理</title></svelte:head>

<div class="mb-4">
	<h1 class="mb-1 text-lg font-bold text-stone-800">団体照会</h1>
	<p class="max-w-3xl text-xs text-stone-500">
		旅行会社が取引先ページの「団体予約」から送った照会です。可否（必要なら料金）を回答すると取引先へメールが届き、取引先が承諾するとご予約（PMS へ取り込み）になります。
		照会・回答の段階では在庫を押さえません（承諾の時点で残室を確かめます）。
	</p>
</div>

{#if data.error}
	<p class="mb-4 rounded-lg px-3 py-2 text-sm {data.live ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}">{data.error}</p>
{/if}
{#if form?.batchAnswered}
	<div class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
		✓ {form.batchAnswered} 件を「受けられる」で回答しました。{#if (form.mailed ?? 0) >= form.batchAnswered}取引先へメールでお知らせしました。{:else if form.mailed}うち {form.mailed} 件は取引先へメールでお知らせしました（ほかはメールを送っていません・通知オフ・宛先なし等）。{:else}メールは送っていません（通知オフ・宛先なし等）。{/if}
		{#if form.skipped?.length}<span class="block text-xs text-stone-600">回答しなかった件: {form.skipped.map((s) => `${s.inquiryCode}（${s.reason}）`).join('、')}</span>{/if}
	</div>
{:else if form?.message}
	<div class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
		{form.message}
		{#if form.skipped?.length}<span class="block text-xs">{form.skipped.map((s) => `${s.inquiryCode}（${s.reason}）`).join('、')}</span>{/if}
	</div>
{/if}

<!-- 絞り込み（GET） -->
<form method="GET" class="mb-4 grid gap-2 rounded-xl border border-stone-200 bg-white p-3 text-sm sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto_auto]">
	<label class="block">
		<span class="mb-0.5 block text-xs text-stone-500">状態</span>
		<select name="status" value={data.filters.status} class="w-full rounded-md border border-stone-300 px-2 py-1.5">
			{#each STATUS_FILTERS as s (s.value)}<option value={s.value}>{s.label}</option>{/each}
		</select>
	</label>
	<label class="block">
		<span class="mb-0.5 block text-xs text-stone-500">施設</span>
		<select name="fac" value={data.filters.fac} class="w-full rounded-md border border-stone-300 px-2 py-1.5">
			<option value="">すべて</option>
			{#each data.facilities as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
		</select>
	</label>
	<label class="block">
		<span class="mb-0.5 block text-xs text-stone-500">取引先</span>
		<select name="partner" value={data.filters.partner} class="w-full rounded-md border border-stone-300 px-2 py-1.5">
			<option value="">すべて</option>
			{#each data.partners as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
		</select>
	</label>
	<label class="block">
		<span class="mb-0.5 block text-xs text-stone-500">チェックイン（から）</span>
		<input type="date" name="from" value={data.filters.from} class="w-full rounded-md border border-stone-300 px-2 py-1.5" />
	</label>
	<label class="block">
		<span class="mb-0.5 block text-xs text-stone-500">（まで）</span>
		<input type="date" name="to" value={data.filters.to} class="w-full rounded-md border border-stone-300 px-2 py-1.5" />
	</label>
	<div class="flex items-end gap-2">
		<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-white hover:bg-brand-700">絞り込む</button>
		{#if filtered}<a href="/admin/group-inquiries" class="rounded-md px-2 py-1.5 text-xs text-stone-500 hover:underline">解除</a>{/if}
	</div>
</form>

{#if data.live && !data.error && data.batches.length === 0}
	<p class="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-10 text-center text-sm text-stone-500">該当する照会はありません。</p>
{/if}

<div class="grid gap-4">
	{#each data.batches as b (b.batchId)}
		{@const targets = batchTargets(b.items)}
		<section class="rounded-xl border border-l-4 border-stone-200 border-l-brand-800 bg-white">
			<header class="flex flex-wrap items-start justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
				<div class="min-w-0">
					<p class="font-bold text-stone-900">
						{#if b.partnerId}<a href={`/admin/partners/${b.partnerId}`} class="hover:underline">{b.partnerName}</a>{:else}{b.partnerName}{/if}
						<span class="ml-1 text-sm font-normal text-stone-700">{[...new Set(b.items.map((r) => r.group_name))].join('・')}</span>
					</p>
					<p class="text-xs text-stone-500">{dt(b.createdAt)} 受付・{b.items.length}件{b.items[0]?.submitted_by ? `・${b.items[0].submitted_by}` : ''}</p>
				</div>
				{#if targets.length}
					<button type="button" onclick={() => (openBatch = openBatch === b.batchId ? null : b.batchId)} class="rounded-md border border-emerald-600 px-3 py-1 text-xs text-emerald-700 hover:bg-emerald-50">
						{openBatch === b.batchId ? '閉じる' : `回答待ち ${targets.length} 件を受けられるにする…`}
					</button>
				{/if}
			</header>
			{#if openBatch === b.batchId && targets.length}
				<form
					method="POST"
					action="?/answerBatch"
					use:enhance={() => {
						busyBatch = b.batchId;
						return async ({ update }) => {
							busyBatch = null;
							openBatch = null;
							await update();
						};
					}}
					class="grid gap-2 border-b border-stone-100 bg-emerald-50/50 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end"
				>
					<input type="hidden" name="batchId" value={b.batchId} />
					<label class="block">
						<span class="mb-0.5 block text-xs text-stone-500">取引先への一言（任意・全件に同じ文）</span>
						<input name="message" maxlength="1000" class="w-full rounded-md border border-stone-300 px-2 py-1.5" />
					</label>
					<label class="block">
						<span class="mb-0.5 block text-xs text-stone-500">回答の有効期限（空＝既定）</span>
						<input type="date" name="expiresOn" class="w-full rounded-md border border-stone-300 px-2 py-1.5" />
					</label>
					<button
						type="submit"
						disabled={busyBatch === b.batchId}
						onclick={confirmSubmit({ message: `回答待ちで自動計算できた ${targets.length} 件を、自動計算額のまま「受けられる」で回答し、取引先へメールします（取引先×施設ごとに1通）。`, confirmLabel: '回答する', danger: false })}
						class="rounded-md bg-emerald-600 px-4 py-1.5 text-white hover:bg-emerald-700 disabled:opacity-50"
					>{busyBatch === b.batchId ? '回答しています…' : `${targets.length} 件を受けられるにする`}</button>
					<p class="text-[11px] text-stone-500 sm:col-span-3">料金の無い件・休館日を含む件・回答済みの件は対象外です（詳細から個別に回答してください）。</p>
				</form>
			{/if}
			<ul class="divide-y divide-stone-100">
				{#each b.items as r (r.id)}
					{@const a = amountOf(r)}
					<li>
						<a href={`/admin/group-inquiries/${r.id}`} class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm hover:bg-stone-50">
							<div class="min-w-0 flex-1">
								<p class="flex flex-wrap items-center gap-1.5">
									<span class={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusTone(r.status)}`}>{data.statusLabels[r.status]}</span>
									{#if r.answer && r.status === 'offered'}<span class="text-[11px] text-stone-500">{data.answerLabels[r.answer]}</span>{/if}
									<span class="font-mono text-xs text-stone-500">{r.inquiry_code}</span>
									<span class="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-700">{r.facilityName}</span>
									{#if r.quote_credit?.over || r.credit_override}<span class="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">{r.credit_override ? '受付枠超過（承認済み）' : '受付枠超過'}</span>{/if}
								</p>
								<p class="mt-0.5 font-medium text-stone-900">{r.group_name} ・ {describeGroupStay(r.check_in_date, r.nights)}</p>
								<p class="text-stone-600">{r.room_name} × {r.room_count}室 ・ 大人{r.adult_total}名（{describeRoomAdults(r.rooms)}）・ {r.plan_display_name ?? r.plan_name} ・ {r.payment_label}</p>
							</div>
							<div class="text-right">
								{#if a}
									<p class="font-bold tabular-nums">{yen(a.total)}</p>
									<p class="text-[11px] text-stone-500">{a.answered ? '回答額' : '自動計算額'}（入湯税込み）</p>
								{:else}
									<p class="text-xs text-amber-700">{data.quoteText[r.quote_status] || '料金なし'}</p>
								{/if}
								{#if r.quote_remaining != null}<p class={`text-[11px] ${r.quote_remaining < r.room_count ? 'font-medium text-red-700' : 'text-stone-500'}`}>照会時の残室 {r.quote_remaining} 室</p>{/if}
								{#if r.status === 'offered' && r.answer_expires_at}<p class="text-[11px] text-stone-500">期限 {dt(r.answer_expires_at)}</p>{/if}
								{#if r.bookingCode}<p class="text-[11px] text-emerald-700">予約 {r.bookingCode}{r.bookingStatus === 'cancelled' ? '（取消）' : ''}</p>{/if}
							</div>
						</a>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>
