<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	type UpcomingChargeRow = PageData['scheduled'][number];

	let { data } = $props();

	const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
	const WD = ['日', '月', '火', '水', '木', '金', '土'];
	const md = (iso: string) => {
		const d = new Date(`${iso}T00:00:00Z`);
		return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`;
	};
	const dt = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

	const total = (rows: UpcomingChargeRow[]) => rows.reduce((s, r) => s + r.amount, 0);
	const scheduledTotal = $derived(total(data.scheduled));
	const failedTotal = $derived(total(data.failed));
	const feeTotal = $derived(total(data.cancelFees));

	// 絞り込みのリンク（期間・最近の取消の切替）。custom の from / to は残す
	function q(over: { range?: string; from?: string | null; to?: string | null; cancelled?: boolean }) {
		const p = new URLSearchParams();
		const range = over.range ?? data.range.preset;
		if (range !== 'all') p.set('range', range);
		if (range === 'custom') {
			const from = over.from !== undefined ? over.from : data.range.from;
			const to = over.to !== undefined ? over.to : data.range.to;
			if (from) p.set('from', from);
			if (to) p.set('to', to);
		}
		if (over.cancelled ?? data.includeCancelled) p.set('cancelled', '1');
		const s = p.toString();
		return s ? `?${s}` : '?';
	}
	const csvUrl = $derived(`/admin/partners/charges/csv${q({})}`);

	const rangeLabel = $derived(
		data.range.preset === 'all'
			? 'すべての請求予定'
			: `${data.range.from ? md(data.range.from) : ''}〜${data.range.to ? md(data.range.to) : ''}`
	);

	let customFrom = $state('');
	let customTo = $state('');
	$effect.pre(() => {
		customFrom = data.range.from ?? '';
		customTo = data.range.to ?? '';
	});

	const smallBtn = 'inline-block rounded-md border border-stone-300 bg-white px-2 py-0.5 text-xs whitespace-nowrap text-stone-700 hover:bg-stone-50';
	const tabCls = (active: boolean) =>
		`rounded-full px-3 py-1 text-xs whitespace-nowrap ${active ? 'bg-brand-800 text-white' : 'border border-stone-300 bg-white text-stone-700 hover:bg-stone-50'}`;
	const reservationUrl = (code: string) => `/admin/reservations/${encodeURIComponent(code)}`;
	const settlementLabel = (s: string | null) => (s === 'card' ? 'カード' : s === 'invoice' ? '請求書' : s === 'refund' ? '差し引き' : s === 'deposit' ? 'デポジット' : '');
</script>

<svelte:head><title>今後の請求予定 ｜ 山人管理</title></svelte:head>

{#snippet bookingCells(r: UpcomingChargeRow)}
	<td class="px-3 py-2.5 whitespace-nowrap">
		<a href={reservationUrl(r.bookingCode)} class="font-mono text-xs text-brand-800 hover:underline">{r.bookingCode}</a>
	</td>
	<td class="px-3 py-2.5">
		{#if r.partnerId}
			<a href="/admin/partners/{r.partnerId}" class="text-stone-800 hover:underline">{r.partnerName}</a>
		{:else}
			{r.partnerName}
		{/if}
	</td>
	<td class="px-3 py-2.5 text-xs whitespace-nowrap">{md(r.checkIn)}〜{md(r.checkOut)}<div class="text-stone-500">{r.nights}泊・{r.roomCount}室</div></td>
	<td class="px-3 py-2.5">{r.guestName} 様</td>
{/snippet}

<div class="mb-4">
	<p class="mb-1 text-xs text-stone-400"><a href="/admin/partners" class="hover:underline">取引先</a> ／ 今後の請求予定</p>
	<h1 class="mb-1 text-lg font-bold text-stone-800">今後の請求予定 — {data.facilityName}</h1>
	<p class="max-w-3xl text-xs leading-5 text-stone-500">
		取引先予約の「オンライン決済（チェックアウト日）」で、登録カードへこれから請求する予約です。チェックアウト日に自動で請求します（毎時の定期処理）。
		請求額は宿泊料金＋入湯税−割引です。公式サイトの予約は予約時に請求が済むため、ここには出ません。
	</p>
</div>

<!-- 期間（請求予定日＝チェックアウト日） -->
<div class="mb-2 flex flex-wrap items-center gap-2">
	<a href={q({ range: 'all' })} class={tabCls(data.range.preset === 'all')}>すべて</a>
	<a href={q({ range: 'this_month' })} class={tabCls(data.range.preset === 'this_month')}>今月</a>
	<a href={q({ range: 'next_month' })} class={tabCls(data.range.preset === 'next_month')}>来月</a>
	<form method="GET" class="flex flex-wrap items-center gap-1.5 text-xs" data-no-guard>
		<input type="hidden" name="range" value="custom" />
		{#if data.includeCancelled}<input type="hidden" name="cancelled" value="1" />{/if}
		<input type="date" name="from" bind:value={customFrom} class="rounded-md border border-stone-300 px-1.5 py-0.5 text-xs" aria-label="開始日" />
		<span>〜</span>
		<input type="date" name="to" bind:value={customTo} class="rounded-md border border-stone-300 px-1.5 py-0.5 text-xs" aria-label="終了日" />
		<button type="submit" class={data.range.preset === 'custom' ? tabCls(true) : smallBtn}>指定</button>
	</form>
	{#if data.live && !data.error}
		<a href={csvUrl} class="{smallBtn} ml-auto" data-sveltekit-reload>CSV</a>
	{/if}
</div>
<div class="mb-4 flex flex-wrap items-center gap-3 text-xs text-stone-600">
	<span>{rangeLabel}（今日 {md(data.today)}）</span>
	<label class="inline-flex items-center gap-1">
		<input
			type="checkbox"
			checked={data.includeCancelled}
			onchange={(e) => {
				goto(q({ cancelled: (e.currentTarget as HTMLInputElement).checked }));
			}}
		/>
		最近取り消したもの（{data.recentCancelDays}日以内）も出す
	</label>
</div>

{#if data.error}
	<p class="mb-4 rounded-lg px-3 py-2 text-sm {data.live ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}">{data.error}</p>
{:else}
	{#if data.truncated}
		<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">件数が多いため、一部だけを表示しています。期間を絞ってください。</p>
	{/if}

	<!-- 請求失敗（要対応・期間に関係なくすべて） -->
	{#if data.failed.length}
		<section class="mb-5">
			<h2 class="mb-1.5 text-sm font-bold text-rose-700">請求失敗（要対応）{data.failed.length}件・{yen(failedTotal)}</h2>
			<p class="mb-2 text-xs text-stone-500">自動では再請求しません。予約番号から予約の詳細を開き、カードの登録し直しを取引先へ依頼するか「再請求」してください。</p>
			<div class="overflow-x-auto rounded-xl border border-rose-300 bg-rose-50/40">
				<table class="w-full text-sm">
					<thead class="bg-rose-50 text-left text-xs text-rose-800">
						<tr>
							<th class="px-3 py-2 font-medium">請求予定日</th>
							<th class="px-3 py-2 font-medium">予約番号</th>
							<th class="px-3 py-2 font-medium">取引先</th>
							<th class="px-3 py-2 font-medium">宿泊日</th>
							<th class="px-3 py-2 font-medium">宿泊者</th>
							<th class="px-3 py-2 text-right font-medium">請求額</th>
							<th class="px-3 py-2 font-medium">カード</th>
							<th class="px-3 py-2 font-medium">状態</th>
						</tr>
					</thead>
					<tbody>
						{#each data.failed as r (r.id)}
							<tr class="border-t border-rose-200 align-top">
								<td class="px-3 py-2.5 whitespace-nowrap">{md(r.chargeOn)}</td>
								{@render bookingCells(r)}
								<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold">{yen(r.amount)}</td>
								<td class="px-3 py-2.5 text-xs whitespace-nowrap">{r.cardLabel ?? '—'}</td>
								<td class="px-3 py-2.5 text-xs">
									<span class="rounded-full bg-rose-600 px-2 py-0.5 whitespace-nowrap text-white">請求失敗</span>
									{#if r.error}<div class="mt-1 text-rose-700">{r.error}</div>{/if}
									<div class="text-stone-500">試行 {r.chargeAttempts}回</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<!-- キャンセル料のカード請求が残っているもの -->
	{#if data.cancelFees.length}
		<section class="mb-5">
			<h2 class="mb-1.5 text-sm font-bold text-amber-800">キャンセル料（カードへ未請求）{data.cancelFees.length}件・{yen(feeTotal)}</h2>
			<p class="mb-2 text-xs text-stone-500">キャンセル料は取消と同時に登録カードへ請求します。ここに残っているのは、取消のときの請求が完了していない予約です（要確認）。</p>
			<div class="overflow-x-auto rounded-xl border border-amber-300 bg-white">
				<table class="w-full text-sm">
					<thead class="bg-amber-50 text-left text-xs text-amber-900">
						<tr>
							<th class="px-3 py-2 font-medium">取消日時</th>
							<th class="px-3 py-2 font-medium">予約番号</th>
							<th class="px-3 py-2 font-medium">取引先</th>
							<th class="px-3 py-2 font-medium">宿泊日</th>
							<th class="px-3 py-2 font-medium">宿泊者</th>
							<th class="px-3 py-2 text-right font-medium">キャンセル料</th>
							<th class="px-3 py-2 font-medium">カード</th>
						</tr>
					</thead>
					<tbody>
						{#each data.cancelFees as r (r.id)}
							<tr class="border-t border-stone-100 align-top">
								<td class="px-3 py-2.5 text-xs whitespace-nowrap">{dt(r.cancelledAt)}</td>
								{@render bookingCells(r)}
								<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{yen(r.amount)}{#if r.error}<div class="text-[11px] text-rose-700">{r.error}</div>{/if}</td>
								<td class="px-3 py-2.5 text-xs whitespace-nowrap">{r.cardLabel ?? '—'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<!-- 請求予定 -->
	<section class="mb-5">
		<h2 class="mb-1.5 text-sm font-bold text-stone-800">請求予定 {data.scheduled.length}件・{yen(scheduledTotal)}</h2>
		<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
			<table class="w-full text-sm">
				<thead class="bg-stone-50 text-left text-xs text-stone-500">
					<tr>
						<th class="px-3 py-2 font-medium">請求予定日<div class="font-normal text-stone-400">チェックアウト日</div></th>
						<th class="px-3 py-2 font-medium">予約番号</th>
						<th class="px-3 py-2 font-medium">取引先</th>
						<th class="px-3 py-2 font-medium">宿泊日</th>
						<th class="px-3 py-2 font-medium">宿泊者</th>
						<th class="px-3 py-2 text-right font-medium">請求額<div class="font-normal text-stone-400">宿泊料金＋入湯税−割引</div></th>
						<th class="px-3 py-2 font-medium">カード</th>
						<th class="px-3 py-2 font-medium">状態</th>
					</tr>
				</thead>
				<tbody>
					{#each data.scheduled as r (r.id)}
						<tr class="border-t border-stone-100 align-top">
							<td class="px-3 py-2.5 whitespace-nowrap {r.chargeOn <= data.today ? 'font-semibold text-amber-800' : ''}">{md(r.chargeOn)}</td>
							{@render bookingCells(r)}
							<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
								{yen(r.amount)}
								<div class="text-[11px] text-stone-500">
									宿泊 {yen(r.lodging)}{r.bathTax ? `・入湯税 ${yen(r.bathTax)}` : ''}{r.discount ? `・割引 −${yen(r.discount)}` : ''}
								</div>
							</td>
							<td class="px-3 py-2.5 text-xs whitespace-nowrap">{r.cardLabel ?? '—'}</td>
							<td class="px-3 py-2.5 text-xs">
								<span class="rounded-full bg-brand-100 px-2 py-0.5 whitespace-nowrap text-brand-800">請求予定</span>
								{#if r.chargeOn <= data.today}<div class="mt-0.5 text-amber-800">今日の定期処理で請求</div>{/if}
							</td>
						</tr>
					{:else}
						<tr><td colspan="8" class="px-3 py-4 text-sm text-stone-500">この期間に請求予定の予約はありません。</td></tr>
					{/each}
				</tbody>
				{#if data.scheduled.length > 1}
					<tfoot>
						<tr class="border-t border-stone-300 bg-stone-50 font-semibold">
							<td class="px-3 py-2" colspan="5">合計（{data.scheduled.length}件）</td>
							<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">{yen(scheduledTotal)}</td>
							<td colspan="2"></td>
						</tr>
					</tfoot>
				{/if}
			</table>
		</div>
	</section>

	<!-- 最近取り消したもの（請求なし） -->
	{#if data.includeCancelled}
		<section class="mb-5">
			<h2 class="mb-1.5 text-sm font-bold text-stone-600">最近取り消したもの（{data.recentCancelDays}日以内）{data.cancelled.length}件</h2>
			<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
				<table class="w-full text-sm">
					<thead class="bg-stone-50 text-left text-xs text-stone-500">
						<tr>
							<th class="px-3 py-2 font-medium">取消日時</th>
							<th class="px-3 py-2 font-medium">予約番号</th>
							<th class="px-3 py-2 font-medium">取引先</th>
							<th class="px-3 py-2 font-medium">宿泊日</th>
							<th class="px-3 py-2 font-medium">宿泊者</th>
							<th class="px-3 py-2 text-right font-medium">取り消した請求</th>
							<th class="px-3 py-2 font-medium">キャンセル料</th>
						</tr>
					</thead>
					<tbody>
						{#each data.cancelled as r (r.id)}
							<tr class="border-t border-stone-100 align-top text-stone-600">
								<td class="px-3 py-2.5 text-xs whitespace-nowrap">{dt(r.cancelledAt)}</td>
								{@render bookingCells(r)}
								<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap text-stone-400 line-through">{yen(r.lodging + r.bathTax - r.discount)}</td>
								<td class="px-3 py-2.5 text-xs">
									{#if r.cancelFee > 0}
										{yen(r.cancelFee)}（{settlementLabel(r.cancelFeeSettlement)}{r.cancelFeeStatus === 'charged' ? '・請求済み' : r.cancelFeeStatus === 'charge_failed' ? '・カード請求失敗→請求書' : ''}）
									{:else}
										なし
									{/if}
								</td>
							</tr>
						{:else}
							<tr><td colspan="7" class="px-3 py-4 text-sm text-stone-500">最近取り消した予約はありません。</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}

	<p class="mt-2 text-[11px] text-stone-500">
		Stripe の管理画面で予約番号を検索してカード登録（SetupIntent）を開くと、メタデータに請求予定日（charge_on）・請求額（charge_amount）・予約の状態（booking_status）が出ます。
	</p>
{/if}
