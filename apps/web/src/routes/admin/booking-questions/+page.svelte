<script lang="ts">
	// 管理画面: 予約時に聞く項目のテンプレート（施設ごと）。プランの編集画面で「テンプレート」を選ぶと、ここの項目を聞く。
	import { enhance } from '$app/forms';
	import BookingQuestionsEditor from '$lib/components/admin/BookingQuestionsEditor.svelte';
	import { askConfirm } from '$lib/components/admin/confirm-dialog.svelte';
	import type { BookingQuestion } from '$lib/booking-questions';

	let { data, form } = $props();

	type Draft = { id: string | null; name: string; questions: BookingQuestion[]; sortOrder: number };
	const toDrafts = (): Draft[] =>
		data.templates.map((t) => ({ id: t.id, name: t.name, questions: structuredClone(t.questions), sortOrder: t.sortOrder }));
	// 保存・削除のあと（load のやり直し）に画面の値を DB の値へそろえる
	let drafts = $state<Draft[]>([]);
	$effect.pre(() => {
		drafts = toDrafts();
	});
	let adding = $state<Draft | null>(null);
	let busy = $state(false);

	const startAdd = () =>
		(adding = { id: null, name: '', questions: [], sortOrder: (data.templates.at(-1)?.sortOrder ?? 0) + 10 });

	// 保存・削除の送信。削除は確認してから（送るボタンの formaction で見分ける）
	const submitter = (d: Draft) => async ({ action, cancel }: { action: URL; cancel: () => void }) => {
		if (action.search.includes('delete')) {
			const used = (d.id && data.usage[d.id]?.length) || 0;
			const ok = await askConfirm({
				message: `テンプレート「${d.name}」を削除します。${used ? `使っている ${used} プランは「なし」に戻ります。` : ''}`,
				confirmLabel: '削除する',
				danger: true
			});
			if (!ok) return cancel();
		}
		busy = true;
		return async ({ result, update }: { result: { type: string }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
			await update({ reset: false });
			if (result.type === 'success') adding = null;
			busy = false;
		};
	};
	const inputClass = 'w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 text-sm';
</script>

<svelte:head><title>予約時に聞く項目 ｜ 山人管理</title></svelte:head>

<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
	<div>
		<h1 class="text-lg font-bold text-stone-800">予約時に聞く項目 — {data.currentFacility.name}</h1>
		<p class="mt-1 text-sm text-stone-500">
			送迎希望・記念日・夕食時間など、予約のときにお客様へ聞く項目のテンプレートです。各プランの編集画面で「テンプレートを使う」か「プラン独自に決める」かを選びます。
			回答は PMS の予約備考に入ります（公式サイト・取引先ページの両方の予約）。取引先ごとに足す項目は、取引先の設定で決めます。
		</p>
	</div>
	{#if data.live && !adding}
		<button type="button" onclick={startAdd} class="rounded-md bg-brand-800 px-4 py-2 text-sm text-white hover:bg-brand-700">＋ テンプレートを追加</button>
	{/if}
</div>

{#if data.loadError}<p class="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{data.loadError}</p>{/if}
{#if form?.error}<p class="mb-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{form.error}</p>{/if}
{#if form && 'saved' in form && form.saved}<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">保存しました。</p>{/if}
{#if form && 'deleted' in form && form.deleted}<p class="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">削除しました。使っていたプランは「なし」に戻りました。</p>{/if}

{#snippet card(d: Draft, isNew: boolean)}
	<form method="POST" action="?/save" use:enhance={submitter(d)} class="rounded-xl border border-stone-200 bg-white p-4">
		<input type="hidden" name="id" value={d.id ?? ''} />
		<input type="hidden" name="questions" value={JSON.stringify(d.questions)} />
		<div class="mb-3 grid gap-2 sm:grid-cols-[1fr_120px]">
			<label class="block">
				<span class="mb-0.5 block text-xs text-stone-500">テンプレート名</span>
				<input name="name" bind:value={d.name} maxlength="60" required placeholder="例: 2食付きの基本 / 記念日プラン" class={inputClass} />
			</label>
			<label class="block">
				<span class="mb-0.5 block text-xs text-stone-500">並び順</span>
				<input name="sort_order" type="number" bind:value={d.sortOrder} class={inputClass} />
			</label>
		</div>
		<BookingQuestionsEditor bind:questions={d.questions} />
		{#if !isNew && d.id}
			{@const used = data.usage[d.id] ?? []}
			<p class="mt-3 text-xs text-stone-500">
				使っているプラン:
				{#if used.length}
					{#each used as p, i (p.id)}{i ? '・' : ''}<a href="/admin/plans/{p.id}" class="underline hover:text-stone-700">{p.name}</a>{/each}
				{:else}
					なし
				{/if}
			</p>
		{/if}
		<div class="mt-3 flex flex-wrap gap-2">
			<button type="submit" disabled={busy || !data.live} class="rounded-md bg-brand-800 px-5 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-40">保存</button>
			{#if isNew}
				<button type="button" onclick={() => (adding = null)} class="rounded-md border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50">やめる</button>
			{:else}
				<button
					type="submit"
					formaction="?/delete"
					disabled={busy || !data.live}
					class="rounded-md border border-rose-300 px-4 py-2 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-40">削除</button
				>
			{/if}
		</div>
	</form>
{/snippet}

<div class="grid gap-4">
	{#if adding}
		{@render card(adding, true)}
	{/if}
	{#each drafts as d (d.id)}
		{@render card(d, false)}
	{:else}
		{#if !adding}
			<p class="rounded-xl border border-dashed border-stone-300 bg-white px-4 py-6 text-center text-sm text-stone-500">まだテンプレートはありません。「＋ テンプレートを追加」から作ります。</p>
		{/if}
	{/each}
</div>
