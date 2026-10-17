<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	type EnrollState = { factorId: string; qrCode: string; secret: string; friendlyName: string };
	// 登録の途中（QR を表示中）。action の戻り値から取り出す
	let enrolling = $derived(((form as { enroll?: EnrollState } | null)?.enroll ?? null) as EnrollState | null);
	let busy = $state(false);

	const fmt = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }) : '—';

	// 登録済みの第2要素（認証アプリ＋パスキー）
	let enrolledCount = $derived(data.factors.length + data.passkey.list.length);

	// ---- パスキー ----
	let passkeySupported = $state(false);
	let passkeyName = $state('');
	let passkeyBusy = $state(false);
	let passkeyMessage = $state('');
	let passkeyAdded = $state('');
	$effect(() => {
		if (!data.passkey.usable) return;
		void import('$lib/admin-passkey-client').then(async (m) => (passkeySupported = await m.passkeySupported()));
	});
	async function addPasskey() {
		if (passkeyBusy) return;
		passkeyBusy = true;
		passkeyMessage = '';
		passkeyAdded = '';
		try {
			const { registerAdminPasskey } = await import('$lib/admin-passkey-client');
			const r = await registerAdminPasskey(passkeyName);
			if (r.ok) {
				passkeyAdded = String((r.data?.passkey as { name?: string } | undefined)?.name ?? 'パスキー');
				passkeyName = '';
				await invalidateAll();
			} else passkeyMessage = r.message;
		} finally {
			passkeyBusy = false;
		}
	}

	// ---- スマホに追加する QR（PC に Bluetooth が無くても、スマホで読めばそのスマホに登録できる・2026-10-17）----
	let enrollQr = $state<{ svg: string; expiresAt: string } | null>(null);
	let enrollBusy = $state(false);
	let enrollMessage = $state('');
	let enrollNow = $state(Date.now());
	$effect(() => {
		if (!enrollQr) return;
		const timer = setInterval(() => (enrollNow = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	const enrollLeft = $derived(enrollQr ? Math.max(0, Math.floor((new Date(enrollQr.expiresAt).getTime() - enrollNow) / 1000)) : 0);
	async function showEnrollQr() {
		if (enrollBusy) return;
		enrollBusy = true;
		enrollMessage = '';
		try {
			const res = await fetch('/admin/security/passkey/enroll-link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
			const j = (await res.json().catch(() => null)) as { ok?: boolean; svg?: string; expiresAt?: string; message?: string } | null;
			if (j?.ok && j.svg && j.expiresAt) {
				enrollQr = { svg: j.svg, expiresAt: j.expiresAt };
				enrollNow = Date.now();
			} else enrollMessage = j?.message ?? 'QR を出せませんでした。画面を開き直してください。';
		} finally {
			enrollBusy = false;
		}
	}

	const submitting = () => {
		busy = true;
		return async ({ update }: { update: (opts?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

<svelte:head><title>二段階認証・パスキー ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">二段階認証・パスキー</h1>
<p class="mb-4 text-sm text-stone-500">
	パスワードが漏れても管理画面に入られないよう、<strong>パスキー</strong>（この端末の指紋・顔認証・PIN）か<strong>認証アプリ</strong>（Google Authenticator・Microsoft Authenticator・1Password など）の
	6 桁の数字で本人確認をします。どちらかを登録すると、パスワードでログインしたあとに毎回確認を求めます。パスキーなら、パスワードを入れずに「パスキーでログイン」だけで入れます。
</p>

{#if !data.available}
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
		<p class="font-bold">この環境では二段階認証は使えません</p>
		<p class="mt-2">ローカルのデモ（AUTH_MODE=demo）では Supabase のログインを使わないため、登録できません。本番（AUTH_MODE=supabase）でお使いください。</p>
	</div>
{:else}
	{#if data.required && enrolledCount === 0}
		<div class="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
			<p class="font-bold">二段階認証の登録が必要です</p>
			<p class="mt-1">登録が終わるまで、管理画面のほかの画面は開けません。下の「パスキーを追加」か「登録を始める」から進めてください。</p>
		</div>
	{:else if data.enrollRequested && enrolledCount === 0}
		<div class="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">下の「パスキーを追加」か「登録を始める」から進めてください。</div>
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

	<!-- パスキー -->
	<div class="mb-4 rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="text-sm font-medium text-stone-700">🔑 パスキー</h2>
		{#if !data.passkey.usable}
			<p class="mt-2 text-sm text-stone-500">このアドレスではパスキーを使えません。https://book.yamado.app/admin から開いてください。</p>
		{:else}
			{#if (form as unknown as { passkeyRemoved?: string } | null)?.passkeyRemoved}
				<p class="mt-2 rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-700">パスキー「{(form as unknown as { passkeyRemoved: string }).passkeyRemoved}」を削除しました。</p>
			{/if}
			{#if passkeyAdded}
				<p class="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
					パスキー「{passkeyAdded}」を登録しました。次回から、ログイン画面の「パスキーでログイン」で入れます。
				</p>
			{/if}
			{#if passkeyMessage}
				<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{passkeyMessage}</p>
			{/if}
			{#if data.passkey.loadError}
				<p class="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.passkey.loadError}</p>
			{/if}
			{#if data.passkey.list.length === 0}
				<p class="mt-2 text-sm text-stone-500">まだ登録していません。</p>
			{:else}
				<ul class="mt-2 divide-y divide-stone-100">
					{#each data.passkey.list as p (p.id)}
						<li class="flex flex-wrap items-center gap-3 py-2 text-sm">
							<span class="font-medium text-stone-800">{p.name}</span>
							{#if p.backedUp}<span class="rounded bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-800">同期パスキー</span>{/if}
							<span class="text-xs text-stone-500">登録 {fmt(p.createdAt)}／最後に使用 {fmt(p.lastUsedAt)}</span>
							<form method="POST" action="?/removePasskey" use:enhance={submitting} class="ml-auto">
								<input type="hidden" name="passkeyId" value={p.id} />
								<button
									type="submit"
									disabled={busy}
									class="rounded-md border border-stone-300 px-3 py-1 text-xs text-stone-600 hover:bg-stone-50 disabled:opacity-60"
									onclick={confirmSubmit({
										message:
											enrolledCount === 1
												? 'このパスキーを削除します。最後の登録なので、削除するとパスワードだけでログインできる状態に戻ります' +
													(data.required ? '（必須のため、すぐに登録し直す必要があります）。' : '。')
												: 'このパスキーを削除します。端末に残ったパスキーは、端末の設定（パスワード管理）から消してください。',
										confirmLabel: '削除する'
									})}
								>
									削除
								</button>
							</form>
						</li>
					{/each}
				</ul>
			{/if}
			{#if passkeySupported}
				<div class="mt-3 flex flex-wrap items-end gap-3">
					<label class="block text-sm">
						<span class="text-stone-600">名前（任意・どの端末か分かるように）</span>
						<input bind:value={passkeyName} maxlength="60" placeholder="例: 事務所の PC" class="mt-1 w-64 rounded-md border border-stone-300 px-3 py-2 text-sm" />
					</label>
					<button
						type="button"
						onclick={() => void addPasskey()}
						disabled={passkeyBusy}
						class="rounded-md bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
					>
						{passkeyBusy ? '登録しています…' : 'パスキーを追加'}
					</button>
				</div>
				<p class="mt-2 text-[11px] text-stone-500">
					パスキーはこの端末（または Apple / Google アカウント・パスワード管理アプリ）に保存されます。使う端末ごとに追加してください。共用の PC には登録せず、ご自身のスマートフォンを使ってください（PC のログイン画面で QR コードを読み取れます）。
				</p>
			{:else}
				<p class="mt-2 text-xs text-stone-500">このブラウザではパスキーを使えません。</p>
			{/if}
			<!-- スマホに追加する QR。PC に Bluetooth が無いと、ブラウザの「別のデバイス（スマホ）」が出ないための代わり（2026-10-17） -->
			<div class="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3">
				<p class="text-sm font-medium text-stone-700">📲 スマホに追加する</p>
				<p class="mt-1 text-[11px] leading-relaxed text-stone-500">
					QR を出してスマホのカメラで読むと、そのスマホにあなたのパスキーを登録できます（PC の Bluetooth は不要）。10 分間・1 回だけ使えます。出し直すと前の QR は使えなくなります。
					登録後はスマホのログイン画面の「🔑 パスキーでログイン」で入れます。<b>この QR はほかの人に見せないでください</b>（読んだ端末にあなたのパスキーが作られます）。
				</p>
				{#if enrollMessage}<p class="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-700">{enrollMessage}</p>{/if}
				{#if enrollQr && enrollLeft > 0}
					<div class="mt-3 flex flex-wrap items-center gap-4">
						<div class="w-40 rounded bg-white p-1 [&>svg]:h-auto [&>svg]:w-full">{@html enrollQr.svg}</div>
						<div class="text-xs text-stone-600">
							<p>スマホのカメラで読んでください。</p>
							<p class="mt-1 tabular-nums">残り {Math.floor(enrollLeft / 60)}:{String(enrollLeft % 60).padStart(2, '0')}</p>
							<button type="button" onclick={() => (enrollQr = null)} class="mt-2 rounded border border-stone-300 bg-white px-2 py-1 text-xs text-stone-600 hover:bg-stone-50">閉じる</button>
						</div>
					</div>
				{:else}
					{#if enrollQr}<p class="mt-2 text-xs text-stone-500">QR の期限が切れました。もう一度出してください。</p>{/if}
					<button
						type="button"
						onclick={() => void showEnrollQr()}
						disabled={enrollBusy}
						class="mt-2 rounded-md border border-brand-800 bg-white px-3 py-1.5 text-sm font-medium text-brand-900 hover:bg-brand-50 disabled:opacity-60"
					>
						{enrollBusy ? '用意しています…' : 'スマホに追加する QR を出す'}
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- 登録済み -->
	<div class="rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="text-sm font-medium text-stone-700">📱 登録済みの認証アプリ</h2>
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
										enrolledCount === 1
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
		<h2 class="text-sm font-medium text-stone-700">{data.factors.length === 0 ? '認証アプリを登録する' : '認証アプリの別の端末を追加する'}</h2>

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
			<a href="/admin/security/users" class="text-brand-800 underline hover:text-brand-700">ほかの管理者・スタッフの登録状況と、登録の削除（スマートフォン・パスキーを失くした人の復旧）→</a>
		</p>
	{/if}
{/if}
