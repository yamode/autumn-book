<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	let creating = $state(false);
	const inputCls = 'w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-sm';

	const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
	function statusOf(p: (typeof data.partners)[number]) {
		if (!p.isActive) return { label: '公開停止', cls: 'bg-stone-600 text-white' };
		if (p.validFrom && today < p.validFrom) return { label: '公開前', cls: 'bg-amber-500 text-white' };
		if (p.validUntil && today > p.validUntil) return { label: '期間終了', cls: 'bg-stone-200 text-stone-600' };
		return { label: '公開中', cls: 'bg-emerald-500 text-white' };
	}
	const adjustRules = (p: (typeof data.partners)[number]) => p.pricing.rules.filter((r) => r.action === 'adjust').length;
	const hideRules = (p: (typeof data.partners)[number]) => p.pricing.rules.filter((r) => r.action === 'hide').length;
</script>

<svelte:head><title>取引先 ｜ 山人管理</title></svelte:head>

<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="mb-1 text-lg font-bold text-stone-800">取引先 — {data.facilityName}</h1>
		<p class="max-w-3xl text-xs text-stone-400">
			旅行会社・法人などの取引先ごとに特別レートを決めて、限定URL（ログインIDとパスワードで見る料金カレンダー・予約）と
			REST API（API キー）で公開します。基準は料金マスタの理論値（1名・税込・入湯税別）です。
		</p>
	</div>
	{#if data.canEdit && data.live && !data.error}
		<button
			type="button"
			onclick={() => (creating = !creating)}
			class="rounded-lg bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700"
		>＋ 取引先を追加</button>
	{/if}
</div>

{#if data.error}
	<p class="mb-4 rounded-lg px-3 py-2 text-sm {data.live ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}">{data.error}</p>
{/if}
{#if form?.message}
	<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{form.message}</p>
{/if}
{#if !data.canEdit && data.live && !data.error}
	<p class="mb-4 text-xs text-stone-500">取引先の追加・編集は管理者だけができます（スタッフは閲覧のみ）。</p>
{/if}

{#if creating}
	<form method="POST" action="?/create" use:enhance class="mb-4 space-y-3 rounded-xl border border-stone-200 bg-white p-5">
		<h2 class="text-sm font-bold text-stone-700">取引先を追加</h2>
		<div class="grid gap-3 sm:grid-cols-[1fr_220px]">
			<label class="block text-sm">
				<span class="text-xs text-stone-500">取引先名</span>
				<input name="name" required maxlength="120" placeholder="例: ○○トラベル 秋田支店" class="mt-0.5 {inputCls}" autocomplete="off" />
			</label>
			<label class="block text-sm">
				<span class="text-xs text-stone-500">種別</span>
				<select name="kind" class="mt-0.5 {inputCls}">
					{#each Object.entries(data.kindLabels) as [value, label]}
						<option {value}>{label}</option>
					{/each}
				</select>
			</label>
		</div>
		<p class="text-xs text-stone-400">作成直後は「公開停止」です。特別レートとログインIDを設定してから公開してください。</p>
		<div class="flex gap-2">
			<button type="submit" class="rounded-lg bg-brand-800 px-6 py-2 text-sm text-white hover:bg-brand-700">作成して設定へ</button>
			<button type="button" onclick={() => (creating = false)} class="rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700 hover:bg-stone-50">キャンセル</button>
		</div>
	</form>
{/if}

{#if data.live && !data.error}
	<div class="overflow-hidden rounded-xl border border-stone-200 bg-white">
		{#each data.partners as p (p.id)}
			{@const st = statusOf(p)}
			<a href="/admin/partners/{p.id}" class="flex flex-wrap items-center gap-3 border-b border-stone-100 p-3 last:border-b-0 hover:bg-stone-50">
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium text-stone-800">
						{p.name}
						<span class="ml-1 text-xs font-normal text-stone-400">{data.kindLabels[p.kind]}</span>
					</p>
					<p class="mt-0.5 text-[11px] text-stone-400">
						ログインID {p.activeAccounts}/{p.accounts}（利用可/発行数）・API キー {p.apiKeys}
						・{adjustRules(p) ? `公開ルール ${adjustRules(p)}件` : '公開プラン未設定'}{hideRules(p) ? `・非表示ルール ${hideRules(p)}件` : ''}
						{#if p.validFrom || p.validUntil}・公開期間 {p.validFrom ?? '—'} 〜 {p.validUntil ?? '—'}{/if}
					</p>
				</div>
				<div class="flex shrink-0 items-center gap-1.5">
					{#if p.bookingEnabled}<span class="rounded-full bg-brand-100 px-2 py-0.5 text-[11px] text-brand-800">予約受付</span>{/if}
					<span class="rounded-full px-2 py-0.5 text-[11px] {st.cls}">{st.label}</span>
				</div>
			</a>
		{:else}
			<p class="p-4 text-sm text-stone-500">まだ取引先がありません。</p>
		{/each}
	</div>
{/if}
