<script lang="ts">
	import { enhance } from '$app/forms';

	import Unavailable from '$lib/components/admin/Unavailable.svelte';
	import type { CampaignRow } from '$lib/server/admin-app-data';

	let { data, form } = $props();

	let tab = $state<'manual' | 'auto'>('manual');
	const isAdmin = $derived(data.user?.role === 'admin');

	const dt = (s: string | null) =>
		s
			? new Date(s).toLocaleString('ja-JP', {
					month: 'numeric',
					day: 'numeric',
					hour: '2-digit',
					minute: '2-digit'
				})
			: '—';

	const TARGET_LABEL: Record<string, string> = {
		all: '全会員',
		rank: 'ランク',
		members: '個別',
		test: 'テスト'
	};

	function statusOf(c: CampaignRow): string {
		if (c.cancelled_at) return '取消済';
		if (c.pending > 0 || c.processing > 0) {
			return new Date(c.scheduled_at).getTime() > Date.now() ? '予約済' : '送信中';
		}
		return c.failed > 0 ? `完了(失敗${c.failed})` : '完了';
	}

	const canCancel = (c: CampaignRow) =>
		!c.cancelled_at && c.pending > 0 && new Date(c.scheduled_at).getTime() > Date.now();

	// 自動通知は日付ごとに reminder / thanks をまとめる
	const autoByDay = $derived.by(() => {
		const map = new Map<string, Record<string, { queued: number; sent: number; failed: number; read: number }>>();
		for (const r of data.auto ?? []) {
			const day = String(r.day).slice(0, 10);
			if (!map.has(day)) map.set(day, {});
			map.get(day)![r.type] = { queued: r.queued, sent: r.sent, failed: r.failed, read: r.read };
		}
		return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
	});

	const fmt = (v: { queued: number; sent: number; failed: number; read: number } | undefined) =>
		v ? `${v.queued} / ${v.sent} / ${v.failed} / ${v.read}` : '0 / 0 / 0 / 0';
</script>

<svelte:head><title>アプリ通知 ｜ 山人管理</title></svelte:head>

<div class="mb-1 flex flex-wrap items-center justify-between gap-2">
	<h1 class="text-lg font-bold text-stone-800">アプリ通知</h1>
	{#if !data.unavailable && isAdmin}
		<a href="/admin/push/new" class="bg-accent-600 rounded-lg px-4 py-2 text-sm font-medium text-white">
			＋ 新しい通知
		</a>
	{/if}
</div>
<p class="mb-4 text-xs text-stone-400">
	会員のアプリへ push 通知を送ります。通知センターにも残ります。<strong
		class="text-stone-600">送信は取り消せません。</strong
	>
</p>

{#if data.unavailable}
	<Unavailable authMode={data.authMode} dataSource={data.dataSource} />
{:else}
	{#if data.error}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{data.error}
		</div>
	{/if}
	{#if form?.message}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{form.message}
		</div>
	{/if}
	{#if form?.cancelled != null}
		<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
			予約配信を取り消しました（{form.cancelled} 件の待機を削除）。
		</div>
	{/if}

	{#if data.queue}
		{@const q = data.queue}
		<div
			class="mb-4 rounded-xl border p-4 text-sm {q.stuck
				? 'border-red-200 bg-red-50 text-red-800'
				: 'border-stone-200 bg-white text-stone-600'}"
		>
			<p>
				配信キュー　待機 {q.pending} ／ 処理中 {q.processing} ／ 直近1時間の失敗 {q.failed_1h}
				　最終送信 {dt(q.last_sent_at)}
			</p>
			<p class="mt-1 text-xs">
				{#if q.stuck}
					● 配信が滞留しています。pg_cron book_notifications_drain または Edge Function send-push を確認してください。
				{:else}
					<span class="text-emerald-700">● 正常</span>（drain cron は 2 分毎・最終 claim
					{dt(q.last_claimed_at)}）
				{/if}
			</p>
		</div>
	{/if}

	<div class="mb-3 flex gap-1 border-b border-stone-200">
		<button
			type="button"
			onclick={() => (tab = 'manual')}
			class="px-3 py-2 text-sm {tab === 'manual'
				? 'border-brand-800 text-brand-900 -mb-px border-b-2 font-medium'
				: 'text-stone-500'}">手動配信</button
		>
		<button
			type="button"
			onclick={() => (tab = 'auto')}
			class="px-3 py-2 text-sm {tab === 'auto'
				? 'border-brand-800 text-brand-900 -mb-px border-b-2 font-medium'
				: 'text-stone-500'}">自動通知（リマインド・サンクス）</button
		>
	</div>

	{#if tab === 'manual'}
		{#if (data.campaigns ?? []).length === 0}
			<p class="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">
				まだ通知を送っていません。「＋ 新しい通知」から作成し、まずテスト受信者に送ります。
			</p>
		{:else}
			<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
				<table class="w-full min-w-[900px] text-sm">
					<thead class="bg-stone-50 text-xs text-stone-500">
						<tr>
							<th class="px-3 py-2 text-left">日時</th>
							<th class="px-3 py-2 text-left">タイトル</th>
							<th class="px-3 py-2 text-left">種別</th>
							<th class="px-3 py-2 text-left">宛先</th>
							<th class="px-3 py-2 text-right">宛先数</th>
							<th class="px-3 py-2 text-right">送信</th>
							<th class="px-3 py-2 text-right">失敗</th>
							<th class="px-3 py-2 text-right">既読</th>
							<th class="px-3 py-2 text-left">状態</th>
						</tr>
					</thead>
					<tbody>
						{#each data.campaigns as c (c.id)}
							<tr class="border-t border-stone-100 hover:bg-stone-50">
								<td class="px-3 py-2 text-xs text-stone-500">{dt(c.scheduled_at)}</td>
								<td class="px-3 py-2">
									<a href="/admin/push/{c.id}" class="text-stone-800 underline">{c.title}</a>
								</td>
								<td class="px-3 py-2 text-stone-500">{c.type}</td>
								<td class="px-3 py-2 text-stone-600">
									{TARGET_LABEL[c.target?.mode ?? 'all'] ?? c.target?.mode}
								</td>
								<td class="px-3 py-2 text-right text-stone-600">{c.recipient_count}</td>
								<td class="px-3 py-2 text-right text-stone-600">{c.sent}</td>
								<td class="px-3 py-2 text-right {c.failed > 0 ? 'text-red-700' : 'text-stone-400'}">
									{c.failed}
								</td>
								<td class="px-3 py-2 text-right text-stone-600">{c.read}</td>
								<td class="px-3 py-2 text-xs text-stone-600">
									{statusOf(c)}
									{#if isAdmin && canCancel(c)}
										<form
											method="POST"
											action="?/cancel"
											use:enhance
											class="mt-1"
											onsubmit={(e) => {
												if (!confirm(`予約配信「${c.title}」を取り消します。よろしいですか？`)) {
													e.preventDefault();
												}
											}}
										>
											<input type="hidden" name="campaignId" value={c.id} />
											<button type="submit" class="text-xs text-red-700 underline">取消</button>
										</form>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{:else}
		<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
			<table class="w-full min-w-[640px] text-sm">
				<thead class="bg-stone-50 text-xs text-stone-500">
					<tr>
						<th class="px-3 py-2 text-left">日付</th>
						<th class="px-3 py-2 text-left">リマインド（積 / 送 / 失 / 読）</th>
						<th class="px-3 py-2 text-left">サンクス（積 / 送 / 失 / 読）</th>
					</tr>
				</thead>
				<tbody>
					{#each autoByDay as [day, types]}
						<tr class="border-t border-stone-100">
							<td class="px-3 py-2 text-stone-600">{day}</td>
							<td class="px-3 py-2 text-stone-600">{fmt(types.reminder)}</td>
							<td class="px-3 py-2 text-stone-600">{fmt(types.thanks)}</td>
						</tr>
					{:else}
						<tr>
							<td colspan="3" class="px-3 py-6 text-center text-sm text-stone-500">
								直近 30 日に自動通知はありません。会員に紐づく予約（members.guest_id）が無い間は 0 件です。
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		<p class="mt-2 text-xs text-stone-400">
			毎日 JST 10:00 に enqueue されます。0 件が続くのは予約が無いだけの可能性があります。
		</p>
	{/if}
{/if}
