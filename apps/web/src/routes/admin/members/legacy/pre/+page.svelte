<script lang="ts">
	// 旧会員（tripla）の手続き前の確認。照合が「候補あり」の旧会員に、紐づける PMS の顧客を先に決めておく。
	import { enhance } from '$lib/enhance';
	import type { SubmitFunction } from '@sveltejs/kit';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data, form } = $props();

	type Tab = 'open' | 'link' | 'reject';
	let tab = $state<Tab>('open');
	let q = $state('');

	const failure = $derived(
		form && 'message' in form && form.message ? { message: String(form.message), legacyId: 'legacyId' in form ? (form.legacyId as string | undefined) : undefined } : null
	);

	const counts = $derived({
		open: data.items.filter((i) => !i.decision).length,
		link: data.items.filter((i) => i.decision === 'link').length,
		reject: data.items.filter((i) => i.decision === 'reject').length
	});

	// 氏名・カナ・メール・電話で絞る（空白・ハイフンは無視）
	const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[\s　\-‐ー－]/g, '');
	const shown = $derived(
		data.items.filter((i) => {
			const inTab = tab === 'open' ? !i.decision : i.decision === tab;
			if (!inTab) return false;
			const k = norm(q);
			if (!k) return true;
			return [i.name, i.kana, i.email, i.phone].some((v) => norm(v).includes(k));
		})
	);

	// 比べ方（数字だけ／空白を除く／大文字小文字を無視）。一致は緑、食い違いは赤で示す
	const digits = (s: string | null) => (s ?? '').replace(/\D/g, '');
	const compact = (s: string | null) => (s ?? '').replace(/[\s　]/g, '');
	const lower = (s: string | null) => (s ?? '').trim().toLowerCase();
	function tone(a: string | null, b: string | null, f: (s: string | null) => string) {
		if (!f(a) || !f(b)) return '';
		return f(a) === f(b) ? 'text-emerald-700' : 'font-medium text-red-700';
	}

	const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ja-JP') : '—');
	const DONE_LABEL = {
		prelink: '紐づける顧客を決めました。お客様が手続きを済ませると、その場で紐づきます。',
		prereject: '紐づけないと決めました。お客様が手続きを済ませると、新しい顧客になります。',
		preundo: '決めた内容を取り消しました。'
	} as const;

	const confirmLink =
		(name: string | null): SubmitFunction =>
		({ cancel }) => {
			if (!confirm(`「${name ?? '（氏名なし）'}」に紐づけると決めます。お客様が手続きを済ませたら、確認なしでこの顧客のプロフィール・予約がマイページに出ます。PMS で氏名・電話・住所を照らし合わせましたか？`)) cancel();
		};
</script>

<svelte:head><title>旧会員の手続き前の確認 ｜ 山人管理</title></svelte:head>

<PageHeader
	title="旧会員の手続き前の確認"
	description="照合が「候補あり」の旧会員（tripla）について、お客様が移行の手続きをする前に、紐づける PMS の顧客を決めておきます。"
/>

<p class="mb-3 text-sm"><a href="/admin/members/legacy" class="text-accent-600 hover:underline">← 旧会員の確認（手続き済み）へ</a></p>

<section class="mb-5 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900">
	<p>
		ここで「紐づける」と決めた旧会員は、お客様が手続きを済ませたときに<strong>職員の確認なしでその顧客に紐づき</strong>、その顧客のプロフィール・予約がマイページに出ます。
		<strong>PMS で氏名・電話番号・住所を照らし合わせ、</strong>メール・電話が食い違う（赤字）ときは<strong>PMS の電話番号へ宿から電話して、ご本人か確かめてから</strong>決めてください。
		確信が持てないときは決めずに残してください（手続きの後に「旧会員の確認」で確かめられます）。
	</p>
	<p class="mt-2 text-xs text-amber-800">
		同じ方が PMS で複数の顧客に分かれているときは、先に PMS の重複チェックで統合してから決めてください（ランクは紐づけた顧客の利用回数だけで決まります）。
		決めた顧客に手続きまでの間に別の会員が付いたり、統合で消えたりしたときは、自動では紐づかず「旧会員の確認」の確認待ちに回ります。
	</p>
</section>

{#if !data.live}
	<div class="mb-4 rounded-lg border border-stone-200 bg-white p-3 text-sm text-stone-500">
		この環境では使えません（DATA_SOURCE / AUTH_MODE が supabase ではありません）。
	</div>
{/if}
{#if data.error}
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{data.error}</div>
{/if}
{#if failure && !failure.legacyId}
	<div class="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{failure.message}</div>
{/if}
{#if form && 'done' in form && form.done}
	<div class="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{DONE_LABEL[form.done]}</div>
{/if}

<div class="mb-4 flex flex-wrap items-center gap-2">
	{#each [['open', '未決定'], ['link', '紐づける予定'], ['reject', '紐づけない予定']] as [key, label] (key)}
		<button
			type="button"
			onclick={() => (tab = key as Tab)}
			class="min-h-9 rounded-full border px-4 text-sm {tab === key ? 'border-brand-800 bg-brand-800 text-white' : 'border-stone-300 bg-white text-stone-700 hover:border-stone-500'}"
		>
			{label}（{counts[key as Tab]}）
		</button>
	{/each}
	<input bind:value={q} placeholder="氏名・カナ・メール・電話で絞る" class="ml-auto min-h-9 w-64 rounded-md border border-stone-300 px-3 text-sm" />
</div>

<div class="space-y-4">
	{#each shown as item (item.id)}
		<article class="rounded-xl border border-stone-200 bg-white p-4 text-sm">
			<div class="min-w-0">
				<p class="text-xs text-stone-400">以前の登録（tripla）・登録日 {fmtDate(item.registered_on)}</p>
				<p class="font-medium text-stone-900">
					{item.name ?? '（氏名なし）'}
					{#if item.kana}<span class="ml-1 text-xs font-normal text-stone-500">{item.kana}</span>{/if}
				</p>
				<p class="mt-0.5 text-xs text-stone-500">{item.email}・{item.phone ?? '電話なし'}</p>
			</div>
			{#if failure && failure.legacyId === item.id}
				<p class="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{failure.message}</p>
			{/if}

			{#if item.decision}
				{@const g = item.candidates.find((c) => c.guest_id === item.decided_guest_id)}
				<div class="mt-3 rounded-lg px-3 py-2 text-xs {item.decision === 'link' ? 'bg-emerald-50 text-emerald-800' : 'bg-stone-100 text-stone-700'}">
					{#if item.decision === 'link'}
						紐づける予定：{g?.name ?? '—'}（{g?.kana ?? '—'}）・{g?.phone ?? '電話なし'}・公式・直販 {(g?.direct_visits ?? 0).toLocaleString()} 回
					{:else}
						紐づけない予定（手続きでは新しい顧客になります）
					{/if}
					<span class="text-stone-500">・{fmtDate(item.reviewed_at)}{item.review_note ? `・${item.review_note}` : ''}</span>
				</div>
				<form method="POST" action="?/preundo" use:enhance class="mt-3">
					<input type="hidden" name="legacyId" value={item.id} />
					<button class="min-h-9 rounded-md border border-stone-300 bg-white px-4 text-sm text-stone-700 hover:border-stone-500">決めた内容を取り消す</button>
				</form>
			{:else}
				<h3 class="mb-1 mt-4 text-xs font-medium text-stone-500">PMS の顧客の候補</h3>
				<div class="overflow-x-auto rounded-lg border border-stone-200">
					<table class="w-full min-w-[860px] text-xs">
						<thead>
							<tr class="border-b border-stone-200 bg-stone-50 text-left text-stone-500">
								<th class="px-2 py-1.5">氏名</th>
								<th class="px-2">フリガナ</th>
								<th class="px-2">電話</th>
								<th class="px-2">メール</th>
								<th class="px-2 text-right">公式・直販</th>
								<th class="px-2">最後の宿泊</th>
								<th class="px-2">紐づけ</th>
							</tr>
						</thead>
						<tbody>
							{#each item.candidates as c (c.guest_id)}
								<tr class="border-b border-stone-100 align-top last:border-0">
									<td class="px-2 py-2 font-medium {tone(c.name, item.name, compact) || 'text-stone-800'}">{c.name ?? '—'}</td>
									<td class="px-2 py-2 {tone(c.kana, item.kana, compact)}">{c.kana ?? '—'}</td>
									<td class="px-2 py-2 {tone(c.phone, item.phone, digits)}">{c.phone ?? '—'}</td>
									<td class="px-2 py-2 break-all {tone(c.email, item.email, lower)}">{c.email ?? '—'}</td>
									<td class="px-2 py-2 text-right">{c.direct_visits.toLocaleString()} 回</td>
									<td class="px-2 py-2">{fmtDate(c.last_stay)}</td>
									<td class="px-2 py-2">
										{#if c.has_member}
											<span class="text-stone-400">別の会員が紐づいています</span>
										{:else if c.other_legacy}
											<span class="text-stone-400">別の旧会員が紐づく予定です</span>
										{:else}
											<form method="POST" action="?/prelink" use:enhance={confirmLink(c.name)} class="flex flex-col gap-1.5">
												<input type="hidden" name="legacyId" value={item.id} />
												<input type="hidden" name="guestId" value={c.guest_id} />
												<input name="note" placeholder="メモ（任意）" maxlength="500" class="w-44 rounded-md border border-stone-300 px-2 py-1" />
												<button class="w-fit rounded-md bg-brand-800 px-3 py-1.5 text-white hover:bg-brand-700">この顧客に紐づける</button>
											</form>
										{/if}
									</td>
								</tr>
							{:else}
								<tr><td colspan="7" class="px-2 py-3 text-stone-400">候補はありません。</td></tr>
							{/each}
						</tbody>
					</table>
				</div>

				<form method="POST" action="?/prereject" use:enhance class="mt-4 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
					<input type="hidden" name="legacyId" value={item.id} />
					<label class="block min-w-0 flex-1">
						<span class="text-xs text-stone-500">紐づけない理由（必須）</span>
						<input name="note" required maxlength="500" placeholder="例: 候補はいずれも別人（電話・住所が一致しない）" class="mt-1 w-full rounded-md border border-stone-300 px-2 py-1.5" />
					</label>
					<button class="min-h-9 rounded-md border border-stone-300 bg-white px-4 text-sm text-stone-700 hover:border-stone-500">紐づけない</button>
				</form>
			{/if}
		</article>
	{:else}
		<p class="rounded-xl border border-stone-200 bg-white px-4 py-8 text-center text-sm text-stone-400">該当する旧会員はいません</p>
	{/each}
</div>
