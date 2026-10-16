<script lang="ts">
	import { enhance } from '$lib/enhance';
	import Turnstile from '$lib/components/Turnstile.svelte';
	import { goto } from '$app/navigation';
	import { onDestroy, onMount } from 'svelte';
	let { data, form } = $props();
	let loading = $state(false);

	// ---- パスキーでログイン（パスワード不要・メールアドレス欄の候補からも選べる＝Conditional UI） ----
	let passkeyReady = $state(false);
	let passkeyBusy = $state(false);
	let passkeyMessage = $state('');
	let destroyed = false;

	async function finish(next: unknown) {
		await goto(typeof next === 'string' && next.startsWith('/admin') ? next : '/admin', { invalidateAll: true });
	}

	async function startConditional() {
		const { loginWithAdminPasskey } = await import('$lib/admin-passkey-client');
		const r = await loginWithAdminPasskey({ autofill: true });
		if (destroyed) return;
		if (r.ok) await finish(r.data?.next);
		else if (r.message) passkeyMessage = r.message;
	}

	onMount(() => {
		if (!data.passkeyEnabled) return;
		void (async () => {
			const { passkeySupported } = await import('$lib/admin-passkey-client');
			passkeyReady = await passkeySupported();
			if (passkeyReady) void startConditional();
		})();
	});
	onDestroy(() => {
		destroyed = true;
	});

	async function passkeyLogin() {
		if (passkeyBusy) return;
		passkeyBusy = true;
		passkeyMessage = '';
		try {
			const { loginWithAdminPasskey } = await import('$lib/admin-passkey-client');
			const r = await loginWithAdminPasskey();
			if (r.ok) await finish(r.data?.next);
			else {
				passkeyMessage = r.message;
				void startConditional();
			}
		} finally {
			passkeyBusy = false;
		}
	}
</script>

<div class="flex min-h-screen items-center justify-center bg-brand-900 px-4">
	<div class="w-full max-w-sm rounded-2xl bg-white p-8">
		<p class="font-display text-center text-2xl text-brand-900">山人 管理画面</p>
		<p class="mt-2 text-center text-xs text-stone-500">施設スタッフ専用。</p>

		{#if form?.message}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{form.message}</p>
		{/if}
		{#if passkeyMessage}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700" role="alert">{passkeyMessage}</p>
		{/if}

		{#if data.authMode === 'supabase'}
			<!-- Supabase Auth（email+パスワード） -->
			<form
				method="POST"
				action="?/login"
				class="mt-6 space-y-3"
				use:enhance={() => {
					loading = true;
					return async ({ update }) => {
						await update();
						loading = false;
					};
				}}
			>
				<label class="block text-sm">
					<span class="text-stone-600">メールアドレス</span>
					<input
						name="email"
						type="email"
						autocomplete={data.passkeyEnabled ? 'username webauthn' : 'username'}
						required
						value={(form as { email?: string } | null)?.email ?? ''}
						class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none"
					/>
				</label>
				<label class="block text-sm">
					<span class="text-stone-600">パスワード</span>
					<input
						name="password"
						type="password"
						autocomplete="current-password"
						required
						class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm focus:border-brand-700 focus:outline-none"
					/>
				</label>
				<Turnstile action="admin-login" />
				<button
					disabled={loading}
					class="w-full rounded-lg bg-brand-800 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
				>
					{loading ? 'ログイン中…' : 'ログイン'}
				</button>
			</form>
			{#if passkeyReady}
				<div class="mt-4 flex items-center gap-3 text-[11px] text-stone-400">
					<span class="h-px flex-1 bg-stone-200"></span>または<span class="h-px flex-1 bg-stone-200"></span>
				</div>
				<button
					type="button"
					onclick={() => void passkeyLogin()}
					disabled={passkeyBusy}
					class="mt-4 w-full rounded-lg border border-brand-800 py-2.5 text-sm font-medium text-brand-800 hover:bg-brand-50 disabled:opacity-60"
				>
					{passkeyBusy ? '確認しています…' : '🔑 パスキーでログイン'}
				</button>
				<p class="mt-2 text-center text-[11px] text-stone-500">
					パスキーは「二段階認証・パスキー」の画面で登録できます。パスワードでのログインも引き続き使えます。
				</p>
			{/if}
		{:else}
			<!-- デモ：ワンクリックログイン（dev・移行前のみ） -->
			<p class="mt-2 text-center text-[11px] text-amber-600">デモモード（AUTH_MODE=demo）。本番は Supabase Auth に切り替わります。</p>
			<form method="POST" class="mt-6 space-y-3">
				<button formaction="?/admin" class="w-full rounded-lg bg-brand-800 py-2.5 text-sm font-medium text-white hover:bg-brand-700">
					管理者としてログイン（デモ）
				</button>
				<button formaction="?/staff" class="w-full rounded-lg border border-stone-300 py-2.5 text-sm hover:bg-stone-50">
					スタッフとしてログイン（デモ・閲覧のみ）
				</button>
			</form>
		{/if}

		<a href="/" class="mt-6 block text-center text-xs text-stone-400 hover:underline">← 顧客サイトへ戻る</a>
	</div>
</div>
