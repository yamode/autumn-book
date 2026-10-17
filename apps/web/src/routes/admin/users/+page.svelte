<script lang="ts">
	// ユーザー管理（管理者だけ）。中身の説明は +page.server.ts と lib/server/admin-users.ts
	import { enhance } from '$lib/enhance';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';

	let { data, form } = $props();

	const f = $derived(form as { message?: string; done?: string; email?: string; name?: string; created?: boolean } | null);
	const fmt = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }) : '—';
	const facilityName = (id: string | null) => (id ? (data.facilities.find((x) => x.id === id)?.name ?? '別の施設') : '全施設');
	const ROLE_LABEL: Record<string, string> = { admin: '管理者', staff: 'スタッフ' };
	// パスワードを変える欄を開いているアカウント
	let pwOpen = $state<string | null>(null);
</script>

<svelte:head><title>ユーザー管理 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">ユーザー管理</h1>
<p class="mb-4 text-sm text-stone-500">
	管理画面に入れるアカウントの追加・権限・施設の割り当て・パスワードを管理します。管理者以外は共有ID（PMS と同じID）を使います。
	施設を割り当てると、<strong>PMS にも同じ施設で入れるようになります</strong>（施設の割り当ては PMS と共通）。メールアドレスは変えられません。
</p>

{#if !data.available}
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">この環境（AUTH_MODE=demo）では使えません。本番でお使いください。</div>
{:else}
	{#if !data.selfAal2}
		<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
			アカウントを変えるには、先に<a href="/admin/security" class="underline">ご自身の二段階認証かパスキー</a>を登録し、確認してください（一覧は見られます）。
		</div>
	{/if}
	{#if f?.message}<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{f.message}</p>{/if}
	{#if f?.done}<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{f.done}</p>{/if}
	{#if data.loadError}<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.loadError}</p>{/if}

	<!-- 追加 -->
	<details class="mb-5 rounded-xl border border-stone-200 bg-white p-4 text-sm" open={Boolean(f?.email && !f?.created)}>
		<summary class="cursor-pointer font-medium text-stone-700">＋ アカウントを追加する</summary>
		<form method="POST" action="?/create" use:enhance data-reset class="mt-3 grid gap-3 md:grid-cols-2">
			<label class="block">
				<span class="text-xs text-stone-600">メールアドレス（ログインID・あとから変えられません）</span>
				<input name="email" type="email" required autocomplete="off" value={f?.email ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
			<label class="block">
				<span class="text-xs text-stone-600">表示名（例：西和賀フロント共有・佐藤）</span>
				<input name="name" maxlength="60" value={f?.name ?? ''} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />
			</label>
			<label class="block">
				<span class="text-xs text-stone-600">初期パスワード（{data.minPassword}文字以上・英字と数字を含む）</span>
				<input name="password" type="text" required minlength={data.minPassword} autocomplete="new-password" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 font-mono" />
			</label>
			<label class="block">
				<span class="text-xs text-stone-600">権限</span>
				<select name="role" class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">
					<option value="staff">スタッフ（共有ID）</option>
					<option value="admin">管理者（個人）</option>
				</select>
			</label>
			<fieldset class="md:col-span-2">
				<legend class="text-xs text-stone-600">施設の割り当て（PMS と共通）</legend>
				<div class="mt-1 flex flex-wrap gap-4">
					{#each data.facilities as fac (fac.id)}
						<label class="flex items-center gap-1.5"><input type="checkbox" name="facilityId" value={fac.id} class="h-4 w-4" />{fac.name}</label>
					{/each}
				</div>
			</fieldset>
			<div class="md:col-span-2">
				<button type="submit" disabled={!data.selfAal2} class="rounded-lg bg-brand-800 px-5 py-2 text-white hover:bg-brand-700 disabled:opacity-50">作る</button>
			</div>
		</form>
	</details>

	<!-- 一覧 -->
	<div class="space-y-3">
		{#each data.users as u (u.id)}
			<div class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<p class="font-medium text-stone-800">{u.name || u.email}</p>
					{#if u.name}<p class="text-xs text-stone-500">{u.email}</p>{/if}
					{#if u.id === data.selfId}<span class="text-[11px] text-stone-500">（自分）</span>{/if}
					{#if u.bookRole}
						<span class="rounded px-1.5 py-0.5 text-[11px] {u.bookRole === 'admin' ? 'bg-brand-50 text-brand-900' : 'bg-sky-50 text-sky-800'}">{ROLE_LABEL[u.bookRole]}</span>
					{:else}
						<span class="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600">Book の権限なし（PMS のみ）</span>
					{/if}
					{#if u.banned}<span class="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">利用停止中</span>{/if}
					<span class="ml-auto text-xs text-stone-400">最終ログイン {fmt(u.lastSignInAt)}・認証アプリ {u.totp}件</span>
				</div>

				<div class="mt-3 grid gap-3 md:grid-cols-2">
					<!-- 権限 -->
					<form method="POST" action="?/role" use:enhance class="flex flex-wrap items-end gap-2">
						<input type="hidden" name="userId" value={u.id} />
						<label class="block">
							<span class="text-xs text-stone-600">Book の権限</span>
							<select name="role" value={u.bookRole ?? ''} disabled={u.id === data.selfId} class="mt-1 rounded-md border border-stone-300 px-2 py-1.5">
								<option value="admin">管理者</option>
								<option value="staff">スタッフ</option>
								<option value="">なし（Book に入れない）</option>
							</select>
						</label>
						{#if u.id !== data.selfId}
							<button
								type="submit"
								disabled={!data.selfAal2}
								class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
								onclick={confirmSubmit({ message: `${u.email} の Book の権限を変えます。`, confirmLabel: '変える' })}>権限を保存</button
							>
						{:else}
							<span class="text-[11px] text-stone-400">ご自身の権限は変えられません</span>
						{/if}
					</form>

					<!-- 施設 -->
					<form method="POST" action="?/facilities" use:enhance class="flex flex-wrap items-end gap-2">
						<input type="hidden" name="userId" value={u.id} />
						<fieldset>
							<legend class="text-xs text-stone-600">施設の割り当て（PMS と共通）</legend>
							<div class="mt-1 flex flex-wrap gap-3">
								{#each data.facilities as fac (fac.id)}
									{@const other = u.otherMemberships.find((m) => m.facilityId === fac.id)}
									<label class="flex items-center gap-1.5 {other ? 'text-stone-400' : ''}" title={other ? `PMS・RMS 側で ${other.role} として割り当て済み（ここでは変えられません）` : ''}>
										<input type="checkbox" name="facilityId" value={fac.id} checked={u.sharedFacilityIds.includes(fac.id) || Boolean(other)} disabled={Boolean(other)} class="h-4 w-4" />{fac.name}
									</label>
								{/each}
							</div>
						</fieldset>
						<button type="submit" disabled={!data.selfAal2} class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50">施設を保存</button>
					</form>
				</div>
				{#if u.otherMemberships.length}
					<p class="mt-2 text-[11px] text-stone-400">
						PMS・RMS 側の割り当て（ここでは変えられません）: {u.otherMemberships.map((m) => `${facilityName(m.facilityId)}＝${m.role}`).join('、')}
					</p>
				{/if}

				<!-- パスワード -->
				<div class="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
					<button type="button" onclick={() => (pwOpen = pwOpen === u.id ? null : u.id)} class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50">
						パスワードを変える {pwOpen === u.id ? '▲' : '▼'}
					</button>
					<form method="POST" action="?/resetMail" use:enhance>
						<input type="hidden" name="userId" value={u.id} />
						<button
							type="submit"
							disabled={!data.selfAal2}
							class="rounded-md border border-stone-300 px-3 py-1.5 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-50"
							onclick={confirmSubmit({ message: `${u.email} にパスワードの再設定のメールを送ります。`, confirmLabel: '送る' })}>再設定のメールを送る</button
						>
					</form>
				</div>
				{#if pwOpen === u.id}
					<form method="POST" action="?/password" use:enhance data-reset class="mt-2 flex flex-wrap items-end gap-2">
						<input type="hidden" name="userId" value={u.id} />
						<label class="block">
							<span class="text-xs text-stone-600">新しいパスワード（{data.minPassword}文字以上・英字と数字）</span>
							<input name="password" type="text" required minlength={data.minPassword} autocomplete="new-password" class="mt-1 w-64 rounded-md border border-stone-300 px-3 py-1.5 font-mono" />
						</label>
						<button
							type="submit"
							disabled={!data.selfAal2}
							class="rounded-md bg-brand-800 px-3 py-1.5 text-xs text-white hover:bg-brand-700 disabled:opacity-50"
							onclick={confirmSubmit({ message: `${u.email} のパスワードを変えます。いまこのIDでログインしている端末も、次のログインからは新しいパスワードが要ります。`, confirmLabel: '変える' })}>変える</button
						>
					</form>
				{/if}
			</div>
		{:else}
			<p class="rounded-xl border border-stone-200 bg-white p-6 text-center text-sm text-stone-500">アカウントがありません。</p>
		{/each}
	</div>
{/if}
