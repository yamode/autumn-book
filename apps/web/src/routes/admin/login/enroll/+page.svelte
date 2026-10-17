<script lang="ts">
	// スマホ用の登録 QR の着地点（2026-10-17）。PC の「二段階認証・パスキー」で出した QR をスマホで読むと開く。
	// このスマホにパスキーを作り、そのあと「パスキーでログイン」で入る（パスワード不要・二段階認証も済んだ扱い）。
	import { onMount } from 'svelte';
	import AutumnBookLogo from '$lib/components/admin/AutumnBookLogo.svelte';

	let { data } = $props();
	let supported = $state<boolean | null>(null);
	let busy = $state(false);
	let message = $state('');
	let done = $state('');
	let name = $state('');

	onMount(() => {
		void import('$lib/admin-passkey-client').then(async (m) => (supported = await m.passkeySupported()));
		// QR の中身を URL（履歴）に残さない
		if (data.t) history.replaceState(history.state, '', '/admin/login/enroll');
	});

	async function enroll() {
		if (busy || !data.t) return;
		busy = true;
		message = '';
		try {
			const { enrollAdminPasskey } = await import('$lib/admin-passkey-client');
			const r = await enrollAdminPasskey(data.t, name);
			if (r.ok) done = String((r.data?.passkey as { name?: string } | undefined)?.name ?? 'パスキー');
			else message = r.message;
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>スマホにパスキーを登録 ｜ 山人管理</title></svelte:head>

<div class="flex min-h-screen items-center justify-center bg-brand-900 px-4">
	<div class="w-full max-w-sm rounded-2xl bg-white p-8">
		<div class="flex justify-center"><AutumnBookLogo class="h-auto w-full max-w-[260px]" /></div>
		<p class="mt-3 text-center text-sm text-stone-600">管理画面</p>
		<h1 class="mt-2 text-center text-base font-semibold text-stone-800">このスマホにパスキーを登録</h1>

		{#if done}
			<p class="mt-5 rounded-lg bg-emerald-50 px-3 py-3 text-sm leading-relaxed text-emerald-800">
				登録しました（{done}）。このスマホでは、ログイン画面の「🔑 パスキーでログイン」からパスワードなしで入れます。
			</p>
			<a href="/admin/login" class="mt-4 block w-full rounded-lg bg-brand-800 py-2.5 text-center text-sm font-medium text-white hover:bg-brand-700">ログイン画面へ</a>
		{:else if !data.available}
			<p class="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">このページのアドレスではパスキーを使えません。book.yamado.app で開いてください。</p>
		{:else if !data.owner}
			<p class="mt-5 rounded-lg bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-800">
				この QR は使えません（10 分を過ぎた・使用済み・新しい QR を出した のどれか）。PC の管理画面「二段階認証・パスキー」で QR を出し直してください。
			</p>
		{:else}
			<p class="mt-4 text-sm leading-relaxed text-stone-600">
				<b class="text-stone-800">{data.owner.name || data.owner.email}</b>
				{#if data.owner.name}<span class="text-stone-400">（{data.owner.email}）</span>{/if}
				のパスキーを、このスマホに作ります。ボタンを押すと顔認証・指紋・画面ロックの確認が出ます。
			</p>
			<label class="mt-4 block text-sm">
				<span class="text-stone-600">名前（任意・例: 自分の iPhone）</span>
				<input bind:value={name} maxlength="60" class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm" />
			</label>
			{#if message}
				<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>
			{/if}
			{#if supported === false}
				<p class="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">このブラウザはパスキーに対応していません。Safari か Chrome で開いてください。</p>
			{/if}
			<button
				type="button"
				onclick={enroll}
				disabled={busy || supported === false}
				class="mt-4 w-full rounded-lg bg-brand-800 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
			>
				{busy ? '登録しています…' : '🔑 このスマホにパスキーを登録する'}
			</button>
			<p class="mt-3 text-xs leading-relaxed text-stone-400">この QR は 10 分間・1 回だけ使えます。心当たりが無い場合は登録せず閉じてください。</p>
		{/if}
		<a href="/admin/login" class="mt-6 block text-center text-xs text-stone-400 hover:underline">← ログイン画面へ</a>
	</div>
</div>
