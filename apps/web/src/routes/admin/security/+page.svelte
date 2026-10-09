<script lang="ts">
	import { enhance } from '$app/forms';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';

	let { data, form } = $props();

	type EnrollState = { factorId: string; qrCode: string; secret: string; friendlyName: string };
	// 登録の途中（QR を表示中）。action の戻り値から取り出す
	let enrolling = $derived(((form as { enroll?: EnrollState } | null)?.enroll ?? null) as EnrollState | null);
	let busy = $state(false);

	const fmt = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }) : '—';

	const submitting = () => {
		busy = true;
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head><title>二段階認証 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">二段階認証</h1>
<p class="mb-4 text-sm text-stone-500">
	ログインのとき、パスワードに加えてスマートフォンの認証アプリ（Google Authenticator・Microsoft Authenticator・1Password など）に出る
	6 桁の数字を入力します。パスワードが漏れても、スマートフォンが無ければ管理画面に入れません。
</p>

{#if !data.available}
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
		<p class="font-bold">この環境では二段階認証は使えません</p>
		<p class="mt-2">ローカルのデモ（AUTH_MODE=demo）では Supabase のログインを使わないため、登録できません。本番（AUTH_MODE=supabase）でお使いください。</p>
	</div>
{:else}
	{#if data.required && data.factors.length === 0}
		<div class="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
			<p class="font-bold">二段階認証の登録が必要です</p>
			<p class="mt-1">登録が終わるまで、管理画面のほかの画面は開けません。下の「登録を始める」から進めてください。</p>
		</div>
	{:else if data.enrollRequested && data.factors.length === 0}
		<div class="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">下の「登録を始める」から進めてください。</div>
	{/if}

	{#if form?.message}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
	{/if}
	{#if (form as { verified?: boolean } | null)?.verified}
		<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
			二段階認証を有効にしました。次回のログインから、パスワードのあとに認証アプリのコードを入力します。
		</p>
	{/if}
	{#if (form as { removed?: boolean } | null)?.removed}
		<p class="mb-4 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">登録を削除しました。</p>
	{/if}
	{#if data.loadError}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.loadError}</p>
	{/if}

	<!-- 登録済み -->
	<div class="rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="text-sm font-medium text-stone-700">登録済みの認証アプリ</h2>
		{#if data.factors.length === 0}
			<p class="mt-2 text-sm text-stone-500">まだ登録していません。</p>
		{:else}
			<ul class="mt-2 divide-y divide-stone-100">
				{#each data.factors as f (f.id)}
					<li class="flex flex-wrap items-center gap-3 py-2 text-sm">
						<span class="font-medium text-stone-800">{f.friendlyName ?? '認証アプリ'}</span>
						<span class="text-xs text-stone-500">登録 {fmt(f.createdAt)}／最後に使用 {fmt(f.lastUsedAt)}</span>
						<form method="POST" action="?/remove" use:enhance={submitting} class="ml-auto">
							<input type="hidden" name="factorId" value={f.id} />
							<button
								type="submit"
								disabled={busy}
								class="rounded-md border border-stone-300 px-3 py-1 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-60"
								onclick={confirmSubmit({
									message:
										data.factors.length === 1
											? 'この認証アプリの登録を削除します。削除すると二段階認証が無効になります' +
												(data.required ? '（必須のため、すぐに登録し直す必要があります）。' : '。')
											: 'この認証アプリの登録を削除します。',
									confirmLabel: '削除する'
								})}
							>
								削除
							</button>
						</form>
					</li>
				{/each}
			</ul>
			<p class="mt-2 text-[11px] text-stone-500">
				機種変更のときは、新しいスマートフォンで「別の端末を追加」してから古い登録を削除してください。スマートフォンを失くしたときは、別の管理者に登録の削除を頼んでください。
			</p>
		{/if}
	</div>

	<!-- 登録 -->
	<div class="mt-4 rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="text-sm font-medium text-stone-700">{data.factors.length === 0 ? '登録する' : '別の端末を追加する'}</h2>

		{#if !enrolling}
			<form method="POST" action="?/enroll" use:enhance={submitting} class="mt-3 flex flex-wrap items-end gap-3" data-no-guard>
				<label class="block text-sm">
					<span class="text-stone-600">名前（任意・どの端末か分かるように）</span>
					<input name="friendlyName" maxlength="40" placeholder="例: 佐藤の iPhone" class="mt-1 w-64 rounded-md border border-stone-300 px-3 py-2 text-sm" />
				</label>
				<button type="submit" disabled={busy} class="rounded-md bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
					{busy ? '準備中…' : '登録を始める'}
				</button>
			</form>
		{:else}
			<ol class="mt-3 space-y-4 text-sm text-stone-700">
				<li>
					<p>1. スマートフォンの認証アプリで、この QR コードを読み取ってください。</p>
					<img src={enrolling.qrCode} alt="認証アプリに登録する QR コード" width="200" height="200" class="mt-2 rounded border border-stone-200 bg-white p-2" />
					<p class="mt-2 text-xs text-stone-500">
						読み取れないときは、認証アプリで「キーを入力」を選び、次の文字を入力してください:
						<code class="rounded bg-stone-100 px-1 font-mono break-all select-all">{enrolling.secret}</code>
					</p>
				</li>
				<li>
					<p>2. 認証アプリに表示された 6 桁の数字を入力してください。</p>
					<form method="POST" action="?/verify" use:enhance={submitting} class="mt-2 flex flex-wrap items-end gap-3" data-no-guard>
						<input type="hidden" name="factorId" value={enrolling.factorId} />
						<input type="hidden" name="qrCode" value={enrolling.qrCode} />
						<input type="hidden" name="secret" value={enrolling.secret} />
						<input type="hidden" name="friendlyName" value={enrolling.friendlyName} />
						<input
							name="code"
							inputmode="numeric"
							autocomplete="one-time-code"
							maxlength="8"
							required
							placeholder="123456"
							class="w-36 rounded-md border border-stone-300 px-3 py-2 text-center font-mono text-lg tracking-widest"
						/>
						<button type="submit" disabled={busy} class="rounded-md bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
							{busy ? '確認中…' : '有効にする'}
						</button>
					</form>
				</li>
			</ol>
			<form method="POST" action="?/cancel" use:enhance={submitting} class="mt-4" data-no-guard>
				<input type="hidden" name="factorId" value={enrolling.factorId} />
				<button type="submit" class="text-xs text-stone-500 underline hover:text-stone-700">登録をやめる</button>
			</form>
		{/if}
	</div>

	{#if data.isAdmin}
		<p class="mt-4 text-sm">
			<a href="/admin/security/users" class="text-brand-800 underline hover:text-brand-700">ほかの管理者・スタッフの登録状況と、登録の削除（スマートフォンを失くした人の復旧）→</a>
		</p>
	{/if}
{/if}
