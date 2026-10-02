<script lang="ts">
	import { periodLabel } from '$lib/partner-invoice';

	let { data } = $props();

	const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;
	const ym = (period: string) => period.slice(0, 7);
	const md = (iso: string) => `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
	const dt = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

	const isCurrent = $derived(data.period === data.currentPeriod);
	const sum = $derived({
		total: data.rows.reduce((s, r) => s + r.total, 0),
		billable: data.rows.reduce((s, r) => s + r.billableCount, 0),
		usage: data.rows.reduce((s, r) => s + r.usageTotal, 0),
		billed: data.rows.reduce((s, r) => s + r.billedTotal, 0)
	});
	// 当月の未発行: 自動発行の条件（自動発行 ON・振込先あり）を満たすときだけ「月末に自動発行」
	const autoWillIssue = $derived(data.autoIssue && !data.bankAccountMissing);

	const draftUrl = (partnerId: string, format: 'html' | 'pdf') => `/admin/partners/${partnerId}/invoices/preview?period=${data.period}&format=${format}`;
	const smallBtn = 'inline-block rounded-md border border-stone-300 bg-white px-2 py-0.5 text-xs whitespace-nowrap text-stone-700 hover:bg-stone-50';
</script>

<svelte:head><title>予定請求書 ｜ 山人管理</title></svelte:head>

<div class="mb-4">
	<p class="mb-1 text-xs text-stone-400"><a href="/admin/partners" class="hover:underline">取引先</a> ／ 予定請求書</p>
	<h1 class="mb-1 text-lg font-bold text-stone-800">予定請求書 — {data.facilityName}</h1>
	<p class="max-w-3xl text-xs leading-5 text-stone-500">
		その月の今日までにチェックアウトした確定予約で計算した予定のご請求です。月末日の15時ごろに正式なご請求書を発行し、取引先へ送ります。
		金額は予約時の金額で、ご請求の対象は「月末締め翌月末銀行振込」と「請求書で精算する」にした支払方法だけです（それ以外はご利用明細に載り、ご請求は 0 円）。
	</p>
</div>

<!-- 対象月（未来の月は選べない） -->
<div class="mb-4 flex flex-wrap items-center gap-2">
	<a href="?period={ym(data.prevPeriod)}" class={smallBtn}>← 前月</a>
	<span class="px-2 text-sm font-bold text-stone-800">{periodLabel(data.period)}</span>
	{#if data.nextPeriod}
		<a href="?period={ym(data.nextPeriod)}" class={smallBtn}>翌月 →</a>
	{:else}
		<span class="{smallBtn} cursor-not-allowed opacity-40" aria-disabled="true">翌月 →</span>
	{/if}
	{#if !isCurrent}
		<a href="?period={ym(data.currentPeriod)}" class="text-xs text-brand-800 hover:underline">当月へ</a>
	{/if}
	<span class="text-xs text-stone-500">
		{#if isCurrent}
			{md(data.today)}までのチェックアウト（試算日 {md(data.today)}）
		{:else}
			{periodLabel(data.period)}末までの全チェックアウト（発行済みなら正式なご請求書を開けます）
		{/if}
	</span>
</div>

{#if data.error}
	<p class="mb-4 rounded-lg px-3 py-2 text-sm {data.live ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}">{data.error}</p>
{:else}
	{#if data.bankAccountMissing}
		<p class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
			振込先が未設定のため、月末のご請求書は自動発行されません。<a href="/admin/partners" class="underline">取引先一覧の「請求書の設定」</a>で振込先を登録してください。
		</p>
	{:else if !data.autoIssue}
		<p class="mb-3 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">
			この施設は月末の自動発行が OFF です（取引先一覧の「請求書の設定」）。正式なご請求書は各取引先の画面から発行してください。
		</p>
	{/if}
	{#if !data.pdfReady}
		<p class="mb-3 text-[11px] text-stone-500">※ PDF 生成（Cloudflare Browser Rendering）が未設定のため、PDF は HTML（ブラウザで開いて印刷）になります。</p>
	{/if}

	<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full text-sm">
			<thead class="bg-stone-50 text-left text-xs text-stone-500">
				<tr>
					<th class="px-3 py-2 font-medium">取引先（宛名）</th>
					<th class="px-3 py-2 text-right font-medium">対象件数<div class="font-normal text-stone-400">ご請求／全件</div></th>
					<th class="px-3 py-2 text-right font-medium">ご利用総額</th>
					<th class="px-3 py-2 text-right font-medium">ご請求額</th>
					<th class="px-3 py-2 font-medium">お支払期限</th>
					<th class="px-3 py-2 font-medium">状態</th>
					<th class="px-3 py-2 font-medium"></th>
				</tr>
			</thead>
			<tbody>
				{#each data.rows as r (r.partnerId)}
					<tr class="border-t border-stone-100 align-top">
						<td class="px-3 py-2.5">
							<a href="/admin/partners/{r.partnerId}?inv={ym(data.period)}" class="font-medium text-stone-800 hover:underline">{r.partnerName}</a>
							{#if r.recipientName !== r.partnerName}<div class="text-xs text-stone-500">宛名: {r.recipientName} 御中</div>{/if}
							<div class="mt-0.5 flex flex-wrap gap-1">
								{#if r.bookingEnabled}<span class="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-800">予約受付</span>{/if}
								{#if !r.isActive}<span class="rounded-full bg-stone-200 px-2 py-0.5 text-[11px] text-stone-600">公開停止</span>{/if}
							</div>
							{#if r.chargeFailed.length}
								<div class="mt-1 text-[11px] text-amber-800">カード決済失敗（要確認）: {r.chargeFailed.join('、')}（ご請求に含めません）</div>
							{/if}
						</td>
						{#if r.total === 0}
							<td class="px-3 py-2.5 text-right text-xs text-stone-400" colspan="4">対象なし（{isCurrent ? '今日まで' : 'この月'}にチェックアウトの確定予約はありません）</td>
						{:else}
							<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{r.billableCount}／{r.total}件</td>
							<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">{yen(r.usageTotal)}</td>
							<td class="px-3 py-2.5 text-right tabular-nums whitespace-nowrap">
								<span class={r.billedTotal > 0 ? 'font-semibold text-stone-800' : 'text-stone-400'}>{yen(r.billedTotal)}</span>
								{#if r.billedTotal > 0}<div class="text-[11px] text-stone-500">うち消費税 {yen(r.tax10)}・入湯税 {yen(r.nonTaxable)}</div>{/if}
							</td>
							<td class="px-3 py-2.5 text-xs whitespace-nowrap">{r.billedTotal > 0 ? r.dueDate : '—'}</td>
						{/if}
						<td class="px-3 py-2.5 text-xs">
							{#if r.issued}
								<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">発行済み</span>
								<div class="mt-0.5 font-mono text-stone-700">{r.issued.invoiceNo}</div>
								<div class="text-stone-500">{r.issued.issueDate}・{r.issued.issuedBy === 'auto' ? '自動' : 'スタッフ'}・{yen(r.issued.billedTotal)}（{r.issued.bookingCount}件）</div>
								{#if r.issued.sentAt}
									<div class="text-emerald-700">送信済み {dt(r.issued.sentAt)}</div>
								{:else}
									<div class="text-stone-500">未送信</div>
								{/if}
								{#if r.issued.sendError}<div class="break-all text-rose-700">{r.issued.sendError}</div>{/if}
								{#if r.issued.billedTotal !== r.billedTotal || r.issued.bookingCount !== r.total}
									<div class="mt-0.5 text-amber-800">※ 発行後の実績と差があります（正式なご請求書は発行時の内容のままです）</div>
								{/if}
							{:else if isCurrent}
								<span class="text-stone-600">{autoWillIssue ? '未発行（月末に自動発行）' : '未発行（自動発行されません）'}</span>
							{:else}
								<span class="text-stone-600">未発行</span>
							{/if}
						</td>
						<td class="px-3 py-2.5">
							<div class="flex flex-wrap justify-end gap-1.5">
								{#if r.issued}
									<a class="{smallBtn} border-emerald-300 text-emerald-800" href="/admin/partners/{r.partnerId}/invoices/{r.issued.id}?format=html" target="_blank" rel="noopener">正式版を開く</a>
									<a class="{smallBtn} border-emerald-300 text-emerald-800" href="/admin/partners/{r.partnerId}/invoices/{r.issued.id}?format=pdf" data-sveltekit-reload>正式版 PDF</a>
								{/if}
								{#if r.total > 0}
									<a class={smallBtn} href={draftUrl(r.partnerId, 'html')} target="_blank" rel="noopener">予定請求書を開く</a>
									<a class={smallBtn} href={draftUrl(r.partnerId, 'pdf')} data-sveltekit-reload>PDF</a>
								{/if}
								<a class={smallBtn} href="/admin/partners/{r.partnerId}?inv={ym(data.period)}">取引先詳細へ</a>
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="7" class="px-3 py-4 text-sm text-stone-500">
							{periodLabel(data.period)}は対象の取引先がありません（チェックアウトの確定予約がある取引先・予約受付中の取引先が対象です）。
						</td>
					</tr>
				{/each}
			</tbody>
			{#if data.rows.length > 1}
				<tfoot>
					<tr class="border-t border-stone-300 bg-stone-50 font-semibold">
						<td class="px-3 py-2">合計（{data.rows.length}社）</td>
						<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">{sum.billable}／{sum.total}件</td>
						<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">{yen(sum.usage)}</td>
						<td class="px-3 py-2 text-right tabular-nums whitespace-nowrap">{yen(sum.billed)}</td>
						<td colspan="3"></td>
					</tr>
				</tfoot>
			{/if}
		</table>
	</div>
	<p class="mt-2 text-[11px] text-stone-500">
		予定請求書は確認用の試算です（番号は未発行・「予定」の透かし入り）。取引先へは送らないでください。正式なご請求書の発行・送信・取消は各取引先の画面の「ご請求書」で行えます。
	</p>
{/if}
