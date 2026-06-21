<script lang="ts">
	import { enhance } from '$app/forms';
	import RankBadge from '$lib/components/RankBadge.svelte';
	import { formatDateJa } from '$lib/format';

	let { data, form } = $props();
</script>

<svelte:head><title>{data.m.memberCode} ｜ 会員管理</title></svelte:head>

<nav class="mb-3 text-xs text-stone-400"><a href="/admin/members" class="hover:underline">会員管理</a> / {data.m.memberCode}</nav>

{#if form?.adjusted}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">ポイントを調整しました（監査ログに記録）。</p>{/if}
{#if form?.rankChanged}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">ランクを変更しました（監査ログに記録）。</p>{/if}
{#if form?.otayoriGranted}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">おたよりポイントを付与しました（監査ログに記録）。</p>{/if}
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

<div class="grid gap-4 lg:grid-cols-[1fr_340px]">
	<div class="space-y-4">
		<section class="rounded-xl border border-stone-200 bg-white p-5">
			<div class="flex items-center justify-between">
				<h1 class="text-lg font-bold text-stone-800">{data.m.name} <span class="text-sm font-normal text-stone-400">（{data.m.kana}）</span></h1>
				<RankBadge rank={data.m.rank} />
			</div>
			<dl class="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
				<div class="flex gap-2"><dt class="text-stone-400">会員番号</dt><dd>{data.m.memberCode}</dd></div>
				<div class="flex gap-2"><dt class="text-stone-400">登録日</dt><dd>{data.m.joinedAt}</dd></div>
				<div class="flex gap-2"><dt class="text-stone-400">メール</dt><dd>{data.m.email}</dd></div>
				<div class="flex gap-2"><dt class="text-stone-400">電話</dt><dd>{data.m.phone}</dd></div>
				<div class="flex gap-2"><dt class="text-stone-400">メルマガ</dt><dd>{data.m.mailOptIn ? '受信する' : '受信しない'}</dd></div>
				<div class="flex gap-2"><dt class="text-stone-400">ポイント残高</dt><dd class="font-medium">{data.balance.toLocaleString()} pt</dd></div>
				<div class="flex gap-2"><dt class="text-stone-400">おたよりpt残高</dt><dd class="font-medium">{data.otayoriBalance.toLocaleString()} pt <span class="text-xs font-normal text-stone-400">（1pt=1,000円分）</span></dd></div>
			</dl>
		</section>

		<section class="rounded-xl border border-stone-200 bg-white p-5">
			<h2 class="mb-2 text-sm font-medium text-stone-700">予約履歴</h2>
			<div class="divide-y divide-stone-100 text-sm">
				{#each data.reservations as r}
					<div class="flex items-center gap-3 py-2">
						<a href="/admin/reservations/{r.code}" class="text-accent-600 hover:underline">{r.code}</a>
						<span class="flex-1">{r.facilityName} ／ {formatDateJa(r.checkin)}</span>
						<span class="text-xs text-stone-400">{r.status === 'reserved' ? '予約済' : r.status === 'cancelled' ? 'キャンセル' : '宿泊済'}</span>
					</div>
				{:else}
					<p class="py-3 text-stone-400">予約履歴はありません</p>
				{/each}
			</div>
		</section>

		<section class="rounded-xl border border-stone-200 bg-white p-5">
			<h2 class="mb-2 text-sm font-medium text-stone-700">ポイント台帳</h2>
			<div class="divide-y divide-stone-100 text-sm">
				{#each data.ledger as e}
					<div class="flex items-center justify-between py-2">
						<div><p>{e.reason}</p><p class="text-xs text-stone-400">{e.createdAt}</p></div>
						<span class="font-medium {e.delta > 0 ? 'text-emerald-700' : 'text-red-600'}">{e.delta > 0 ? '+' : ''}{e.delta.toLocaleString()}pt</span>
					</div>
				{/each}
			</div>
		</section>

		<section class="rounded-xl border border-stone-200 bg-white p-5">
			<h2 class="mb-2 text-sm font-medium text-stone-700">おたよりポイント台帳 <span class="text-xs font-normal text-stone-400">（1pt=1,000円分）</span></h2>
			<div class="divide-y divide-stone-100 text-sm">
				{#each data.otayoriLedger as e}
					<div class="flex items-center justify-between py-2">
						<div><p>{e.reason}</p><p class="text-xs text-stone-400">{e.createdAt}</p></div>
						<span class="font-medium {e.delta > 0 ? 'text-emerald-700' : 'text-red-600'}">{e.delta > 0 ? '+' : ''}{e.delta.toLocaleString()}pt</span>
					</div>
				{:else}
					<p class="py-3 text-stone-400">おたよりポイントの履歴はありません</p>
				{/each}
			</div>
		</section>
	</div>

	<aside class="space-y-4">
		{#if data.isAdmin}
			<form method="POST" action="?/adjust" use:enhance class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<h2 class="font-medium text-stone-700">ポイント手動調整</h2>
				<p class="mt-1 text-xs text-stone-400">付与は正、減算は負の数で入力。理由は監査ログに記録されます。</p>
				<input type="number" name="delta" placeholder="+500 / -200" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5" />
				<input name="reason" placeholder="理由（必須）" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5" />
				<button type="submit" class="mt-2 w-full rounded-md bg-brand-800 py-1.5 text-white hover:bg-brand-700">調整を実行</button>
			</form>

			<form method="POST" action="?/rank" use:enhance class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
				<h2 class="font-medium text-stone-700">ランク手動変更</h2>
				<select name="rank" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5">
					{#each ['standard', 'silver', 'gold'] as r}
						<option value={r} selected={r === data.m.rank}>{r}</option>
					{/each}
				</select>
				<input name="rankReason" placeholder="理由（必須）" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5" />
				<button type="submit" class="mt-2 w-full rounded-md border border-stone-300 py-1.5 hover:bg-stone-50">変更する</button>
			</form>

			<form method="POST" action="?/grantOtayori" use:enhance class="rounded-xl border border-amber-200 bg-amber-50/40 p-4 text-sm">
				<h2 class="font-medium text-stone-700">📨 おたよりポイント手動付与</h2>
				<p class="mt-1 text-xs text-stone-400">1pt＝1,000円相当。番組開始前からの保持者などへ付与します。付与は正、取消は負の数。理由は監査ログに記録されます。現在の残高: <span class="font-medium text-stone-600">{data.otayoriBalance.toLocaleString()}pt</span></p>
				<input type="number" name="otayoriDelta" placeholder="+1 / -1" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5" />
				<input name="otayoriReason" placeholder="理由（必須）" class="mt-2 w-full rounded-md border border-stone-300 px-3 py-1.5" />
				<button type="submit" class="mt-2 w-full rounded-md bg-brand-800 py-1.5 text-white hover:bg-brand-700">おたよりptを付与</button>
			</form>
		{:else}
			<p class="rounded-xl border border-stone-200 bg-white p-4 text-xs text-stone-400">スタッフ権限では閲覧のみ可能です（連絡先はマスク表示）。</p>
		{/if}

		{#if data.audits.length > 0}
			<div class="rounded-xl border border-stone-200 bg-white p-4 text-xs">
				<h2 class="font-medium text-stone-700">監査ログ</h2>
				<ul class="mt-2 space-y-1.5 text-stone-500">
					{#each data.audits as a}
						<li>{a.at.slice(0, 16).replace('T', ' ')} {a.actor}: {a.action} — {a.detail}</li>
					{/each}
				</ul>
			</div>
		{/if}
	</aside>
</div>
