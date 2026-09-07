<script lang="ts">
	import Sparkline from '$lib/components/admin/Sparkline.svelte';
	import StatCard from '$lib/components/admin/StatCard.svelte';
	import Unavailable from '$lib/components/admin/Unavailable.svelte';

	let { data } = $props();

	const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`;
	const dt = (s: string | null) =>
		s
			? new Date(s).toLocaleString('ja-JP', {
					month: 'numeric',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
			: '—';

	// 運用チェック表のセル色: 0 or 30%未満=赤 / 100%未満=黄 / 100%=緑
	function ratioTone(n: number, total: number): string {
		if (total === 0) return 'text-stone-400';
		const r = n / total;
		if (r === 0 || r < 0.3) return 'font-bold text-red-700';
		if (r < 1) return 'font-medium text-amber-700';
		return 'text-emerald-700';
	}

	const levelStyle = {
		error: 'border-red-200 bg-red-50 text-red-800',
		warn: 'border-amber-200 bg-amber-50 text-amber-800',
		info: 'border-stone-200 bg-white text-stone-600'
	};
</script>

<svelte:head><title>アプリ運用 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">アプリ運用</h1>
<p class="mb-4 text-xs text-stone-400">
	YAMADO 公式アプリの状態と、気づけていない運用の穴をまとめて表示します。
</p>

{#if data.unavailable}
	<Unavailable authMode={data.authMode} dataSource={data.dataSource} />
{:else if data.error}
	<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{data.error}</div>
{:else if data.dashboard}
	{@const d = data.dashboard}
	{@const alerts = data.alerts ?? []}
	{@const acting = alerts.filter((a) => a.level !== 'info')}

	<p class="mb-3 text-xs text-stone-400">最終更新 {dt(d.generated_at)}</p>

	<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
		<StatCard
			label="会員"
			value="{d.members.active} 名"
			sub="今月 +{d.members.joined_this_month}"
			level={d.members.active === 0 ? 'warn' : 'ok'}
		/>
		<StatCard
			label="push 受信可能"
			value="{d.members.push_capable} 名 / {d.members.devices_active} 台"
			sub={d.members.active > 0
				? `opt-in ${Math.round((d.members.push_opt_in / d.members.active) * 100)}%`
				: null}
			level={d.members.devices_active === 0 ? 'warn' : 'ok'}
		/>
		<StatCard
			label="アプリ予約 30日"
			value="{d.bookings.last30_count} 件"
			sub={yen(d.bookings.last30_amount)}
		>
			<Sparkline values={d.bookings.daily.map((x) => x.c)} />
		</StatCard>
		<StatCard
			label="通知配信 7日"
			value="送信 {d.notifications.last7_sent}"
			sub="失敗 {d.notifications.last7_failed} ／ 既読率 {d.notifications.last7_read_rate}%"
			level={d.notifications.last7_failed > 0 ? 'warn' : 'ok'}
		>
			<Sparkline values={d.notifications.daily.map((x) => x.c)} />
		</StatCard>
	</div>

	<h2 class="mt-6 mb-2 text-sm font-bold text-stone-700">
		{acting.length > 0 ? `⚠ 要対応（${acting.length}）` : '要対応の項目はありません'}
	</h2>
	{#if alerts.length === 0}
		<p class="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-500">
			未対応の項目はありません。
		</p>
	{:else}
		<ul class="space-y-2">
			{#each alerts as a}
				<li
					class="flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm {levelStyle[a.level]}"
				>
					<span>{a.level === 'info' ? '○' : '●'}</span>
					<span class="flex-1">{a.message}</span>
					{#if a.link}
						<a href={a.link.href} class="shrink-0 font-medium underline">{a.link.label} →</a>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="mt-6 mb-2 text-sm font-bold text-stone-700">運用チェック（施設別）</h2>
	<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full min-w-[820px] text-sm">
			<thead class="bg-stone-50 text-xs text-stone-500">
				<tr>
					<th class="px-3 py-2 text-left">施設</th>
					<th class="px-3 py-2 text-right">公開プラン</th>
					<th class="px-3 py-2 text-right">写真ありプラン</th>
					<th class="px-3 py-2 text-right">公開客室</th>
					<th class="px-3 py-2 text-right">写真あり客室</th>
					<th class="px-3 py-2 text-right">個別規定なし</th>
					<th class="px-3 py-2 text-right">公開オプション</th>
					<th class="px-3 py-2 text-right">公開お知らせ</th>
				</tr>
			</thead>
			<tbody>
				{#each d.facilities as f}
					<tr class="border-t border-stone-100">
						<td class="px-3 py-2 font-medium text-stone-800">{f.name}</td>
						<td class="px-3 py-2 text-right {ratioTone(f.plans_published, f.plans_total)}">
							<a href="/admin/switch?f={f.facility_id}&back=%2Fadmin%2Fplans" class="underline">
								{f.plans_published}/{f.plans_total}
							</a>
						</td>
						<td class="px-3 py-2 text-right {ratioTone(f.plans_with_photos, f.plans_total)}">
							{f.plans_with_photos}/{f.plans_total}
						</td>
						<td class="px-3 py-2 text-right {ratioTone(f.rooms_published, f.rooms_total)}">
							<a href="/admin/switch?f={f.facility_id}&back=%2Fadmin%2Frooms" class="underline">
								{f.rooms_published}/{f.rooms_total}
							</a>
						</td>
						<td class="px-3 py-2 text-right {ratioTone(f.rooms_with_photos, f.rooms_total)}">
							{f.rooms_with_photos}/{f.rooms_total}
						</td>
						<td class="px-3 py-2 text-right text-stone-400">{f.plans_no_policy}</td>
						<td class="px-3 py-2 text-right text-stone-400">{f.options_active}</td>
						<td
							class="px-3 py-2 text-right {f.news_published === 0
								? 'text-amber-700'
								: 'text-emerald-700'}"
						>
							{f.news_published}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<div class="mt-6 grid gap-4 lg:grid-cols-2">
		<div class="rounded-xl border border-stone-200 bg-white p-4">
			<h3 class="mb-2 text-sm font-bold text-stone-700">配信キュー</h3>
			<p class="text-sm text-stone-600">
				待機 {d.notifications.queue.pending} ／ 処理中 {d.notifications.queue.processing} ／ 失敗(1h)
				{d.notifications.queue.failed_1h}
			</p>
			<p class="mt-1 text-xs text-stone-400">
				最終送信 {dt(d.notifications.queue.last_sent_at)}
				<span class={d.notifications.queue.stuck ? 'text-red-700' : 'text-emerald-700'}>
					{d.notifications.queue.stuck ? '● 滞留あり' : '● 正常'}
				</span>
			</p>
			<p class="mt-2 text-xs text-stone-500">
				自動通知 本日: リマインド {d.notifications.today_auto.reminder} ／ サンクス
				{d.notifications.today_auto.thanks}
			</p>
			<a href="/admin/push" class="text-brand-800 mt-2 inline-block text-xs font-medium underline">
				アプリ通知 →
			</a>
		</div>

		<div class="rounded-xl border border-stone-200 bg-white p-4">
			<h3 class="mb-2 text-sm font-bold text-stone-700">クーポン</h3>
			<p class="text-sm text-stone-600">
				有効 {d.coupons.active} 件 ／ 配布 {d.coupons.issued} ／ 使用 {d.coupons.used}
				{#if d.coupons.issued > 0}（{Math.round((d.coupons.used / d.coupons.issued) * 100)}%）{/if}
			</p>
			{#if d.coupons.expiring_7d_unused > 0}
				<p class="mt-1 text-xs text-amber-700">
					期限 7 日以内で未使用あり: {d.coupons.expiring_7d_unused} 件
				</p>
			{/if}
			<a href="/admin/coupons" class="text-brand-800 mt-2 inline-block text-xs font-medium underline">
				クーポン →
			</a>
		</div>
	</div>

	<h2 class="mt-6 mb-2 text-sm font-bold text-stone-700">最近の管理操作</h2>
	<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full min-w-[600px] text-sm">
			<tbody>
				{#each d.audit as l}
					<tr class="border-t border-stone-100 first:border-t-0">
						<td class="w-32 px-3 py-2 text-xs text-stone-400">{dt(l.created_at)}</td>
						<td class="w-48 px-3 py-2 font-mono text-xs text-stone-600">{l.action}</td>
						<td class="px-3 py-2 text-xs text-stone-600">
							{l.detail?.title ?? l.detail?.name ?? l.detail?.label ?? ''}
							{#if l.detail?.count != null}（{l.detail.count} 件）{/if}
						</td>
						<td class="w-32 px-3 py-2 text-xs text-stone-400">{l.actor_name ?? ''}</td>
					</tr>
				{:else}
					<tr>
						<td class="px-3 py-4 text-sm text-stone-400">まだ管理操作の記録がありません。</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
