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
		{:else if data.toggleOn}
			この画面のトグルで ON にしています。下のボタンで解除できます。
		{:else}
			一般ユーザーは全ページを通常どおり閲覧できます。
		{/if}
	</p>
	{#if !data.durable}
		<p class="mt-2 rounded bg-stone-100 px-2 py-1 text-[11px] text-stone-500">
			※ いまは KV 未接続（dev / プレビュー）のため、トグルはこのプロセス内のみ有効です。本番（Cloudflare・KV 接続済み）では全 edge に反映され永続します。
		</p>
	{/if}
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
			<input type="hidden" name="on" value={data.toggleOn ? 'false' : 'true'} />
			{#if data.toggleOn}
				<button class="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
					メンテナンスを解除して公開する
				</button>
			{:else}
				<button class="rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">
					メンテナンスモードにする（一般非公開）
				</button>
			{/if}
		</form>
		<p class="mt-2 text-[11px] text-stone-400">
			{#if data.durable}
				切替は Cloudflare KV に保存され、数十秒以内に全 edge へ反映されます。緊急時は環境変数 <code class="rounded bg-stone-100 px-1">MAINTENANCE_MODE=on</code> で強制 ON にもできます。
			{:else}
				本番（Cloudflare）では切替が KV に保存され全 edge に反映されます。
			{/if}
		</p>
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

<!-- 補足 -->
<div class="mt-4 rounded-xl border border-stone-200 bg-white p-4 text-xs leading-relaxed text-stone-500">
	<h2 class="mb-2 text-sm font-medium text-stone-700">仕組みと補足</h2>
	<ul class="list-disc space-y-1 pl-4">
		<li>通常はこの画面のトグルで切替（保存先は Cloudflare KV・<code class="rounded bg-stone-100 px-1">AB_CONFIG</code>）。全 edge に共有・永続します。</li>
		<li>メンテナンス時、公開ページは HTTP 503（<code class="rounded bg-stone-100 px-1">noindex</code>・<code class="rounded bg-stone-100 px-1">Retry-After</code>）を返し、検索エンジンに「準備中」が索引されません。</li>
		<li>緊急の強制 ON：Pages → Settings → Environment variables で <code class="rounded bg-stone-100 px-1">MAINTENANCE_MODE</code> = <code class="rounded bg-stone-100 px-1">on</code>（このときトグルでは解除不可）。</li>
		<li>任意の環境変数：<code class="rounded bg-stone-100 px-1">MAINTENANCE_BYPASS_TOKEN</code>（プレビュー共有用）、<code class="rounded bg-stone-100 px-1">MAINTENANCE_MESSAGE</code>（ページ本文の差し替え）。</li>
	</ul>
</div>
