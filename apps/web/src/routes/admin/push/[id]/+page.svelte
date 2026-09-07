<script lang="ts">
	import Unavailable from '$lib/components/admin/Unavailable.svelte';

	let { data } = $props();

	const c = $derived(data.campaign);
	const d = $derived(data.detail);

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
		rank: 'ランク指定',
		members: '個別選択',
		test: 'テスト送信'
	};
</script>

<svelte:head><title>{c?.title ?? '配信'} ｜ 山人管理</title></svelte:head>

<a href="/admin/push" class="text-xs text-stone-400 underline">← アプリ通知</a>

{#if data.unavailable}
	<Unavailable authMode={data.authMode} dataSource={data.dataSource} />
{:else if !c}
	<div class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
		{data.error ?? '配信が見つかりません。'}
	</div>
{:else}
	<h1 class="mt-1 text-lg font-bold text-stone-800">{c.title}</h1>
	<p class="mb-4 text-xs text-stone-400">
		{c.type} ／ {dt(c.scheduled_at)} ／ 宛先: {TARGET_LABEL[c.target?.mode ?? 'all'] ??
			c.target?.mode}
		{c.recipient_count} 名 ／ 実行者: {c.actor_name ?? '—'}
		{#if c.cancelled_at}　<span class="text-red-700">取消済（{dt(c.cancelled_at)}）</span>{/if}
	</p>

	<div class="max-w-3xl space-y-4">
		<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">
			<p>本文: {c.body || '（なし）'}</p>
			<p class="mt-1">
				タップ先: <span class="font-mono text-xs">{c.data?.url ?? '（なし）'}</span>
			</p>
		</div>

		<div class="rounded-xl border border-stone-200 bg-white p-4">
			<h2 class="mb-2 text-sm font-bold text-stone-700">通知行</h2>
			<p class="text-sm text-stone-600">
				待機 {c.pending} ／ 処理中 {c.processing} ／ 送信済 {c.sent} ／ 失敗 {c.failed} ／ 既読 {c.read}
				{#if c.sent > 0}（{Math.round((c.read / c.sent) * 100)}%）{/if}
			</p>

			{#if d}
				<h2 class="mt-4 mb-2 text-sm font-bold text-stone-700">push</h2>
				<p class="text-sm text-stone-600">
					端末へ送出 {d.devices_pushed} ／ Expo 受理 {d.devices_ok} ／ エラー
					{d.devices_pushed - d.devices_ok}
				</p>
			{/if}

			<p class="mt-3 rounded-lg bg-stone-50 p-2 text-xs text-stone-500">
				「送信済」は通知センターに届いた件数です。push 通知の受信を許可していない会員・端末が未登録の会員も「送信済」になります。
			</p>
		</div>

		{#if d && d.failed_members.length > 0}
			<div class="rounded-xl border border-red-200 bg-white p-4">
				<h2 class="mb-2 text-sm font-bold text-red-800">失敗した会員（{d.failed_members.length} 件）</h2>
				<ul class="text-sm text-stone-600">
					{#each d.failed_members as m}
						<li>{m.member_code ?? ''} {m.name ?? ''}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if d && d.device_errors.length > 0}
			<div class="rounded-xl border border-amber-200 bg-white p-4">
				<h2 class="mb-2 text-sm font-bold text-amber-800">端末エラー（{d.device_errors.length} 件）</h2>
				<ul class="text-sm text-stone-600">
					{#each d.device_errors as e}
						<li>
							{e.member_code ?? ''} {e.platform ?? ''}
							{e.device_name ? `"${e.device_name}"` : ''}
							<span class="font-mono text-xs text-amber-700">{e.error_code ?? ''}</span>
						</li>
					{/each}
				</ul>
				<p class="mt-2 text-xs text-stone-400">
					DeviceNotRegistered の端末はアプリ側で自動的に無効化されます（再ログインで復帰します）。
				</p>
			</div>
		{/if}
	</div>
{/if}
