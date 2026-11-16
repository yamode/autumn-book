<script lang="ts">
	import { enhance } from '$lib/enhance';
	import PageHeader from '$lib/components/admin/PageHeader.svelte';

	let { data, form } = $props();
	const labels = { spam: '宣伝・迷惑投稿', abuse: '誹謗中傷など', privacy: '個人情報', other: 'その他' };
	const status = $derived(data.resolved ? 'resolved' : 'open');

	function confirmHide(event: SubmitEvent, firstPost: boolean) {
		const submitter = event.submitter as HTMLButtonElement | null;
		if (submitter?.value === 'hidden' && !confirm(firstPost ? 'この話題全体を非表示にしますか？' : 'この投稿を非表示にしますか？')) event.preventDefault();
	}
</script>

<svelte:head><title>通報の確認 ｜ 山人管理</title></svelte:head>
<PageHeader title="通報の確認" description="届いた通報を確認し、掲載を続けるか非表示にするかを決めます。" />
<a href="/admin/community" class="mb-4 inline-flex min-h-11 items-center text-sm text-brand-800 underline">コミュニティ管理へ戻る</a>
<nav class="mb-4 flex flex-wrap gap-2" aria-label="通報の状態">
	<a href="?status=open" aria-current={!data.resolved ? 'page' : undefined} class="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm {!data.resolved ? 'border-brand-800 bg-brand-50' : 'border-stone-200'}">未対応</a>
	<a href="?status=resolved" aria-current={data.resolved ? 'page' : undefined} class="inline-flex min-h-11 items-center rounded-lg border px-3 text-sm {data.resolved ? 'border-brand-800 bg-brand-50' : 'border-stone-200'}">対応済み</a>
</nav>
{#if form?.message}<p class="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800" role="alert">{form.message}</p>{/if}
{#if form?.resolved}<p class="mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status">対応を記録しました。</p>{/if}
{#if data.loadError}
	<p class="rounded-lg bg-red-50 p-4 text-sm text-red-800" role="alert">通報を読み込めませんでした。運営権限や接続をご確認ください。</p>
{:else if data.reports.length === 0}
	<p class="rounded-xl border border-dashed p-5 text-sm text-stone-600">{data.resolved ? '対応済みの通報はありません。' : '未対応の通報はありません。'}</p>
{:else}
	<ul class="space-y-3">
		{#each data.reports as report (report.id)}
			<li class="min-w-0 rounded-xl border border-stone-200 bg-white p-4">
				<p class="flex flex-wrap gap-2 text-xs text-stone-600">
					<span class="rounded-full bg-amber-50 px-2 py-0.5 text-amber-900">{labels[report.reason]}</span>
					<time class="py-0.5" datetime={report.created_at}>{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Tokyo' }).format(new Date(report.created_at))}</time>
					{#if report.resolution}<span class="py-0.5">{report.resolution === 'hidden' ? '非表示で対応済み' : '掲載のまま対応済み'}</span>{/if}
				</p>
				<h2 class="mt-2 break-words font-medium text-brand-900">{report.title} #{report.post_no}</h2>
				{#if report.note}<p class="mt-2 break-words text-sm text-stone-700">{report.note}</p>{/if}
				<details class="mt-3">
					<summary class="cursor-pointer py-1 text-sm font-medium text-stone-700">通報された投稿を表示</summary>
					<p class="mt-2 whitespace-pre-wrap break-words rounded-lg bg-stone-50 p-3 text-sm">{report.excerpt}</p>
				</details>
				{#if !report.hidden}<a href="/community/threads/{report.thread_id}#post-{report.post_no}" class="mt-2 inline-flex min-h-10 items-center text-sm text-brand-800 underline">話題を開く</a>{/if}
				{#if !report.resolved_at || !report.hidden}
					<form method="POST" action="?/resolve" use:enhance onsubmit={(event) => confirmHide(event, report.post_no === 1)} class="mt-3 flex flex-wrap gap-2">
						<input type="hidden" name="id" value={report.id} />
						{#if !report.resolved_at}
							<button name="resolution" value="reviewed" class="min-h-11 rounded-lg border border-stone-200 px-3 text-sm">確認済みにする</button>
						{/if}
						{#if !report.hidden}
							<button name="resolution" value="hidden" class="min-h-11 rounded-lg border border-red-200 px-3 text-sm text-red-800">{report.post_no === 1 ? '話題を非表示' : '投稿を非表示'}</button>
						{/if}
					</form>
				{/if}
			</li>
		{/each}
	</ul>
{/if}
{#if data.page > 1 || data.hasNext}
	<div class="mt-4 flex flex-wrap gap-3 text-sm">
		{#if data.page > 1}<a class="px-3 py-2 underline" href="?status={status}&page={data.page - 1}">前のページ</a>{/if}
		{#if data.hasNext}<a class="px-3 py-2 underline" href="?status={status}&page={data.page + 1}">次のページ</a>{/if}
	</div>
{/if}
