<script lang="ts">
	import { enhance } from '$lib/enhance';
	let { data, form } = $props();
	let loading = $state(false);
</script>

<svelte:head><title>パスワードの再設定 ｜ 山人管理</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-brand-900 px-4">
	<div class="w-full max-w-sm rounded-2xl bg-white p-8">
		<p class="font-display text-center text-2xl text-brand-900">山人 管理画面</p>
		<p class="mt-2 text-center text-sm text-stone-600">新しいパスワードを決めてください。</p>

		{#if form?.message}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{form.message}</p>
		{/if}

		{#if !data.tokenHash}
			<p class="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">リンクが正しくありません。メールのリンクから開いてください。</p>
		{:else}
			<form
				method="POST"
				class="mt-6 space-y-3"
				data-no-guard
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						await update();
						loading = false;
					};
				}}
			>
				<input type="hidden" name="tokenHash" value={data.tokenHash} />
				<label class="block text-sm">
					<span class="text-stone-600">新しいパスワード（{data.minPassword}文字以上・英字と数字を含む）</span>
					<input name="password" type="password" required minlength={data.minPassword} autocomplete="new-password" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm" />
				</label>
				<label class="block text-sm">
					<span class="text-stone-600">もう一度</span>
					<input name="confirm" type="password" required minlength={data.minPassword} autocomplete="new-password" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm" />
				</label>
				<button disabled={loading} class="w-full rounded-lg bg-brand-800 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
					{loading ? '変更しています…' : 'パスワードを変える'}
				</button>
			</form>
		{/if}
		<a href="/admin/login" class="mt-6 block text-center text-xs text-stone-400 hover:underline">← ログイン画面へ</a>
	</div>
</div>
