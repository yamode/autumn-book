<script lang="ts">
	// 会員詳細の「アンバサダー」欄（docs/ambassador.md §8）。
	// 付ける・外す・コードの再発行・招待した人の一覧（実名）と無効化・この会員の紹介元。
	import { enhance } from '$lib/enhance';
	import { inviteUrl, REFERRAL_STATUS_LABEL } from '$lib/ambassador';
	import type { AdminMemberAmbassador } from '$lib/server/ambassador';

	let {
		amb,
		isAdmin,
		withdrawn,
		origin
	}: { amb: AdminMemberAmbassador | null; isAdmin: boolean; withdrawn: boolean; origin: string } = $props();

	const a = $derived(amb?.ambassador ?? null);
	const stayed = $derived((amb?.referrals ?? []).filter((r) => r.status === 'active' && r.visits > 0).length);
	const visits = $derived((amb?.referrals ?? []).filter((r) => r.status === 'active').reduce((s, r) => s + r.visits, 0));
</script>

<section class="rounded-xl border border-stone-200 bg-white p-5">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h2 class="text-sm font-medium text-stone-700">
			アンバサダー
			{#if a?.isActive}<span class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">アンバサダー</span>{/if}
		</h2>
		<a href="/admin/ambassadors" class="text-xs text-accent-600 hover:underline">アンバサダーの一覧・設定</a>
	</div>

	{#if !amb}
		<p class="mt-2 text-sm text-stone-400">この環境ではアンバサダーを扱えません。</p>
	{:else}
		{#if a}
			<dl class="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
				<div class="flex gap-2"><dt class="shrink-0 text-stone-400">状態</dt><dd>{a.isActive ? '有効' : `外しています（${a.revokedAt?.slice(0, 10) ?? ''}）`}</dd></div>
				<div class="flex gap-2"><dt class="shrink-0 text-stone-400">招待コード</dt><dd class="font-mono tracking-wider">{a.code}</dd></div>
				<div class="flex gap-2 sm:col-span-2"><dt class="shrink-0 text-stone-400">招待 URL</dt><dd class="break-all font-mono text-xs">{inviteUrl(origin, a.code)}</dd></div>
				<div class="flex gap-2"><dt class="shrink-0 text-stone-400">紹介実績</dt><dd>ご宿泊 {stayed} 名・延べ {visits} 回（招待でご登録 {amb.referrals.filter((r) => r.status !== 'void').length} 名）</dd></div>
				<div class="flex gap-2"><dt class="shrink-0 text-stone-400">付けたポイント</dt><dd>{a.pointsTotal.toLocaleString()} pt</dd></div>
			</dl>
		{:else}
			<p class="mt-2 text-sm text-stone-500">アンバサダーにすると、この会員に招待コードができます。招待コードで会員登録した方がご宿泊（チェックアウト）すると紹介実績に数え、ポイントを付けます。</p>
		{/if}

		{#if isAdmin}
			<div class="mt-3 flex flex-wrap gap-2">
				{#if !a?.isActive}
					<form method="POST" action="?/ambassadorOn" use:enhance>
						<button class="rounded-md bg-amber-900 px-3 py-1.5 text-sm text-white disabled:opacity-50" disabled={withdrawn}>アンバサダーにする</button>
					</form>
				{:else}
					<form
						method="POST"
						action="?/ambassadorReissue"
						use:enhance
						onsubmit={(e) => {
							if (!confirm('招待コードを作り直します。今のコード・URL は使えなくなります。よろしいですか？')) e.preventDefault();
						}}
					>
						<button class="rounded-md border border-stone-300 px-3 py-1.5 text-sm">コードを作り直す</button>
					</form>
					<form
						method="POST"
						action="?/ambassadorOff"
						use:enhance
						onsubmit={(e) => {
							if (!confirm('アンバサダーを外します。新しい招待は受けなくなり、見返りのポイントも付かなくなります（これまでの実績は残ります）。よろしいですか？')) e.preventDefault();
						}}
					>
						<button class="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700">アンバサダーを外す</button>
					</form>
				{/if}
			</div>
		{/if}

		{#if amb.referrals.length}
			<h3 class="mt-4 text-xs font-medium text-stone-500">招待した方</h3>
			<div class="mt-1 divide-y divide-stone-100 text-sm">
				{#each amb.referrals as r (r.memberUserId)}
					<div class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
						<a href="/admin/members/{r.memberUserId}" class="text-accent-600 hover:underline">{r.name || r.memberCode}</a>
						<span class="text-xs text-stone-400">{r.registeredAt.slice(0, 10)} 登録</span>
						<span class="min-w-0 flex-1 text-xs text-stone-600">
							{#if r.visits > 0}ご宿泊 {r.visits} 回・{r.nights} 泊（初回 {r.firstStayOn}）{:else}まだご宿泊なし{/if}
							{#if r.points}・{r.points.toLocaleString()} pt{/if}
						</span>
						<span class="text-xs {r.status === 'active' ? 'text-emerald-700' : 'text-stone-400'}">{REFERRAL_STATUS_LABEL[r.status]}</span>
						{#if isAdmin}
							<form method="POST" action="?/referralVoid" use:enhance>
								<input type="hidden" name="referred" value={r.memberUserId} />
								<input type="hidden" name="void" value={r.status === 'active' ? '1' : '0'} />
								<button class="text-xs text-stone-500 hover:underline">{r.status === 'void' ? '有効に戻す' : r.status === 'ineligible' ? '対象にする' : '無効にする'}</button>
							</form>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if amb.invitedBy}
			<p class="mt-3 text-sm text-stone-600">
				紹介元: <a href="/admin/members/{amb.invitedBy.memberUserId}" class="text-accent-600 hover:underline">{amb.invitedBy.name || amb.invitedBy.memberCode}</a>
				様（アンバサダー）のご招待・<span class="font-mono text-xs">{amb.invitedBy.codeUsed}</span>
				<span class="text-xs text-stone-400">（{REFERRAL_STATUS_LABEL[amb.invitedBy.status]}）</span>
			</p>
		{/if}
	{/if}
</section>
