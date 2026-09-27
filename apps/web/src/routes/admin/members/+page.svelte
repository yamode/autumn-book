<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import RankBadge from '$lib/components/RankBadge.svelte';

	let { data, form } = $props();
	// 保存後も入力を残す
	const keep: SubmitFunction = () => async ({ update }) => update({ reset: false });
</script>

<svelte:head><title>会員 ｜ 山人管理</title></svelte:head>

<h1 class="mb-1 text-lg font-bold text-stone-800">会員</h1>
<p class="mb-4 text-xs text-stone-400">
	{#if data.live}
		アプリ・Web 共通の会員（book.members）です。
	{:else}
		デモデータを表示しています（本番接続時は実会員が表示されます）。
	{/if}
</p>

<!-- 入会ボーナス（検討中のため、先に設定できるようにしておく） -->
<section class="mb-5 max-w-3xl rounded-xl border border-stone-200 bg-white p-4 text-sm">
	<div class="mb-1 flex items-center justify-between">
		<h2 class="font-medium text-stone-800">入会ボーナス</h2>
		{#if form?.programSaved}<span class="text-xs text-emerald-600">✔ 保存しました</span>{/if}
	</div>
	<p class="mb-3 text-xs leading-relaxed text-stone-500">
		会員登録したときに付けるポイントです（お客様ご自身の登録・施設側の代行登録とも）。0 にすると付けません（登録画面の「入会で ○pt プレゼント」の案内も消えます）。
		変更はこれからの登録から効きます（登録済みの会員のポイントは変わりません）。
	</p>
	{#if data.programError || form?.programError}
		<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{form?.programError ?? data.programError}</p>
	{/if}
	{#if data.program}
		<form method="POST" action="?/saveProgram" use:enhance={keep}>
			<fieldset disabled={!data.canEditProgram} class="flex flex-wrap items-end gap-4">
				<label class="block">
					<span class="text-xs text-stone-500">ポイント</span>
					<span class="mt-1 flex items-center gap-1">
						<input type="number" name="points" min="0" max="100000" step="100" value={data.program.welcomeBonusPoints} class="w-28 rounded-md border border-stone-300 px-2 py-1.5 text-right" />
						<span class="text-stone-500">pt</span>
					</span>
				</label>
				<label class="block">
					<span class="text-xs text-stone-500">有効期限（付与日から）</span>
					<span class="mt-1 flex items-center gap-1">
						<input type="number" name="days" min="1" max="3650" value={data.program.welcomeBonusValidDays} class="w-24 rounded-md border border-stone-300 px-2 py-1.5 text-right" />
						<span class="text-stone-500">日</span>
					</span>
				</label>
				<button class="rounded-md bg-stone-800 px-4 py-2 text-xs text-white hover:bg-stone-700 disabled:opacity-40">保存</button>
			</fieldset>
		</form>
		<p class="mt-2 text-xs text-stone-400">
			これまでの付与 {data.program.grantedTotal.toLocaleString()} 件（直近30日 {data.program.granted30d.toLocaleString()} 件）
			{#if data.program.updatedAt}・最終更新 {new Date(data.program.updatedAt).toLocaleString('ja-JP')}{/if}
			{#if !data.canEditProgram}・変更は管理者だけができます{/if}
			{#if !data.live}・デモ表示（保存はできません）{/if}
		</p>
	{/if}
</section>

{#if data.error}
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
		{data.error}
	</div>
{/if}

<form method="GET" class="mb-4 flex gap-2">
	<input
		name="q"
		value={data.q}
		placeholder={data.live ? '氏名・フリガナ・会員番号で検索' : '氏名・メール・会員番号で検索'}
		class="w-72 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm"
	/>
	<button type="submit" class="bg-brand-800 rounded-md px-4 py-1.5 text-sm text-white">検索</button>
</form>

<div class="overflow-x-auto rounded-xl border border-stone-200 bg-white">
	<table class="w-full min-w-[720px] text-sm">
		<thead>
			<tr class="border-b border-stone-200 bg-stone-50 text-left text-xs text-stone-500">
				<th class="px-3 py-2">会員番号</th>
				<th>氏名</th>
				<th>ランク</th>
				{#if data.live}
					<th class="text-right">push</th>
					<th>最終宿泊</th>
				{:else}
					<th class="text-right">ポイント残高</th>
				{/if}
				<th>登録日</th>
				{#if !data.live}<th>メルマガ</th>{/if}
			</tr>
		</thead>
		<tbody>
			{#each data.members as m}
				<tr class="border-b border-stone-100 hover:bg-stone-50">
					<td class="px-3 py-2">
						<a href="/admin/members/{m.id}" class="text-accent-600 font-medium hover:underline">
							{m.memberCode}
						</a>
					</td>
					<td>
						{m.name}
						<span class="block text-xs text-stone-400">{m.email}</span>
					</td>
					<td><RankBadge rank={m.rank} /></td>
					{#if data.live}
						<td class="text-right text-xs">
							{#if m.deviceCount && m.deviceCount > 0}
								{m.deviceCount} 台{m.pushOptIn ? '' : '（受信オフ）'}
							{:else}
								<span class="text-stone-400">—</span>
							{/if}
						</td>
						<td class="text-xs">{m.lastStay ?? '—'}</td>
					{:else}
						<td class="text-right">{(m.balance ?? 0).toLocaleString()} pt</td>
					{/if}
					<td class="text-xs">{m.joinedAt}</td>
					{#if !data.live}<td class="text-xs">{m.mailOptIn ? '✔ 受信' : '—'}</td>{/if}
				</tr>
			{:else}
				<tr>
					<td colspan="7" class="px-3 py-8 text-center text-stone-400">該当する会員がいません</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
