<script lang="ts">
	import AutumnBookLogo from '$lib/components/admin/AutumnBookLogo.svelte';
	import { enhance } from '$lib/enhance';
	import { goto } from '$app/navigation';
	let { data, form } = $props();
	let loading = $state(false);

	// パスキーで確認する
	let passkeyBusy = $state(false);
	let passkeyMessage = $state('');
	async function passkeyStepUp() {
		if (passkeyBusy) return;
		passkeyBusy = true;
		passkeyMessage = '';
		try {
			const { stepUpWithAdminPasskey } = await import('$lib/admin-passkey-client');
			const r = await stepUpWithAdminPasskey(data.next);
			if (r.ok) {
				const next = r.data?.next;
				await goto(typeof next === 'string' && next.startsWith('/admin') ? next : '/admin', { invalidateAll: true });
			} else passkeyMessage = r.message;
		} finally {
			passkeyBusy = false;
		}
	}
	// 選ばれている認証アプリ（ふつうは 1 つ）
	let factorId = $state('');
	$effect(() => {
		if (!factorId && data.factors.length > 0) factorId = data.factors[0].id;
	});
</script>

<svelte:head><title>二段階認証 ｜ 山人管理</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-brand-900 px-4">
	<div class="w-full max-w-sm rounded-2xl bg-white p-8">
		<div class="flex justify-center"><AutumnBookLogo class="h-auto w-full max-w-[260px]" /></div>
		<p class="mt-3 text-center text-sm text-stone-600">管理画面</p>
		<p class="mt-2 text-center text-sm text-stone-600">
			{#if data.factors.length > 0 && data.passkey.usable}
				パスキー、または認証アプリの 6 桁の数字で本人確認をしてください。
			{:else if data.factors.length > 0}
				認証アプリに表示されている 6 桁の数字を入力してください。
			{:else}
				登録したパスキーで本人確認をしてください。
			{/if}
		</p>

		{#if form?.message}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{form.message}</p>
		{/if}
		{#if data.loadError}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{data.loadError}</p>
		{/if}
		{#if passkeyMessage}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700" role="alert">{passkeyMessage}</p>
		{/if}

		{#if data.passkey.usable}
			<button
				type="button"
				onclick={() => void passkeyStepUp()}
				disabled={passkeyBusy}
				class="mt-6 w-full rounded-lg bg-brand-800 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
			>
				{passkeyBusy ? '確認しています…' : '🔑 パスキーで確認する'}
			</button>
		{:else if data.passkey.count > 0 && data.factors.length === 0}
			<p class="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-center text-sm text-amber-800">
				このアドレスではパスキーを使えません。https://book.yamado.app/admin から開き直してください。
			</p>
		{/if}

		{#if data.factors.length > 0}
		{#if data.passkey.usable}
			<div class="mt-5 flex items-center gap-3 text-[11px] text-stone-400">
				<span class="h-px flex-1 bg-stone-200"></span>または認証アプリのコード<span class="h-px flex-1 bg-stone-200"></span>
			</div>
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
				class="w-full rounded-lg py-2.5 text-sm font-medium disabled:opacity-60 {data.passkey.usable
					? 'border border-brand-800 text-brand-800 hover:bg-brand-50'
					: 'bg-brand-800 text-white hover:bg-brand-700'}"
			>
				{loading ? '確認中…' : '確認する'}
			</button>
		</form>
		{/if}

		<p class="mt-4 text-center text-[11px] text-stone-500">
			スマートフォン・パスキーを失くしたときは、別の管理者に「二段階認証・パスキー」画面から登録の削除を頼んでください。
		</p>
		<form method="POST" action="/auth/logout" class="mt-3 text-center" data-no-guard>
			<button type="submit" class="text-xs text-stone-400 underline hover:text-stone-600">ログアウト</button>
		</form>
	</div>
</div>
