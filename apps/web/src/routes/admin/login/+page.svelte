<script lang="ts">
	import { enhance } from '$app/forms';
	let { data, form } = $props();
	let loading = $state(false);
</script>

<div class="flex min-h-screen items-center justify-center bg-brand-900 px-4">
	<div class="w-full max-w-sm rounded-2xl bg-white p-8">
		<p class="font-display text-center text-2xl text-brand-900">山人 管理画面</p>
		<p class="mt-2 text-center text-xs text-stone-500">施設スタッフ専用。</p>

		{#if form?.message}
			<p class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{form.message}</p>
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
						autocomplete="username"
						required
						value={form?.email ?? ''}
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
				<button
					disabled={loading}
					class="w-full rounded-lg bg-brand-800 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
				>
					{loading ? 'ログイン中…' : 'ログイン'}
				</button>
			</form>
			<p class="mt-4 text-center text-[11px] text-stone-400">パスキーは正式ドメイン移行後に有効化予定です。</p>
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
