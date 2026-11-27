<script lang="ts">
	// VIP（特別会員）の専用ページの一覧（2026-11-27）。設定は取引先と同じ詳細画面 /admin/partners/<id>
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data } = $props();

	const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
	function statusOf(p: (typeof data.pages)[number]) {
		if (!p.isActive) return { label: '公開停止', cls: 'bg-stone-100 text-stone-600 ring-stone-500/20' };
		if (p.validFrom && today < p.validFrom) return { label: '公開前', cls: 'bg-amber-50 text-amber-800 ring-amber-600/20' };
		if (p.validUntil && today > p.validUntil) return { label: '期間終了', cls: 'bg-stone-50 text-stone-500 ring-stone-400/20' };
		return { label: '公開中', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' };
	}
</script>

<svelte:head><title>VIP（特別会員） ｜ 山人管理</title></svelte:head>

<PageHeader
	title="VIP（特別会員）"
	description="PMS の顧客マスタで VIP にしたお客様ごとの専用ページです。VIP を付けると自動で作られ、会員登録の前から料金（RMS の取引先料金）と特典を決められます。お客様は公式サイトの「PRIVATE BOOK」から、この料金・特典で予約します。ブランド共通の制度なので、全施設のページを出しています。"
/>

{#if data.error}
	<p class="mb-4 rounded-lg px-3 py-2 text-sm {data.live ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-900'}">{data.error}</p>
{/if}

{#if data.live && !data.error}
	<div class="overflow-hidden rounded-xl border border-stone-200 bg-white">
		{#each data.pages as p (p.id)}
			{@const st = statusOf(p)}
			<a href="/admin/partners/{p.id}" class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-stone-100 px-4 py-3 last:border-b-0 hover:bg-stone-50">
				<div class="min-w-0 flex-1">
					<p class="text-sm font-medium break-words text-stone-800 sm:truncate">
						{p.name}
						{#if p.members === 0}
							<!-- ご本人がまだ Book の会員ではない。会員登録すると、このページにご本人が入る -->
							<span class="ml-1 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600 ring-1 ring-inset ring-stone-500/20" title="ご本人が Book の会員登録をすると、このページを使えるようになります。料金は先に決めておけます">会員登録待ち</span>
						{:else if p.members}
							<span class="ml-1 text-xs font-normal text-stone-400">会員 {p.members}名</span>
						{/if}
					</p>
					<p class="mt-0.5 text-[11px] leading-5 text-stone-400">
						{p.ruleCount ? `公開ルール ${p.ruleCount}件` : '公開プラン未設定（お客様には「ふつうの料金」で出ます）'}
						{#if p.validFrom || p.validUntil}・公開期間 {p.validFrom ?? '—'} 〜 {p.validUntil ?? '—'}{/if}
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-1.5 sm:shrink-0">
					{#each p.facilities as f (f.id)}
						<span
							class={`rounded-full border px-2 py-0.5 text-[11px] ${f.enabled ? 'border-brand-800 bg-brand-50 text-brand-900' : 'border-stone-200 text-stone-400 line-through'}`}
							title={f.enabled ? (f.bookingEnabled ? '販売中・予約受付' : '販売中（予約受付なし）') : 'この施設では販売していません'}
						>{f.name}{#if f.enabled && f.bookingEnabled}・予約{/if}</span>
					{/each}
					<span class="rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset {st.cls}">{st.label}</span>
				</div>
			</a>
		{:else}
			<p class="p-4 text-sm text-stone-500">VIP の専用ページはまだありません。PMS の顧客マスタで VIP を付けると、ここに並びます。</p>
		{/each}
	</div>
{/if}
