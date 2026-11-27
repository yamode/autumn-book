<script lang="ts">
	import { enhance } from '$lib/enhance';
	import type { SubmitFunction } from '@sveltejs/kit';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';
	import { shareRatesText } from '$lib/ambassador';

	let { data, form } = $props();
	const keep: SubmitFunction = () => async ({ update }) => update({ reset: false });

	function couponLabel(c: { name: string; discount_type: string; discount_value: number; valid_until: string }) {
		const off = c.discount_type === 'percent' ? `${c.discount_value}%引き` : `${c.discount_value.toLocaleString()}円引き`;
		return `${c.name}（${off}・${c.valid_until} まで）`;
	}
</script>

<svelte:head><title>アンバサダー ｜ 山人管理</title></svelte:head>

<PageHeader
	title="アンバサダー"
	description="招待コードで会員登録を促す会員です。付ける・外すのは会員詳細から（管理者）。紹介実績は、招待で登録した方のチェックアウト済みの直販のご宿泊で数えます。"
/>

{#if data.unavailable}
	<p class="rounded-lg bg-stone-100 px-3 py-2 text-sm text-stone-600">この環境ではアンバサダーを扱えません（本番接続のときだけ使えます）。</p>
{:else}
	{#if form?.saved}<p class="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">設定を保存しました（監査ログに記録）。</p>{/if}
	{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>{/if}

	<section class="mb-5 max-w-3xl rounded-xl border border-stone-200 bg-white p-4 text-sm">
		<h2 class="mb-1 font-medium text-stone-800">制度の設定</h2>
		{#if data.program}
			<p class="mb-3 text-xs leading-relaxed text-stone-500">
				アンバサダーへの見返り: 招待した方の<strong>初めてのご宿泊</strong>で {data.program.firstPoints.toLocaleString()}pt。
				2回目以降は、その方の Book のご予約の基準額（税抜・クーポン等を引いた額）× 割合（招待で登録した日からの年数で下げる: {shareRatesText(data.program.shareRates)}）。
				電話など Book 以外のご宿泊は実績と初回には数えますが、割合の分は付けません。毎日 12:30 にまとめて付けます。
			</p>
			<form method="POST" action="?/save" use:enhance={keep} class="grid gap-3 sm:grid-cols-2">
				<label class="block">
					<span class="text-xs text-stone-500">初めてのご宿泊で付けるポイント</span>
					<input name="firstPoints" inputmode="numeric" value={data.program.firstPoints} disabled={!data.isAdmin} class="mt-1 w-40 rounded-md border border-stone-300 px-3 py-2 text-right" />
				</label>
				<label class="block">
					<span class="text-xs text-stone-500">2回目以降の割合（%・1年目から順にカンマ区切り）</span>
					<input name="shareRates" value={data.program.shareRates.join(', ')} disabled={!data.isAdmin} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" placeholder="2, 1, 0.5" />
				</label>
				<label class="block sm:col-span-2">
					<span class="text-xs text-stone-500">招待された方に配るクーポン（初回宿泊特典・会員登録のときに1枚）</span>
					<select name="inviteCouponId" disabled={!data.isAdmin} class="mt-1 w-full rounded-md border border-stone-300 px-3 py-2">
						<option value="" selected={!data.program.inviteCouponId}>配らない</option>
						{#each data.coupons as c (c.id)}
							<option value={c.id} selected={data.program.inviteCouponId === c.id}>{couponLabel(c)}</option>
						{/each}
					</select>
					<span class="mt-1 block text-xs text-stone-400">クーポンは「クーポン」の画面で作ります（例: 3,000円引き）。使える期間が切れたクーポンは配られません。宿泊歴のある方が招待コードで登録しても配りません。</span>
				</label>
				{#if data.isAdmin}
					<div class="sm:col-span-2"><button class="rounded-md bg-amber-900 px-4 py-2 text-white">保存</button></div>
				{:else}
					<p class="text-xs text-stone-400 sm:col-span-2">設定を変えられるのは管理者だけです。</p>
				{/if}
			</form>
		{:else}
			<p class="text-xs text-red-700">設定を読めませんでした。</p>
		{/if}
	</section>

	<section class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
		<h2 class="mb-2 font-medium text-stone-800">アンバサダー（{data.rows.filter((r) => r.isActive).length} 名）</h2>
		<div class="overflow-x-auto">
			<table class="w-full min-w-[640px] text-left">
				<thead class="text-xs text-stone-500">
					<tr>
						<th class="py-2 pr-3 font-normal">会員</th>
						<th class="py-2 pr-3 font-normal">招待コード</th>
						<th class="py-2 pr-3 text-right font-normal">ご宿泊した方</th>
						<th class="py-2 pr-3 text-right font-normal">延べ回数</th>
						<th class="py-2 pr-3 text-right font-normal">招待で登録</th>
						<th class="py-2 pr-3 text-right font-normal">付けたポイント</th>
						<th class="py-2 font-normal">状態</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-stone-100">
					{#each data.rows as r (r.memberUserId)}
						<tr class={r.isActive ? '' : 'text-stone-400'}>
							<td class="py-2 pr-3"><a href="/admin/members/{r.memberUserId}" class="text-accent-600 hover:underline">{r.name || r.memberCode}</a></td>
							<td class="py-2 pr-3 font-mono text-xs tracking-wider">{r.code}</td>
							<td class="py-2 pr-3 text-right font-medium">{r.stayed}</td>
							<td class="py-2 pr-3 text-right">{r.visits}</td>
							<td class="py-2 pr-3 text-right">{r.registered}</td>
							<td class="py-2 pr-3 text-right">{r.pointsTotal.toLocaleString()} pt</td>
							<td class="py-2 text-xs">{r.isActive ? '有効' : '外しています'}</td>
						</tr>
					{:else}
						<tr><td colspan="7" class="py-4 text-stone-400">まだアンバサダーはいません。会員詳細の「アンバサダーにする」から付けます。</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
{/if}
