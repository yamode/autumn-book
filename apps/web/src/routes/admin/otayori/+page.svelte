<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { goto } from '$app/navigation';
	import { renderForumBody } from '$lib/forum-format';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data, form } = $props();

	const tabs = [
		{ key: 'pending', label: '申請中' },
		{ key: 'approved', label: '紹介済み' },
		{ key: 'rejected', label: '却下' }
	] as const;

	function go(status: string) {
		void goto(`/admin/otayori?status=${encodeURIComponent(status)}`);
	}

	// 却下フォームを開いている投稿ID（インライン理由入力）
	let rejectingId = $state<string | null>(null);

	const dateFormat = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Tokyo' });
	const dateTime = (date: string) => dateFormat.format(new Date(date));

	// 受付から3週間（21日）たっても「紹介した」も「却下」もしていない申請中のおたよりは赤く目立たせる
	// （サイドバーとダッシュボードの件数と同じ基準・book.otayori_overdue_count）
	const OVERDUE_DAYS = 21;
	const now = Date.now();
	const daysSince = (date: string) => Math.floor((now - new Date(date).getTime()) / 86_400_000);
	const overdue = (it: { status: string; createdAt: string }) => it.status === 'pending' && daysSince(it.createdAt) >= OVERDUE_DAYS;
</script>

<svelte:head><title>おたより ｜ 山人管理</title></svelte:head>

<PageHeader title="北風放送のおたより" description="投稿と添付を確認し、番組で紹介したおたよりを記録します。会員の投稿には、1,000ポイント（1,000円分）を付与します。" />

<section aria-label="YouTube Data API" class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
	<div>
		<p class="font-medium text-stone-900">YouTube Data API</p>
		{#await data.youtube}
			<p class="mt-1 text-stone-600">接続を確認しています。</p>
		{:then youtube}
			<p class="mt-1 text-stone-600" role="status">
				{#if youtube.status === 'connected'}接続済み。再生リストから視聴可能な動画を {youtube.count} 件取得しました。
				{:else if youtube.status === 'failed'}接続できませんでした。Google CloudのAPI設定と再生リストを確認してください。
				{:else if youtube.status === 'missing'}APIキー未設定。公開フィードから動画を表示しています。
				{:else}APIキー設定済み。
				{/if}
			</p>
		{/await}
	</div>
	<a href="?status={data.status}&page={data.page}&youtube=check" data-sveltekit-preload-data="off" class="inline-flex min-h-10 items-center rounded-md border border-stone-300 px-3 font-medium">接続を確認</a>
</section>

{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}
{#if form?.ok === 'approve'}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">番組で紹介したことを記録しました。{#if 'points' in form && form.points}{form.points.toLocaleString('ja-JP')}ポイントを付与しました。{/if}</p>{/if}
{#if form?.ok === 'reject'}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">おたよりを却下しました（監査ログに記録）。</p>{/if}

{#await data.otayoriOverdueBadge then n}
	{#if n}
		<p class="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
			受付から3週間たっても「紹介した」も「却下」もしていないおたよりが <strong class="tabular-nums">{n} 件</strong>あります（赤枠のもの）。
		</p>
	{/if}
{/await}

<!-- 投稿レビュー：タブ -->
<section class="rounded-xl border border-stone-200 bg-white p-4">
	<div class="mb-4 flex gap-1 overflow-x-auto border-b border-stone-200">
		{#each tabs as t}
			<button
				type="button"
				onclick={() => go(t.key)}
				class="shrink-0 border-b-2 px-4 py-2.5 text-sm whitespace-nowrap transition {data.status === t.key
					? 'border-brand-800 font-medium text-brand-900'
					: 'border-transparent text-stone-500 hover:text-brand-800'}"
			>
				{t.label}<span class="ml-1 text-xs text-stone-400">({data.counts[t.key]})</span>
			</button>
		{/each}
	</div>

	{#if data.items.length === 0}
		<p class="py-6 text-center text-sm text-stone-400">該当するおたよりはありません。</p>
	{:else}
		<div class="space-y-3">
			{#each data.items as it (it.id)}
				<div class="rounded-xl border p-4 {overdue(it) ? 'border-red-400 bg-red-50/60 ring-1 ring-red-300' : 'border-stone-200'}">
					<div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
						<span class="tabular-nums">{dateTime(it.createdAt)}</span>
						{#if overdue(it)}<span class="rounded bg-red-600 px-1.5 py-0.5 font-medium text-white">受付から{daysSince(it.createdAt)}日・未処理</span>{/if}
						{#if it.guest}<span>非会員</span>{:else}<span><span class="font-mono">{it.memberCode}</span> ／ {it.memberName}</span>{/if}
						{#if it.radioName || it.guest}<span class="rounded bg-stone-100 px-1.5 py-0.5">ラジオネーム {it.radioName || '匿名'}</span>{/if}
					</div>
					<p class="text-sm break-words whitespace-pre-wrap text-stone-700">{@html renderForumBody(it.body)}</p>
					{#if it.files.length}
						<ul class="mt-3 flex flex-wrap gap-2">
							{#each it.files as file, index (file.url)}
								<li><a href={file.url} class="inline-flex min-h-9 items-center rounded-md border border-stone-300 px-3 text-sm text-brand-800 underline">
									{file.kind === 'video' ? '動画' : '画像'} {index + 1} をダウンロード
								</a></li>
							{/each}
						</ul>
					{/if}
					{#if it.awardedAt}
						<p class="mt-3 text-sm font-medium text-emerald-800">1,000ポイント付与 · {dateTime(it.awardedAt)}</p>
					{/if}

					<div class="mt-3 flex flex-wrap items-center gap-2">
						{#if data.status === 'pending'}
							<!-- 押すだけで紹介を記録し、会員なら 1,000 ポイントを付ける（チェックの2手は 2026-11-25 にやめた） -->
							<form method="POST" action="?/approve" use:enhance class="flex flex-wrap items-center gap-2 text-sm">
								<input type="hidden" name="postId" value={it.id} />
								<input type="hidden" name="readOnAir" value="yes" />
								<button class="rounded-md bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600">番組で紹介した{it.guest ? '' : '（1,000ポイント付与）'}</button>
							</form>

							<!-- 却下（staff 可・理由入力） -->
							{#if rejectingId === it.id}
								<form method="POST" action="?/reject" use:enhance class="flex flex-wrap items-center gap-2">
									<input type="hidden" name="postId" value={it.id} />
									<input name="note" placeholder="却下理由（任意）" class="w-56 max-w-full rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
									<button class="rounded-md border border-red-200 px-3 py-2 text-xs text-red-600 hover:bg-red-50">却下する</button>
									<button type="button" onclick={() => (rejectingId = null)} class="px-1 py-2 text-xs text-stone-400 hover:text-stone-600">取消</button>
								</form>
							{:else}
								<button type="button" onclick={() => (rejectingId = it.id)} class="rounded-md border border-stone-300 px-3 py-2 text-xs text-stone-600 hover:bg-stone-50">却下</button>
							{/if}
						{:else if data.status === 'approved'}
							<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">紹介済み</span>
						{:else}
							<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">却下済み</span>
							<form method="POST" action="?/approve" use:enhance class="flex flex-wrap items-center gap-2 text-sm">
								<input type="hidden" name="postId" value={it.id} />
								<input type="hidden" name="readOnAir" value="yes" />
								<button class="rounded-md border border-emerald-300 px-3 py-2 text-xs text-emerald-700 hover:bg-emerald-50">番組で紹介した{it.guest ? '' : '（1,000ポイント付与）'}</button>
							</form>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
	{#if data.counts[data.status] > data.perPage}
		<nav aria-label="投稿のページ送り" class="mt-5 flex items-center justify-between gap-4 text-sm">
			{#if data.page > 1}<a class="underline" href={`?status=${data.status}&page=${data.page - 1}`}>前へ</a>{/if}
			<span>{data.page} / {Math.ceil(data.counts[data.status] / data.perPage)}</span>
			{#if data.page * data.perPage < data.counts[data.status]}<a class="underline" href={`?status=${data.status}&page=${data.page + 1}`}>次へ</a>{/if}
		</nav>
	{/if}
</section>
