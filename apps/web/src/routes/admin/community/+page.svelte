<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	// 新規板追加フォームのトグル
	let showNewBoard = $state(false);

	function selectBoard(id: string) {
		location.href = `/admin/community?board=${id}`;
	}
	function selectThread(boardId: string, threadId: string) {
		location.href = `/admin/community?board=${boardId}&thread=${threadId}`;
	}
</script>

<svelte:head><title>コミュニティ管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">コミュニティ掲示板</h1>
<p class="mb-4 text-xs text-stone-400">板の管理（管理者のみ）・スレッドの pin / lock / 削除・投稿削除・会員の ban を行います。操作は監査ログに記録されます。</p>

{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}
{#if form?.ok}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">操作を反映しました。</p>{/if}

<!-- ① 板管理（admin のみ） -->
<section class="mb-8 rounded-xl border border-stone-200 bg-white p-4">
	<div class="mb-3 flex items-center justify-between">
		<h2 class="font-medium text-stone-700">① 板管理</h2>
		{#if data.isAdmin}
			<button type="button" onclick={() => (showNewBoard = !showNewBoard)} class="rounded-md bg-accent-600 px-3 py-1.5 text-xs text-white hover:bg-accent-500">＋ 新しい板</button>
		{/if}
	</div>

	{#if !data.isAdmin}
		<p class="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-500">板の作成・編集・アーカイブは管理者のみ可能です（スタッフは閲覧のみ）。</p>
	{/if}

	{#if data.isAdmin && showNewBoard}
		<form method="POST" action="?/upsertBoard" use:enhance class="mb-4 grid gap-2 rounded-lg border border-dashed border-stone-300 p-3 text-sm sm:grid-cols-2">
			<input name="slug" placeholder="slug（例: free）" class="rounded-md border border-stone-300 px-2 py-1.5" />
			<input name="title" placeholder="タイトル" class="rounded-md border border-stone-300 px-2 py-1.5" />
			<input name="description" placeholder="説明" class="rounded-md border border-stone-300 px-2 py-1.5 sm:col-span-2" />
			<input name="sortOrder" type="number" value="0" placeholder="並び順" class="rounded-md border border-stone-300 px-2 py-1.5" />
			<label class="flex items-center gap-1.5 text-xs"><input type="checkbox" name="isArchived" class="h-4 w-4" /> アーカイブ</label>
			<button type="submit" class="rounded-md bg-brand-800 px-4 py-1.5 text-xs text-white hover:bg-brand-700 sm:col-span-2">追加する</button>
		</form>
	{/if}

	<div class="space-y-2">
		{#each data.boards as b}
			<div class="rounded-lg border border-stone-200 {b.id === data.selectedBoardId ? 'ring-1 ring-brand-300' : ''}">
				{#if data.isAdmin}
					<form method="POST" action="?/upsertBoard" use:enhance class="grid gap-2 p-3 text-sm sm:grid-cols-2">
						<input type="hidden" name="id" value={b.id} />
						<input name="slug" value={b.slug} class="rounded-md border border-stone-300 px-2 py-1.5" />
						<input name="title" value={b.title} class="rounded-md border border-stone-300 px-2 py-1.5" />
						<input name="description" value={b.description} class="rounded-md border border-stone-300 px-2 py-1.5 sm:col-span-2" />
						<input name="sortOrder" type="number" value={b.sortOrder} class="w-24 rounded-md border border-stone-300 px-2 py-1.5" />
						<div class="flex items-center gap-3">
							<label class="flex items-center gap-1.5 text-xs"><input type="checkbox" name="isArchived" checked={b.isArchived} class="h-4 w-4" /> アーカイブ</label>
							<button type="submit" class="rounded-md bg-brand-800 px-3 py-1.5 text-xs text-white hover:bg-brand-700">保存</button>
							<button type="button" onclick={() => selectBoard(b.id)} class="text-xs text-accent-600 hover:underline">この板のスレを操作 →</button>
						</div>
					</form>
				{:else}
					<div class="flex items-center justify-between gap-3 p-3 text-sm">
						<span><span class="font-medium">{b.title}</span> <span class="text-xs text-stone-400">/{b.slug}{b.isArchived ? '（アーカイブ）' : ''}</span></span>
						<button type="button" onclick={() => selectBoard(b.id)} class="text-xs text-accent-600 hover:underline">この板のスレを操作 →</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>
</section>

<!-- ② スレ操作 -->
<section class="mb-8 rounded-xl border border-stone-200 bg-white p-4">
	<div class="mb-3 flex flex-wrap items-center gap-3">
		<h2 class="font-medium text-stone-700">② スレッド操作</h2>
		<select class="rounded-md border border-stone-300 px-2 py-1.5 text-sm" onchange={(e) => selectBoard(e.currentTarget.value)}>
			{#each data.boards as b}
				<option value={b.id} selected={b.id === data.selectedBoardId}>{b.title}</option>
			{/each}
		</select>
	</div>

	{#if data.threads.length === 0}
		<p class="text-xs text-stone-400">この板にはスレッドがありません。</p>
	{:else}
		<table class="w-full text-sm">
			<thead><tr class="border-b border-stone-200 text-left text-xs text-stone-400">
				<th class="py-1.5">タイトル</th><th>投稿数</th><th>操作</th><th>投稿削除</th>
			</tr></thead>
			<tbody>
				{#each data.threads as t}
					<tr class="border-b border-stone-100 {t.isDeleted ? 'opacity-40' : ''}">
						<td class="py-2 pr-2">
							{#if t.isPinned}📌 {/if}{#if t.isLocked}🔒 {/if}{#if t.isDeleted}🗑 {/if}{t.title}
						</td>
						<td class="tabular-nums text-stone-500">{t.replyCount}</td>
						<td class="py-2">
							<div class="flex flex-wrap gap-1">
								<form method="POST" action="?/moderateThread" use:enhance>
									<input type="hidden" name="threadId" value={t.id} /><input type="hidden" name="field" value="pin" />
									<button class="rounded border border-stone-300 px-2 py-0.5 text-xs hover:bg-stone-50">{t.isPinned ? 'pin解除' : 'pin'}</button>
								</form>
								<form method="POST" action="?/moderateThread" use:enhance>
									<input type="hidden" name="threadId" value={t.id} /><input type="hidden" name="field" value="lock" />
									<button class="rounded border border-stone-300 px-2 py-0.5 text-xs hover:bg-stone-50">{t.isLocked ? 'lock解除' : 'lock'}</button>
								</form>
								<form method="POST" action="?/moderateThread" use:enhance>
									<input type="hidden" name="threadId" value={t.id} /><input type="hidden" name="field" value="delete" />
									<button class="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">{t.isDeleted ? '復元' : '削除'}</button>
								</form>
							</div>
						</td>
						<td class="py-2">
							<button type="button" onclick={() => selectThread(data.selectedBoardId, t.id)} class="text-xs text-accent-600 hover:underline">投稿を見る →</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>

<!-- ③ 投稿削除 -->
{#if data.selectedThreadId}
	<section class="mb-8 rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="mb-3 font-medium text-stone-700">③ 投稿削除 — {data.selectedThreadTitle}</h2>
		<div class="space-y-1">
			{#each data.posts as p}
				<div class="flex items-start gap-3 border-b border-stone-100 py-2 text-sm {p.isDeleted ? 'opacity-40' : ''}">
					<span class="w-8 shrink-0 font-mono text-xs text-stone-400">#{p.postNo}</span>
					<span class="shrink-0 text-xs text-stone-500">{p.nickname ?? '—'}{#if p.isStaff} <span class="rounded bg-brand-800 px-1 text-[10px] text-white">運営</span>{/if}</span>
					<span class="min-w-0 flex-1 break-words text-stone-700">{p.isDeleted ? '（削除済み）' : p.body}</span>
					{#if !p.isDeleted}
						<form method="POST" action="?/deletePost" use:enhance class="shrink-0">
							<input type="hidden" name="postId" value={p.id} />
							<button class="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50">削除</button>
						</form>
					{/if}
				</div>
			{/each}
		</div>
	</section>
{/if}

<!-- ④ ban 管理 -->
<section class="rounded-xl border border-stone-200 bg-white p-4">
	<h2 class="mb-3 font-medium text-stone-700">④ ban 管理</h2>
	<p class="mb-3 text-xs text-stone-400">ban された会員は閲覧のみ可能になり、投稿時にエラーになります。表示はニックネームのみ（実名・メールは表示しません）。</p>
	<table class="w-full text-sm">
		<thead><tr class="border-b border-stone-200 text-left text-xs text-stone-400">
			<th class="py-1.5">ニックネーム</th><th>ロール</th><th>状態</th><th>操作</th>
		</tr></thead>
		<tbody>
			{#each data.profiles as p}
				<tr class="border-b border-stone-100">
					<td class="py-2">{p.nickname}</td>
					<td class="text-xs text-stone-500">{p.role === 'admin' ? '管理者' : p.role === 'staff' ? 'スタッフ' : '会員'}</td>
					<td>
						{#if p.isBanned}<span class="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700">ban中</span>{:else}<span class="text-xs text-stone-400">—</span>{/if}
					</td>
					<td class="py-2">
						{#if p.role === 'member'}
							<form method="POST" action="?/toggleBan" use:enhance>
								<input type="hidden" name="userId" value={p.userId} />
								<input type="hidden" name="banned" value={p.isBanned ? 'false' : 'true'} />
								<button class="rounded border px-2 py-0.5 text-xs {p.isBanned ? 'border-stone-300 hover:bg-stone-50' : 'border-red-200 text-red-600 hover:bg-red-50'}">{p.isBanned ? 'ban 解除' : 'ban する'}</button>
							</form>
						{:else}
							<span class="text-xs text-stone-300">—</span>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>
