<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let loading = $state(false);
	// 選ばれている認証アプリ（ふつうは 1 つ）
	let factorId = $state('');
	$effect(() => {
		if (!factorId && data.factors.length > 0) factorId = data.factors[0].id;
	});
</script>

<svelte:head><title>二段階認証 ｜ 山人管理</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-brand-900 px-4">
	<div class="w-full max-w-sm rounded-2xl bg-white p-8">
		<p class="font-display text-center text-2xl text-brand-900">山人 管理画面</p>
		<p class="mt-2 text-center text-sm text-stone-600">認証アプリに表示されている 6 桁の数字を入力してください。</p>

		{#if form?.message}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{form.message}</p>
		{/if}
		{#if data.loadError}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{data.loadError}</p>
		{/if}

		<form
			method="POST"
			action="?/verify"
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
			<input type="hidden" name="next" value={data.next} />
			{#if data.factors.length > 1}
				<label class="block text-sm">
					<span class="text-stone-600">認証アプリ</span>
					<select name="factorId" bind:value={factorId} class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm">
						{#each data.factors as f (f.id)}
							<option value={f.id}>{f.friendlyName ?? '認証アプリ'}</option>
						{/each}
					</select>
				</label>
			{:else}
				<input type="hidden" name="factorId" value={factorId} />
			{/if}
			<input
				name="code"
				inputmode="numeric"
				autocomplete="one-time-code"
				maxlength="8"
				required
				placeholder="123456"
				aria-label="6 桁のコード"
				class="w-full rounded-lg border border-stone-300 px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] focus:border-brand-700 focus:outline-none"
			/>
			<button
				disabled={loading || data.factors.length === 0}
				class="w-full rounded-lg bg-brand-800 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
			>
				{loading ? '確認中…' : '確認する'}
			</button>
		</form>

		<p class="mt-4 text-center text-[11px] text-stone-500">
			スマートフォンを失くしたときは、別の管理者に「二段階認証」画面から登録の削除を頼んでください。
		</p>
		<form method="POST" action="/auth/logout" class="mt-3 text-center" data-no-guard>
			<button type="submit" class="text-xs text-stone-400 underline hover:text-stone-600">ログアウト</button>
		</form>
	</div>
</div>
