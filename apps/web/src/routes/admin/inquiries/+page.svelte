<script lang="ts">
 import type { PageData } from './$types';
 import { STATES } from '$lib/inquiries';
 let {data}: {data: PageData} = $props();
</script>
<svelte:head><title>お問い合わせ | Book</title></svelte:head>
<div class="space-y-5">
 <div><h1>お問い合わせ</h1><p class="text-sm text-stone-600 mt-2">施設HPからのお問い合わせと、お客様とのやり取りを管理します。過去メールの回答もAI下書きの参考にできます。</p></div>
 {#if !data.unavailable}<p class="text-sm rounded border p-3 {data.health?.last_error || !data.health?.last_sync_at || Date.now()-Date.parse(data.health.last_sync_at)>600000?'bg-amber-50':'bg-white'}">返信取り込み：{data.health?.last_error?'エラーが発生しています。管理者へご確認ください。':data.health?.last_sync_at?`最終同期 ${new Date(data.health.last_sync_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}`:'接続確認待ちです。'} お客様の添付は施設のメールボックスで確認できます。</p>{/if}
 <form method="get" class="flex flex-wrap gap-3 items-center"><label>対応状況 <select name="status" value={data.status??''} class="rounded border p-2"><option value="">すべて</option>{#each Object.entries(STATES) as [key,label]}<option value={key}>{label}</option>{/each}</select></label><label>受付元 <select name="origin" value={data.origin??''} class="rounded border p-2"><option value="">すべて</option><option value="current">HP受付</option><option value="history">過去メール</option></select></label><button class="rounded border px-4 py-2">絞り込む</button></form>
 {#if data.unavailable}<p role="status" class="rounded-xl border bg-amber-50 p-4">{data.unavailable}</p>{:else if !data.items.length}<p class="rounded-xl border bg-white p-8">お問い合わせはありません。</p>{/if}
 <div class="grid gap-3">{#each data.items as item}<a class="block rounded-xl border bg-white p-4 hover:border-stone-500" href="/admin/inquiries/{item.id}"><div class="flex flex-wrap gap-3 justify-between"><strong>{item.subject || 'お問い合わせ'}</strong><span class="text-sm">{STATES[item.status]}</span></div><p class="mt-2 text-sm">{item.name} 様 ／ {item.assignee || '担当未設定'}</p><time class="text-xs text-stone-500">{new Date(item.updated_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'})}</time></a>{/each}</div>
 {#if !data.unavailable}<nav aria-label="ページ送り" class="flex gap-4 items-center">{#if (data.page??1)>1}<a class="underline" href="?status={encodeURIComponent(data.status??'')}&origin={encodeURIComponent(data.origin??'')}&page={(data.page??1)-1}">前へ</a>{/if}<span>{data.page??1}ページ</span>{#if data.more}<a class="underline" href="?status={encodeURIComponent(data.status??'')}&origin={encodeURIComponent(data.origin??'')}&page={(data.page??1)+1}">次へ</a>{/if}</nav>{/if}
</div>
