<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	import ConfirmPanel from '$lib/components/admin/ConfirmPanel.svelte';
	import Unavailable from '$lib/components/admin/Unavailable.svelte';
	import { DEEP_LINK_PRESETS } from '$lib/admin-deep-links';

	let { data, form } = $props();

	const RANKS = ['standard', 'silver', 'gold', 'platinum'];

	// /admin/news の「アプリに通知する」からのプリフィル
	const q = page.url.searchParams;

	let type = $state(q.get('type') ?? 'news');
	let title = $state(q.get('title') ?? '');
	let body = $state('');
	let url = $state(q.get('url') ?? '/news');
	let mode = $state('all');
	let ranks = $state<string[]>([]);
	let schedule = $state('now');
	let scheduledAt = $state('');
	let confirming = $state(false);
	let clientToken = $state(crypto.randomUUID());

	// 内容が変わったらテスト済みを無効に戻す（別の文面を無検証で送らせない）
	const fingerprint = $derived(`${type}|${title}|${body}|${url}`);
	const tested = $derived(form?.tested === true && form?.fingerprint === fingerprint);

	const targetCount = $derived(mode === 'all' ? data.memberCount : null);
	const canConfirm = $derived(tested && title.trim().length > 0);
</script>

<svelte:head><title>新しい通知 ｜ 山人管理</title></svelte:head>

<a href="/admin/push" class="text-xs text-stone-400 underline">← アプリ通知</a>
<h1 class="mt-1 mb-4 text-lg font-bold text-stone-800">新しい通知</h1>

{#if data.unavailable}
	<Unavailable authMode={data.authMode} dataSource={data.dataSource} />
{:else if data.user?.role !== 'admin'}
	<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-500">
		通知の送信は管理者のみ行えます。
	</div>
{:else}
	{#if form?.message}
		<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
			{form.message}
		</div>
	{/if}

	<div class="max-w-3xl space-y-4">
		<!-- 本文 -->
		<div class="rounded-xl border border-stone-200 bg-white p-4">
			<div class="mb-3 flex flex-wrap gap-4 text-sm">
				<span class="text-xs text-stone-500">種別</span>
				{#each [['news', 'お知らせ'], ['coupon', 'クーポン'], ['custom', 'その他']] as [v, label]}
					<label class="flex items-center gap-1">
						<input type="radio" value={v} bind:group={type} />
						{label}
					</label>
				{/each}
			</div>

			<label class="block text-sm">
				<span class="mb-1 block text-xs text-stone-500">タイトル *（{title.length}/60）</span>
				<input
					bind:value={title}
					maxlength="60"
					required
					class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
					placeholder="秋のプランを公開しました"
				/>
			</label>

			<label class="mt-3 block text-sm">
				<span class="mb-1 block text-xs text-stone-500">本文（{body.length}/200）</span>
				<textarea
					bind:value={body}
					maxlength="200"
					rows="2"
					class="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
					placeholder="紅葉シーズンの新プランをアプリでご覧いただけます。"
				></textarea>
			</label>

			<div class="mt-3 flex flex-wrap items-end gap-2">
				<label class="text-sm">
					<span class="mb-1 block text-xs text-stone-500">タップ先</span>
					<select
						value={url}
						onchange={(e) => (url = e.currentTarget.value)}
						class="rounded-md border border-stone-300 px-2 py-2 text-sm"
					>
						{#each DEEP_LINK_PRESETS as p}
							<option value={p.url}>{p.label}（{p.url}）</option>
						{/each}
					</select>
				</label>
				<label class="flex-1 text-sm">
					<span class="mb-1 block text-xs text-stone-500">またはパス</span>
					<input
						bind:value={url}
						class="w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm"
						placeholder="/news/9f1a..."
					/>
				</label>
			</div>
			<p class="mt-1 text-xs text-stone-400">
				アプリ内のパスのみ（/ 始まり）。外部 URL はアプリ側で無視されます。
			</p>

			<!-- プレビュー -->
			<div class="mt-4 rounded-xl border border-stone-200 bg-stone-100 p-3">
				<p class="mb-1 text-xs text-stone-400">プレビュー</p>
				<div class="rounded-xl bg-white p-3 shadow-sm">
					<p class="text-xs text-stone-400">🏔 YAMADO　いま</p>
					<p class="mt-0.5 text-sm font-bold text-stone-800">{title || '（タイトル）'}</p>
					{#if body}<p class="text-sm text-stone-600">{body}</p>{/if}
				</div>
			</div>
		</div>

		<!-- 宛先 -->
		<div class="rounded-xl border border-stone-200 bg-white p-4">
			<p class="mb-2 text-xs text-stone-500">宛先 *</p>
			<label class="flex items-center gap-2 text-sm">
				<input type="radio" value="all" bind:group={mode} />
				全会員（{data.memberCount} 名・うち push 受信可能 {data.pushCapable} 名）
			</label>
			<label class="mt-2 flex items-center gap-2 text-sm">
				<input type="radio" value="rank" bind:group={mode} /> ランク指定
			</label>
			{#if mode === 'rank'}
				<div class="mt-2 ml-6 flex flex-wrap gap-3">
					{#each RANKS as r}
						<label class="flex items-center gap-1 text-sm">
							<input type="checkbox" value={r} bind:group={ranks} />
							{r}
						</label>
					{/each}
				</div>
			{/if}

			<p class="mt-4 mb-2 text-xs text-stone-500">配信日時</p>
			<label class="flex items-center gap-2 text-sm">
				<input type="radio" value="now" bind:group={schedule} />
				今すぐ（2 分以内に送信・<strong class="text-stone-700">取り消し不可</strong>）
			</label>
			<label class="mt-2 flex flex-wrap items-center gap-2 text-sm">
				<input type="radio" value="later" bind:group={schedule} /> 予約
				<input
					type="datetime-local"
					bind:value={scheduledAt}
					disabled={schedule !== 'later'}
					class="rounded-md border border-stone-300 px-2 py-1.5 text-sm"
				/>
				<span class="text-xs text-stone-400">（JST・送信開始まで一覧から取り消せます）</span>
			</label>
		</div>

		<!-- 1. テスト送信 -->
		<form method="POST" action="?/test" use:enhance class="rounded-xl border border-stone-200 bg-white p-4">
			<input type="hidden" name="type" value={type} />
			<input type="hidden" name="title" value={title} />
			<input type="hidden" name="body" value={body} />
			<input type="hidden" name="url" value={url} />
			<input type="hidden" name="fingerprint" value={fingerprint} />

			<p class="mb-2 text-sm font-bold text-stone-700">1. テスト送信</p>
			{#if (data.testRecipients ?? []).length === 0}
				<p class="text-sm text-amber-700">
					テスト受信者（メールが @yamado.co.jp の会員）が見つかりません。社内アカウントでアプリにログインしてから実行してください。
				</p>
			{:else}
				<div class="flex flex-wrap gap-3">
					{#each data.testRecipients as m}
						<label class="flex items-center gap-1 text-sm">
							<input type="checkbox" name="testIds" value={m.user_id} checked />
							{m.name ?? m.email ?? m.member_code}
						</label>
					{/each}
				</div>
				<button
					type="submit"
					disabled={!title.trim()}
					class="mt-3 rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 disabled:opacity-40"
				>
					テスト受信者に送る
				</button>
			{/if}
			{#if tested}
				<p class="mt-2 text-sm text-emerald-700">
					✔ テスト送信済み（{form?.testedCount} 件）。実機で表示とタップ先を確認してください。
				</p>
			{:else if form?.tested}
				<p class="mt-2 text-sm text-amber-700">
					内容が変わりました。もう一度テスト送信してください。
				</p>
			{/if}
		</form>

		<!-- 2. 本番送信 -->
		<div class="rounded-xl border border-stone-200 bg-white p-4">
			<p class="mb-2 text-sm font-bold text-stone-700">2. 本番送信</p>

			{#if !confirming}
				<button
					type="button"
					disabled={!canConfirm}
					onclick={() => (confirming = true)}
					class="bg-accent-600 rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
				>
					内容を確認する
				</button>
				{#if !tested}
					<p class="mt-2 text-xs text-amber-700">テスト送信が済むまで本番送信はできません。</p>
				{/if}
			{:else}
				<form method="POST" action="?/send" use:enhance>
					<input type="hidden" name="type" value={type} />
					<input type="hidden" name="title" value={title} />
					<input type="hidden" name="body" value={body} />
					<input type="hidden" name="url" value={url} />
					<input type="hidden" name="mode" value={mode} />
					<input type="hidden" name="clientToken" value={clientToken} />
					{#each ranks as r}<input type="hidden" name="ranks" value={r} />{/each}
					{#if schedule === 'later'}
						<input type="hidden" name="scheduledAt" value={scheduledAt} />
					{/if}

					<ConfirmPanel
						message={`${mode === 'all' ? `全会員 ${data.memberCount} 名` : `ランク指定（${ranks.join(', ') || '未選択'}）`}に「${title}」を ${schedule === 'later' ? scheduledAt : '今すぐ'} 送信します。送信後の取り消しはできません。`}
						requireCount={mode === 'all' ? targetCount : null}
						confirmLabel="送信する"
						submit
						oncancel={() => (confirming = false)}
					/>
				</form>
			{/if}
		</div>
	</div>
{/if}
