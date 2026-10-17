<script lang="ts">
	import { enhance } from '$lib/enhance';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data, form } = $props();

	const fmt = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }) : '—';
	const verifiedCount = (u: (typeof data.users)[number]) => u.factors.filter((f) => f.status === 'verified').length + u.passkeys;
	let adminCount = $derived(data.users.filter((u) => u.role === 'admin').length);
</script>

<svelte:head><title>二段階認証の登録状況 ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-sm"><a href="/admin/security" class="text-stone-500 hover:text-stone-700">← 二段階認証・パスキー</a></p>
<PageHeader title="管理者・スタッフの二段階認証・パスキー" />
<p class="-mt-3 mb-5 max-w-3xl text-sm leading-relaxed text-stone-500">
	スマートフォン・パスキーを失くした・機種変更で引き継げなかった人の登録（パスキーと認証アプリ）を削除します。削除すると、その人は次のログインでパスワードだけで入れるので、すぐに「二段階認証・パスキー」の画面で登録し直してもらってください。
	削除は監査ログ（admin_mfa_reset・admin_passkey_reset）に残ります。<strong>本人からの依頼であることを、電話や対面で確かめてから</strong>削除してください。
</p>

{#if !data.available}
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
		この環境（AUTH_MODE=demo）では使えません。本番（AUTH_MODE=supabase）でお使いください。
	</div>
{:else}
	{#if !data.selfAal2}
		<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
			ほかの人の登録を削除するには、先に<a href="/admin/security" class="underline">ご自身の二段階認証</a>を登録し、コードで確認してください（一覧は見られます）。
		</div>
	{/if}
	{#if adminCount < 2}
		<div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
			管理者（admin）が {adminCount} 人です。管理者がスマートフォンを失くすと、Supabase ダッシュボード（Authentication → Users → 該当ユーザー → Factors）でしか戻せません。管理者は 2 人以上にしてください。
		</div>
	{/if}

	{#if form?.message}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
	{/if}
	{#if (form as { done?: string } | null)?.done}
		<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{(form as { done: string }).done}</p>
	{/if}
	{#if data.loadError}
		<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.loadError}</p>
	{/if}

	<!-- スマホ（md 未満）は1人＝1枚のカード。md 以上は表と同じ並び（見出しの行を出す） -->
	<div class="rounded-xl border border-stone-200 bg-white">
		<div class="hidden gap-3 border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500 md:grid md:grid-cols-[minmax(0,1.6fr)_6rem_minmax(0,1.8fr)_8rem]">
			<span>アカウント</span><span>権限</span><span>二段階認証</span><span></span>
		</div>
		<ul class="divide-y divide-stone-100">
			{#each data.users as u (u.id)}
				<li class="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.6fr)_6rem_minmax(0,1.8fr)_8rem] md:items-start md:gap-3">
					<div class="min-w-0">
						<p class="flex flex-wrap items-center gap-x-2 font-medium break-all text-stone-800">
							{u.name || u.email}
							{#if u.id === data.selfId}<span class="text-[11px] font-normal text-stone-500">（自分）</span>{/if}
							<!-- スマホでは権限を名前の横に -->
							<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset md:hidden {u.role === 'admin' ? 'bg-brand-50 text-brand-900 ring-brand-100' : 'bg-sky-50 text-sky-800 ring-sky-200'}">{u.role === 'admin' ? '管理者' : 'スタッフ'}</span>
						</p>
						{#if u.name}<p class="text-xs break-all text-stone-500">{u.email}</p>{/if}
					</div>
					<span class="hidden md:block">{u.role === 'admin' ? '管理者' : 'スタッフ'}</span>
					<div>
						{#if verifiedCount(u) > 0}
							<span class="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200 ring-inset">登録済み {verifiedCount(u)} 件</span>
						{:else}
							<span class="inline-flex items-center rounded-full bg-stone-50 px-2 py-0.5 text-[11px] font-medium text-stone-500 ring-1 ring-stone-200 ring-inset">未登録</span>
						{/if}
						{#if u.passkeys > 0}
							<p class="mt-1 text-xs text-stone-500">パスキー {u.passkeys} 件</p>
						{/if}
						{#each u.factors as f (f.id)}
							<p class="mt-1 text-xs text-stone-500">
								{f.friendlyName ?? f.type}・{f.status === 'verified' ? '有効' : '登録途中'}・{fmt(f.createdAt)}
							</p>
						{/each}
					</div>
					<div class="md:text-right">
						{#if u.id !== data.selfId && (u.factors.length > 0 || u.passkeys > 0)}
							<form method="POST" action="?/reset" use:enhance data-no-guard>
								<input type="hidden" name="userId" value={u.id} />
								<button
									type="submit"
									disabled={!data.selfAal2}
									class="min-h-9 w-full rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50 md:w-auto"
									onclick={confirmSubmit({
										message: `${u.email} の二段階認証・パスキーの登録をすべて削除します。本人からの依頼であることを確かめましたか？`,
										confirmLabel: '削除する'
									})}
								>
									登録を削除
								</button>
							</form>
						{/if}
					</div>
				</li>
			{:else}
				<li class="px-3 py-6 text-center text-stone-500">管理画面のアカウントが見つかりません。</li>
			{/each}
		</ul>
	</div>
{/if}
