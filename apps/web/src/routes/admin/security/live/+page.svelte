<script lang="ts">
	// 管理画面「Autumn Live の端末」。設計: docs/autumn-live.md §4.3・§4.6
	import { enhance } from '$lib/enhance';
	import { confirmSubmit } from '$lib/components/admin/confirm-dialog.svelte';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data, form } = $props();

	type Issued = { code: string; expiresAt: string; label: string };
	const issued = $derived((form as { issued?: Issued } | null)?.issued ?? null);
	const done = $derived((form as { done?: string } | null)?.done ?? null);
	const message = $derived((form as { message?: string } | null)?.message ?? null);

	const fmt = (iso: string | null) =>
		iso ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short' }) : '—';
	const time = (iso: string) => new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });
	const spaced = (code: string) => `${code.slice(0, 4)} ${code.slice(4)}`;
	const REASON = { manual: '管理者が停止', idle: '90 日使われず自動で停止', replaced: '新しい鍵に置き換え' } as const;

	const active = $derived(data.devices.filter((d) => !d.revokedAt));
	const stopped = $derived(data.devices.filter((d) => d.revokedAt));
</script>

<svelte:head><title>Autumn Live の端末 ｜ 山人管理</title></svelte:head>

<p class="mb-2 text-sm"><a href="/admin/security" class="text-stone-500 hover:text-stone-700">← ユーザー・セキュリティ</a></p>
<PageHeader title="Autumn Live の端末" />
<p class="-mt-3 mb-5 max-w-3xl text-sm leading-relaxed text-stone-500">
	Autumn Live（Book の様子を見る閲覧専用の画面）は、Autumn デスクトップアプリからだけ開けます。業務 PC はスタッフがログインして初めて開いたときに自動で登録され、テレビなど
	<strong>表示専用の端末</strong>は、ここで出す登録コードを端末で 1 回入力して登録します。90 日使われていない端末は自動で止まります。
</p>

{#if !data.available}
	<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
		この環境（AUTH_MODE=demo）では使えません。本番（AUTH_MODE=supabase）でお使いください。
	</div>
{:else}
	{#if message}<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{message}</p>{/if}
	{#if done}<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{done}</p>{/if}
	{#if data.loadError}<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{data.loadError}</p>{/if}

	<section class="mb-6 rounded-xl border border-stone-200 bg-white p-4">
		<h2 class="text-sm font-semibold text-stone-800">表示専用の端末を追加する</h2>
		{#if issued}
			<div class="mt-3 rounded-lg border border-brand-100 bg-brand-50 p-4">
				<p class="text-xs text-stone-600">「{issued.label}」の登録コード（{time(issued.expiresAt)} まで・1 回だけ使えます）</p>
				<p class="mt-1 font-mono text-3xl font-semibold tracking-[0.25em] text-stone-900 tabular-nums">{spaced(issued.code)}</p>
				<p class="mt-2 text-xs leading-relaxed text-stone-600">
					端末の Autumn デスクトップアプリで、端末設定の「Autumn Live だけで起動する」をオンにして再起動すると、コードの入力画面が出ます。
					このコードはこの画面を離れると二度と表示できません。
				</p>
			</div>
		{/if}
		<form method="POST" action="?/issue" use:enhance class="mt-3 flex flex-wrap items-end gap-3">
			<label class="grid gap-1 text-xs text-stone-600">
				端末の名前（置き場所など）
				<input
					id="live-label"
					name="label"
					required
					maxlength="60"
					value={(form as { label?: string } | null)?.label ?? ''}
					placeholder="例: 事務所のテレビ"
					class="min-h-9 w-64 max-w-full rounded-lg border border-stone-300 px-3 text-sm"
				/>
			</label>
			<button type="submit" class="min-h-9 rounded-lg bg-stone-900 px-4 text-sm text-white hover:bg-stone-800">登録コードを出す</button>
		</form>
	</section>

	<section class="mb-6">
		<h2 class="mb-2 text-sm font-semibold text-stone-800">使っている端末（{active.length}）</h2>
		<div class="rounded-xl border border-stone-200 bg-white">
			<div class="hidden gap-3 border-b border-stone-200 bg-stone-50 px-4 py-2 text-xs font-medium text-stone-500 md:grid md:grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1.4fr)_9rem_7rem]">
				<span>端末</span><span>種類</span><span>登録した人・最後に使った人</span><span>最後に開いた</span><span></span>
			</div>
			<ul class="divide-y divide-stone-100">
				{#each active as d (d.id)}
					<li class="grid gap-2 px-4 py-3 text-sm md:grid-cols-[minmax(0,1.6fr)_7rem_minmax(0,1.4fr)_9rem_7rem] md:items-center md:gap-3">
						<div class="min-w-0">
							<p class="font-medium break-all text-stone-800">{d.label}</p>
							<p class="text-xs text-stone-500">登録 {fmt(d.createdAt)}</p>
						</div>
						<span>
							<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset {d.kind === 'display' ? 'bg-brand-50 text-brand-900 ring-brand-100' : 'bg-sky-50 text-sky-800 ring-sky-200'}">
								{d.kind === 'display' ? '表示専用' : '業務 PC'}
							</span>
						</span>
						<div class="min-w-0 text-xs break-all text-stone-600">
							<p>{d.registeredBy ?? '—'}</p>
							{#if d.lastUser && d.lastUser !== d.registeredBy}<p class="text-stone-500">最後: {d.lastUser}</p>{/if}
						</div>
						<span class="text-xs text-stone-600 tabular-nums">{fmt(d.lastSeenAt)}</span>
						<form method="POST" action="?/revoke" use:enhance data-no-guard class="md:text-right">
							<input type="hidden" name="deviceId" value={d.id} />
							<button
								type="submit"
								class="min-h-9 w-full rounded-lg border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 md:w-auto"
								onclick={confirmSubmit({
									message: `「${d.label}」を止めます。最長 1 時間以内にこの端末で Autumn Live を開けなくなります。${d.kind === 'display' ? '使い直すには登録コードがもう一度要ります。' : '業務 PC は、次にスタッフが開いたときに登録し直されます。'}`,
									confirmLabel: '止める'
								})}
							>
								止める
							</button>
						</form>
					</li>
				{:else}
					<li class="px-3 py-6 text-center text-stone-500">まだ登録された端末はありません。</li>
				{/each}
			</ul>
		</div>
	</section>

	{#if stopped.length}
		<section>
			<h2 class="mb-2 text-sm font-semibold text-stone-800">止めた端末（直近 90 日）</h2>
			<ul class="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
				{#each stopped as d (d.id)}
					<li class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2 text-xs text-stone-500">
						<span class="min-w-0 break-all"><span class="text-stone-700">{d.label}</span>（{d.kind === 'display' ? '表示専用' : '業務 PC'}）</span>
						<span>{d.revokedReason ? REASON[d.revokedReason] : '停止'}・{fmt(d.revokedAt)}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
{/if}
