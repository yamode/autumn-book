<script lang="ts">
	import { enhance } from '$app/forms';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';

	let { data, form } = $props();

	const fmt = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }) : '—';
	const verifiedCount = (u: (typeof data.users)[number]) => u.factors.filter((f) => f.status === 'verified').length;
	let adminCount = $derived(data.users.filter((u) => u.role === 'admin').length);
</script>

<svelte:head><title>二段階認証の登録状況 ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-sm"><a href="/admin/security" class="text-stone-500 hover:text-stone-700">← 二段階認証</a></p>
<h1 class="mb-1 text-lg font-bold text-stone-800">管理者・スタッフの二段階認証</h1>
<p class="mb-4 text-sm text-stone-500">
	スマートフォンを失くした・機種変更で引き継げなかった人の登録を削除します。削除すると、その人は次のログインでパスワードだけで入れるので、すぐに「二段階認証」の画面で登録し直してもらってください。
	削除は監査ログ（admin_mfa_reset）に残ります。<strong>本人からの依頼であることを、電話や対面で確かめてから</strong>削除してください。
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

	<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
		<table class="w-full text-sm">
			<thead class="bg-stone-50 text-left text-xs text-stone-500">
				<tr>
					<th class="px-3 py-2">アカウント</th>
					<th class="px-3 py-2">権限</th>
					<th class="px-3 py-2">二段階認証</th>
					<th class="px-3 py-2"></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-stone-100">
				{#each data.users as u (u.id)}
					<tr class="align-top">
						<td class="px-3 py-2">
							<p class="font-medium text-stone-800">{u.name || u.email}</p>
							{#if u.name}<p class="text-xs text-stone-500">{u.email}</p>{/if}
							{#if u.id === data.selfId}<span class="text-[11px] text-stone-500">（自分）</span>{/if}
						</td>
						<td class="px-3 py-2">{u.role === 'admin' ? '管理者' : 'スタッフ'}</td>
						<td class="px-3 py-2">
							{#if verifiedCount(u) > 0}
								<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800">登録済み {verifiedCount(u)} 件</span>
							{:else}
								<span class="rounded bg-stone-100 px-1.5 py-0.5 text-xs text-stone-600">未登録</span>
							{/if}
							{#each u.factors as f (f.id)}
								<p class="mt-1 text-xs text-stone-500">
									{f.friendlyName ?? f.type}・{f.status === 'verified' ? '有効' : '登録途中'}・{fmt(f.createdAt)}
								</p>
							{/each}
						</td>
						<td class="px-3 py-2 text-right">
							{#if u.id !== data.selfId && u.factors.length > 0}
								<form method="POST" action="?/reset" use:enhance data-no-guard>
									<input type="hidden" name="userId" value={u.id} />
									<button
										type="submit"
										disabled={!data.selfAal2}
										class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50"
										onclick={confirmSubmit({
											message: `${u.email} の二段階認証の登録をすべて削除します。本人からの依頼であることを確かめましたか？`,
											confirmLabel: '削除する'
										})}
									>
										登録を削除
									</button>
								</form>
							{/if}
						</td>
					</tr>
				{:else}
					<tr><td colspan="4" class="px-3 py-6 text-center text-stone-500">管理画面のアカウントが見つかりません。</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
