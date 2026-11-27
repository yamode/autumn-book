<script lang="ts">
	import { NTT_SMS_UNIT_PRICE_YEN, type MonthlySmsEstimate } from '$lib/precheckin-sms';

	let { estimate, today, autosendOn }: {
		estimate: Promise<MonthlySmsEstimate | null> | null;
		today: string;
		autosendOn: boolean;
	} = $props();

	const monthLabel = $derived(`${today.slice(0, 4)}年${Number(today.slice(5, 7))}月`);
	const integer = new Intl.NumberFormat('ja-JP');
	const yen = (units: number) => `${integer.format(units * NTT_SMS_UNIT_PRICE_YEN)}円`;

	function brandTotal(report: MonthlySmsEstimate) {
		return report.facilities.reduce(
			(total, facility) => ({
				sentUnits: total.sentUnits + facility.sentUnits,
				remainingUnits: total.remainingUnits + facility.remainingUnits
			}),
			{ sentUnits: 0, remainingUnits: 0 }
		);
	}
</script>

{#snippet amount(units: number)}
	<span class="block font-medium tabular-nums">{yen(units)}</span>
	<span class="block text-xs font-normal tabular-nums text-stone-500">{integer.format(units)}通</span>
{/snippet}

<section aria-labelledby="sms-month-estimate" class="mb-4 rounded-xl border border-stone-200 bg-white p-4 text-sm">
	<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
		<h2 id="sms-month-estimate" class="font-semibold">今月のSMS概算料金</h2>
		<p class="text-xs text-stone-500">{monthLabel}（日本時間）</p>
	</div>
	{#await estimate}
		<p class="mt-3 text-xs text-stone-500" role="status">送信記録と対象予約を集計しています。</p>
	{:then report}
		{#if report?.facilities.length}
			{@const total = brandTotal(report)}
			<p class="mt-1 text-xs text-stone-600">
				{autosendOn
					? '残りの見込みは、保存済みの自動送信設定と現在の予約に基づきます。'
					: '自動SMSは現在オフです。残りの見込みは、保存済みの設定で自動SMSを有効にした場合の金額です。'}
			</p>
			<div class="mt-3 overflow-x-auto">
				<table class="w-full min-w-[25rem] text-right">
					<thead class="border-b border-stone-200 text-xs text-stone-600">
						<tr>
							<th scope="col" class="px-2 py-2 text-left font-medium">施設</th>
							<th scope="col" class="px-2 py-2 font-medium">今月ここまで</th>
							<th scope="col" class="px-2 py-2 font-medium">残りの見込み</th>
							<th scope="col" class="px-2 py-2 font-medium">今月合計見込み</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-stone-100">
						{#each report.facilities as facility (facility.id)}
							<tr>
								<th scope="row" class="px-2 py-2 text-left font-medium">{facility.name}</th>
								<td class="px-2 py-2">{@render amount(facility.sentUnits)}</td>
								<td class="px-2 py-2">{@render amount(facility.remainingUnits)}</td>
								<td class="px-2 py-2">{@render amount(facility.sentUnits + facility.remainingUnits)}</td>
							</tr>
						{/each}
					</tbody>
					{#if report.completeBrand}
						<tfoot class="border-t border-stone-200 bg-stone-50">
							<tr>
								<th scope="row" class="px-2 py-2 text-left font-semibold">{report.brandName} ブランド合計</th>
								<td class="px-2 py-2">{@render amount(total.sentUnits)}</td>
								<td class="px-2 py-2">{@render amount(total.remainingUnits)}</td>
								<td class="px-2 py-2">{@render amount(total.sentUnits + total.remainingUnits)}</td>
							</tr>
						</tfoot>
					{/if}
				</table>
			</div>
			<p class="mt-2 text-xs text-stone-500">
				事前チェックインSMSのみ。現行の文面を
				<a href="https://www.nttcpaas.com/price" target="_blank" rel="noopener noreferrer" class="underline underline-offset-2">NTT CPaaSの公開単価（{NTT_SMS_UNIT_PRICE_YEN}円／通・税込）</a>
				で換算した概算です。
			</p>
		{:else}
			<p class="mt-3 text-xs text-stone-500">{report ? '集計を閲覧できる施設がありません。' : 'SMSの概算料金を取得できませんでした。'}</p>
		{/if}
	{/await}
</section>
