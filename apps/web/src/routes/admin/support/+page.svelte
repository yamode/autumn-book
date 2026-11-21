<script lang="ts">
	// 会員サポートの一覧（docs/member-support.md「管理画面」）。未返信が上・最新の抜粋つき
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { SUPPORT_STATUS_LABELS, supportCategoryLabel } from '$lib/support';

	let { data } = $props();

	const tabs = $derived([
		{ key: 'open', label: SUPPORT_STATUS_LABELS.open, count: data.counts.open as number | null },
		{ key: 'waiting', label: SUPPORT_STATUS_LABELS.waiting, count: data.counts.waiting as number | null },
		{ key: 'closed', label: SUPPORT_STATUS_LABELS.closed, count: data.counts.closed as number | null },
		{ key: 'all', label: 'すべて', count: null as number | null }
	]);
	const STATUS_CLASS: Record<string, string> = {
		open: 'bg-amber-50 text-amber-800 border-amber-200',
		waiting: 'bg-sky-50 text-sky-800 border-sky-200',
		closed: 'bg-stone-100 text-stone-600 border-stone-200'
	};
	const fmt = (s: string) =>
		new Date(s).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
</script>

<svelte:head><title>会員サポート ｜ 山人管理</title></svelte:head>

<PageHeader title="会員サポート" description="会員システム（会員登録・ログイン・マイページ・公式サイトの予約）についてのお問い合わせです。ヘルプページのフォームと、support@yamado.app へのメール（受信を有効にした後）がここに入ります。返信はメールでお客様へ送られます。">
	{#snippet actions()}
		<a href="/admin/support/faqs" class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:border-stone-500">よくある質問の編集</a>
		<a href="/help" target="_blank" rel="noopener" class="rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 hover:border-stone-500">ヘルプページを開く ↗</a>
	{/snippet}
</PageHeader>

{#if !data.live}
	<div class="mb-4 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-500">
		この環境では使えません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。
	</div>
{/if}
{#if data.error}
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{data.error}</div>
{/if}

<nav class="mb-4 flex flex-wrap items-center gap-1 border-b border-stone-200" aria-label="状態">
	{#each tabs as t (t.key)}
		<a
			href="?status={t.key}"
			aria-current={data.status === t.key ? 'page' : undefined}
			class="-mb-px border-b-2 px-3 py-2 text-sm {data.status === t.key ? 'border-brand-800 font-medium text-brand-900' : 'border-transparent text-stone-500 hover:text-stone-800'}"
		>
			{t.label}{#if t.count !== null}<span class="ml-1 text-xs text-stone-400 tabular-nums">{t.count}</span>{/if}
		</a>
	{/each}
	{#if data.counts.needs_reply > 0}
		<span class="ml-auto rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">未返信 {data.counts.needs_reply}</span>
	{/if}
</nav>

<div class="overflow-hidden rounded-xl border border-stone-200 bg-white">
	{#each data.items as item (item.id)}
		<a href="/admin/support/{item.id}" class="flex gap-3 border-b border-stone-100 px-4 py-3 text-sm last:border-0 hover:bg-stone-50">
			<span class="mt-1.5 h-2 w-2 shrink-0 rounded-full {item.needs_reply && item.status !== 'closed' ? 'bg-amber-500' : 'bg-transparent'}" title={item.needs_reply ? '未返信' : ''}></span>
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
					<span class="font-mono text-xs text-stone-500">{item.code}</span>
					<span class="rounded-full border px-2 py-0.5 text-[11px] {STATUS_CLASS[item.status] ?? STATUS_CLASS.closed}">{SUPPORT_STATUS_LABELS[item.status] ?? item.status}</span>
					<span class="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600">{supportCategoryLabel(item.category)}</span>
					{#if item.is_member}<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">会員</span>{/if}
					{#if item.source === 'email'}<span class="text-[11px] text-stone-400">メール</span>{/if}
					<time class="ml-auto text-xs text-stone-400">{fmt(item.last_message_at)}</time>
				</div>
				<p class="mt-1 truncate font-medium {item.needs_reply && item.status !== 'closed' ? 'text-stone-900' : 'text-stone-700'}">{item.subject || '（件名なし）'}</p>
				<p class="mt-0.5 truncate text-xs text-stone-500">{item.name || '（お名前なし）'} ・ {item.email}</p>
				{#if item.preview}<p class="mt-1 truncate text-xs text-stone-400">{item.preview}</p>{/if}
			</div>
		</a>
	{:else}
		<p class="px-4 py-10 text-center text-sm text-stone-400">お問い合わせはありません</p>
	{/each}
</div>
