<script lang="ts">
	import { enhance } from '$app/forms';
	import { renderForumBody } from '$lib/forum-format';

	let { data, form } = $props();

	const tabs = [
		{ key: 'pending', label: '申請中' },
		{ key: 'approved', label: '承認済' },
		{ key: 'rejected', label: '却下' }
	] as const;

	function go(status: string) {
		location.href = `/admin/otayori?status=${status}`;
	}

	// 却下フォームを開いている投稿ID（インライン理由入力）
	let rejectingId = $state<string | null>(null);

	function confirmApprove(e: SubmitEvent) {
		if (!confirm('このおたよりを承認し、1pt＝1,000円相当を付与します。よろしいですか？')) {
			e.preventDefault();
		}
	}
</script>

<svelte:head><title>おたより管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">おたよりポイント</h1>
<p class="mb-4 text-xs text-stone-400">YouTube 視聴者からのおたよりをレビューします。承認すると会員に1pt（＝1,000円相当）が付与されます（承認は管理者のみ）。却下・一覧閲覧はスタッフも可能です。操作は監査ログに記録されます。</p>

{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}
{#if form?.ok === 'approve'}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">おたよりを承認し、1pt を付与しました（監査ログに記録）。</p>{/if}
{#if form?.ok === 'reject'}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">おたよりを却下しました（監査ログに記録）。</p>{/if}
{#if form?.ok === 'grant'}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">おたよりポイントを手動付与しました（監査ログに記録）。</p>{/if}

<!-- 会員検索 → 手動付与（admin・設計書 §9） -->
<section class="mb-8 rounded-xl border border-stone-200 bg-white p-4">
	<h2 class="mb-1 font-medium text-stone-700">会員を検索して手動付与</h2>
	<p class="mb-3 text-xs text-stone-400">番組開始前からのおたよりポイント保持者などへ、会員ごとに付与します（管理者のみ）。1pt＝1,000円相当。正負どちらも入力できます（誤りの訂正用）。</p>

	{#if !data.isAdmin}
		<p class="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">手動付与は管理者のみ可能です（スタッフは閲覧のみ）。</p>
	{:else}
		<form method="GET" class="mb-3 flex flex-wrap gap-2 text-sm">
			<input type="hidden" name="status" value={data.status} />
			<input name="q" value={data.q} placeholder="氏名・カナ・会員番号・メールで検索" class="flex-1 rounded-md border border-stone-300 px-3 py-1.5" />
			<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-white hover:bg-brand-700">検索</button>
		</form>

		{#if data.q && data.found.length === 0}
			<p class="text-xs text-stone-400">該当する会員が見つかりませんでした。</p>
		{:else}
			<div class="space-y-2">
				{#each data.found as mem}
					<form method="POST" action="?/grant" use:enhance class="grid items-center gap-2 rounded-lg border border-stone-200 p-3 text-sm sm:grid-cols-[1fr_auto_auto_auto]">
						<input type="hidden" name="memberId" value={mem.id} />
						<div>
							<span class="font-medium">{mem.name}</span>
							<span class="text-xs text-stone-400">（{mem.memberCode}）</span>
							<span class="ml-2 text-xs text-stone-500">残高 {mem.balance.toLocaleString()}pt</span>
						</div>
						<input type="number" name="delta" placeholder="+1 / -1" class="w-24 rounded-md border border-stone-300 px-2 py-1.5" />
						<input name="reason" placeholder="理由（必須）" class="w-48 rounded-md border border-stone-300 px-2 py-1.5" />
						<button type="submit" class="rounded-md bg-brand-800 px-3 py-1.5 text-white hover:bg-brand-700">付与</button>
					</form>
				{/each}
			</div>
		{/if}
	{/if}
</section>

<!-- 投稿レビュー：タブ -->
<section class="rounded-xl border border-stone-200 bg-white p-4">
	<div class="mb-4 flex gap-1 border-b border-stone-200">
		{#each tabs as t}
			<button
				type="button"
				onclick={() => go(t.key)}
				class="border-b-2 px-4 py-2 text-sm transition {data.status === t.key
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
			{#each data.items as it}
				<div class="rounded-xl border border-stone-200 p-4">
					<div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
						<span class="tabular-nums">{it.createdAt}</span>
						<span><span class="font-mono">{it.memberCode}</span> ／ {it.memberName}</span>
						{#if it.radioName}<span class="rounded bg-stone-100 px-1.5 py-0.5">ラジオネーム: {it.radioName}</span>{/if}
					</div>
					<p class="text-sm break-words whitespace-pre-wrap text-stone-700">{@html renderForumBody(it.body)}</p>

					<div class="mt-3 flex flex-wrap items-center gap-2">
						{#if data.status === 'pending'}
							<!-- 承認（admin のみ・確認ダイアログ） -->
							{#if data.isAdmin}
								<form method="POST" action="?/approve" use:enhance onsubmit={confirmApprove}>
									<input type="hidden" name="postId" value={it.id} />
									<button class="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500">承認して1pt付与</button>
								</form>
							{:else}
								<span class="text-xs text-stone-400">承認（付与）は管理者のみ</span>
							{/if}

							<!-- 却下（staff 可・理由入力） -->
							{#if rejectingId === it.id}
								<form method="POST" action="?/reject" use:enhance class="flex flex-wrap items-center gap-2">
									<input type="hidden" name="postId" value={it.id} />
									<input name="note" placeholder="却下理由（任意）" class="w-56 rounded-md border border-stone-300 px-2 py-1.5 text-xs" />
									<button class="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">却下する</button>
									<button type="button" onclick={() => (rejectingId = null)} class="text-xs text-stone-400 hover:text-stone-600">取消</button>
								</form>
							{:else}
								<button type="button" onclick={() => (rejectingId = it.id)} class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-600 hover:bg-stone-50">却下</button>
							{/if}
						{:else if data.status === 'approved'}
							<span class="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">承認済み（1pt付与済み）</span>
						{:else}
							<span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">却下済み</span>
							<!-- 却下→再承認も可（admin・冪等付与） -->
							{#if data.isAdmin}
								<form method="POST" action="?/approve" use:enhance onsubmit={confirmApprove}>
									<input type="hidden" name="postId" value={it.id} />
									<button class="rounded-md border border-emerald-300 px-3 py-1.5 text-xs text-emerald-700 hover:bg-emerald-50">やはり承認する</button>
								</form>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>
