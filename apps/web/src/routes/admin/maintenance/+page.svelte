<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let copied = $state(false);
	async function copyPreview() {
		if (!data.previewLink) return;
		try {
			await navigator.clipboard.writeText(data.previewLink);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* クリップボード不可の環境は手動コピー */
		}
	}
</script>

<svelte:head><title>メンテナンスモード ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">メンテナンスモード</h1>
<p class="mb-4 text-sm text-stone-500">正式公開前・メンテナンス作業中に、一般ユーザーへサイトを非公開にします。運営（管理者・スタッフ）はログイン中ならそのまま閲覧できます。</p>

<!-- 現在の状態 -->
<div class="rounded-xl border p-4 {data.active ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-white'}">
	<div class="flex items-center gap-3">
		<span class="inline-flex h-3 w-3 rounded-full {data.active ? 'bg-amber-500' : 'bg-emerald-500'}"></span>
		<p class="text-base font-bold {data.active ? 'text-amber-800' : 'text-stone-800'}">
			{data.active ? 'メンテナンス中（一般ユーザーへ非公開）' : '公開中（通常運用）'}
		</p>
	</div>
	<p class="mt-2 text-xs text-stone-500">
		{#if data.envForced}
			環境変数 <code class="rounded bg-stone-100 px-1">MAINTENANCE_MODE=on</code> による<strong>強制 ON</strong> です。解除は環境変数を <code class="rounded bg-stone-100 px-1">off</code> に変更してください。
		{:else if data.runtimeOn}
			この画面のトグルで ON にしています。
		{:else}
			一般ユーザーは全ページを通常どおり閲覧できます。
		{/if}
	</p>
</div>

{#if form?.message}
	<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}

<!-- トグル -->
<div class="mt-4 rounded-xl border border-stone-200 bg-white p-4">
	<h2 class="text-sm font-medium text-stone-700">切替（即時）</h2>
	{#if !data.isAdmin}
		<p class="mt-2 text-sm text-stone-400">切替は管理者のみ可能です（スタッフは閲覧のみ）。</p>
	{:else if data.envForced}
		<p class="mt-2 text-sm text-stone-500">環境変数で強制 ON のため、画面からは切り替えできません。</p>
	{:else}
		<form method="POST" action="?/toggle" use:enhance class="mt-2">
			<input type="hidden" name="on" value={data.runtimeOn ? 'false' : 'true'} />
			{#if data.runtimeOn}
				<button class="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
					メンテナンスを解除して公開する
				</button>
			{:else}
				<button class="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">
					メンテナンスモードにする（一般非公開）
				</button>
			{/if}
		</form>
		<p class="mt-2 text-[11px] text-stone-400">※ このトグルは dev・デモで即時に効きます。本番（Cloudflare）で isolate を跨いで確実に制御するには、環境変数 <code class="rounded bg-stone-100 px-1">MAINTENANCE_MODE=on</code> を使ってください。</p>
	{/if}
</div>

<!-- プレビュー共有リンク -->
<div class="mt-4 rounded-xl border border-stone-200 bg-white p-4">
	<h2 class="text-sm font-medium text-stone-700">関係者へのプレビュー共有</h2>
	{#if data.previewLink}
		<p class="mt-2 text-xs text-stone-500">アカウントを持たない関係者にも、このリンクからメンテナンス中のサイトを見てもらえます（1日有効の cookie を発行）。</p>
		<div class="mt-2 flex flex-wrap items-center gap-2">
			<input readonly value={data.previewLink} class="min-w-0 flex-1 rounded-md border border-stone-300 bg-stone-50 px-2 py-1.5 text-xs text-stone-600" />
			<button type="button" onclick={copyPreview} class="rounded-md border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-100">
				{copied ? 'コピーしました' : 'コピー'}
			</button>
		</div>
	{:else}
		<p class="mt-2 text-xs text-stone-500">プレビュー共有リンクを使うには、環境変数 <code class="rounded bg-stone-100 px-1">MAINTENANCE_BYPASS_TOKEN</code> に任意のトークンを設定してください（未設定時は運営ログインのみがバイパスできます）。</p>
	{/if}
</div>

<!-- 設定方法 -->
<div class="mt-4 rounded-xl border border-stone-200 bg-white p-4 text-xs leading-relaxed text-stone-500">
	<h2 class="mb-2 text-sm font-medium text-stone-700">本番（Cloudflare Pages）での設定</h2>
	<ol class="list-decimal space-y-1 pl-4">
		<li>Pages → Settings → Environment variables を開く</li>
		<li><code class="rounded bg-stone-100 px-1">MAINTENANCE_MODE</code> = <code class="rounded bg-stone-100 px-1">on</code> を追加（解除は <code class="rounded bg-stone-100 px-1">off</code> または削除）</li>
		<li>任意：<code class="rounded bg-stone-100 px-1">MAINTENANCE_BYPASS_TOKEN</code>（プレビュー共有用）、<code class="rounded bg-stone-100 px-1">MAINTENANCE_MESSAGE</code>（ページ本文の差し替え）</li>
	</ol>
	<p class="mt-2">メンテナンス時は公開ページが HTTP 503（<code class="rounded bg-stone-100 px-1">noindex</code>・<code class="rounded bg-stone-100 px-1">Retry-After</code>）を返します。検索エンジンに「準備中」が索引されません。</p>
</div>
