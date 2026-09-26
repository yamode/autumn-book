<script lang="ts">
	import StatCard from '$lib/components/admin/StatCard.svelte';
	import { formatDateJa } from '$lib/format';
	import type { DashboardRow } from './+page.server';

	let { data } = $props();

	const STAY_STATUS: Record<string, string> = {
		reserved: '予約済',
		checked_in: 'チェックイン済',
		checked_out: '宿泊済',
		stayed: '宿泊済'
	};

	// 予約一覧へのリンク（その日のチェックイン・全経路）
	const listHref = (from: string, to: string) => `/admin/reservations?from=${from}&to=${to}&channel=`;

	let mailWarn = $derived(!!data.mailQueue && (data.mailQueue.stuck || data.mailQueue.failed_24h > 0));
</script>

<svelte:head><title>ダッシュボード ｜ 山人管理</title></svelte:head>

{#snippet guestTable(rows: DashboardRow[], empty: string, showCheckout = false)}
	<div class="overflow-x-auto">
		<table class="w-full min-w-[560px] text-sm">
			<thead>
				<tr class="border-b border-stone-200 text-left text-xs text-stone-500">
					<th class="px-3 py-1.5">予約番号</th>
					<th class="px-3">ゲスト</th>
					<th class="px-3">客室 / プラン</th>
					<th class="px-3">人数・泊数</th>
					<th class="px-3">{showCheckout ? 'チェックアウト' : '経路'}</th>
					<th class="px-3">状態</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as r (r.booking_code)}
					<tr class="border-b border-stone-100 hover:bg-stone-50">
						<td class="px-3 py-2">
							<a href="/admin/reservations/{r.booking_code}" class="font-mono text-accent-600 hover:underline">{r.booking_code}</a>
						</td>
						<td class="px-3">
							{r.guest_name ?? '—'}
							{#if r.guest_kana}<span class="block text-[11px] text-stone-400">{r.guest_kana}</span>{/if}
						</td>
						<td class="px-3">
							{r.room_name ?? '—'}
							{#if r.plan_name}<span class="block text-[11px] text-stone-400">{r.plan_name}</span>{/if}
						</td>
						<td class="px-3 whitespace-nowrap">大人{r.adult_count}名・{r.nights}泊</td>
						<td class="px-3 whitespace-nowrap">{showCheckout ? formatDateJa(r.check_out_date) : (r.channel_name ?? r.source ?? '—')}</td>
						<td class="px-3 whitespace-nowrap">
							<span class="text-xs">{STAY_STATUS[r.stay_status] ?? r.stay_status}</span>
							{#if r.mail_status === 'failed'}<span class="ml-1 rounded bg-red-50 px-1 text-[10px] text-red-700">確認メール失敗</span>{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="px-3 py-4 text-center text-stone-500">{empty}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

<h1 class="mb-1 text-lg font-bold text-stone-800">ダッシュボード — {data.currentFacility.name}</h1>
<p class="mb-4 text-xs text-stone-500">
	本日 {formatDateJa(data.today)}・OTA・電話を含む全経路{data.live ? '' : '（デモデータ）'}
</p>

{#if data.error}
	<p class="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{data.error}</p>
{/if}

<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
	<StatCard label="本日の到着" value="{data.arrivalsToday.length} 件" sub="大人 {data.arrivalsToday.reduce((s, r) => s + r.adult_count, 0)} 名" />
	<StatCard label="本日の出発" value="{data.departuresToday.length} 件" />
	<StatCard label="連泊中" value="{data.inHouse.length} 件" sub="昨日以前に到着" />
	<StatCard label="明日の到着" value="{data.arrivalsTomorrow.length} 件" />
	{#if data.mailQueue}
		<StatCard
			label="メール送信"
			value={data.mailQueue.stuck ? '滞留' : data.mailQueue.failed_24h > 0 ? `失敗 ${data.mailQueue.failed_24h}` : '正常'}
			sub="待機 {data.mailQueue.pending + data.mailQueue.processing}・失敗（24h） {data.mailQueue.failed_24h}"
			level={mailWarn ? 'error' : 'ok'}
		/>
	{:else}
		<StatCard label="メール送信" value="—" sub={data.live ? '状態を取得できません' : 'デモでは対象外'} level="warn" />
	{/if}
</div>

<section class="mt-4 rounded-xl border border-stone-200 bg-white p-4">
	<div class="mb-2 flex items-center justify-between">
		<h2 class="text-sm font-bold text-stone-700">本日の到着（{data.arrivalsToday.length}）</h2>
		<a href={listHref(data.today, data.today)} class="text-xs text-accent-600 hover:underline">予約管理で開く →</a>
	</div>
	{@render guestTable(data.arrivalsToday, '本日の到着予定はありません')}
</section>

<div class="mt-4 grid gap-4 xl:grid-cols-2">
	<section class="rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="mb-2 text-sm font-bold text-stone-700">本日の出発（{data.departuresToday.length}）</h2>
		{@render guestTable(data.departuresToday, '本日の出発予定はありません', true)}
	</section>
	<section class="rounded-xl border border-stone-200 bg-white p-4">
		<div class="mb-2 flex items-center justify-between">
			<h2 class="text-sm font-bold text-stone-700">明日の到着（{data.arrivalsTomorrow.length}）</h2>
			<a href={listHref(data.tomorrow, data.tomorrow)} class="text-xs text-accent-600 hover:underline">予約管理で開く →</a>
		</div>
		{@render guestTable(data.arrivalsTomorrow, '明日の到着予定はありません')}
	</section>
</div>

<p class="mt-3 text-[11px] text-stone-500">到着予定時刻・送迎・連絡事項は予約番号から詳細を開いて確認してください。</p>
