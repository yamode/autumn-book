<script lang="ts">
 import { enhance } from '$app/forms';
 import { untrack } from 'svelte';
 import { invalidateAll } from '$app/navigation';
 import type { PageData, ActionData } from './$types';
 import { STATES } from '$lib/inquiries';
 let {data,form}: {data:PageData;form:ActionData}=$props();
 let body=$state(untrack(()=>form && 'body' in form && typeof form.body==='string'?form.body:data.item.draft)), busy=$state(false);
 let loadedId='', loadedDraft='';
 $effect(()=>{
  const draft=data.item.draft;
  if(form && 'body' in form && typeof form.body==='string') body=form.body;
  else if(loadedId!==data.item.id || loadedDraft!==draft) body=draft;
  loadedId=data.item.id;loadedDraft=draft;
 });
 const time=(s:string)=>new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'});
 const direction:Record<string,string>={'in':'お客様','out':'担当者の回答',receipt:'受付控え',notice:'担当者通知'};
 const messageStates:Record<string,string>={received:'受信済み',queued:'送信待ち',sending:'送信処理中',sent:'送信済み',failed:'送信失敗',uncertain:'送信結果の確認が必要'};
</script>
<svelte:head><title>{data.item.subject} | お問い合わせ</title></svelte:head>
<div class="space-y-5">
 <div class="flex flex-wrap gap-3 justify-between"><a href="/admin/inquiries" class="underline">← お問い合わせ一覧</a><button class="border rounded px-3 py-1" onclick={()=>invalidateAll()}>履歴を更新</button></div>
 <header><h1>{data.item.subject || 'お問い合わせ'}</h1><p class="mt-2">{data.item.name} 様 ／ {data.item.email}</p><div class="text-sm mt-2">{#each Object.entries(data.item.profile) as [key,value]}{#if value&&key!=='history_account'}<span class="inline-block mr-4">{key==='source'?'受付元':key}：{value}</span>{/if}{/each}</div></header>
 {#if data.item.profile.history_account}<p class="rounded border bg-amber-50 p-3 text-sm">過去のinfoメールから取り込んだ履歴です。回答当時の条件を含みます。現在の運用と照らして確認してください。取り込みによるメール送信は行いません。</p>{/if}
 {#if form?.message}<p role="status" class="rounded-xl border bg-amber-50 p-4 whitespace-pre-wrap">{form.message}</p>{/if}
 <form method="post" use:enhance class="rounded-xl border bg-white p-4 flex flex-wrap items-end gap-3">
  <input type="hidden" name="revision" value={data.item.revision}/><input type="hidden" name="action" value="status"/>
  <label>状況<select name="status" class="block border rounded p-2">{#each Object.entries(STATES) as [key,label]}<option value={key} selected={data.item.status===key}>{label}</option>{/each}</select></label>
  <label>担当者<input name="assignee" value={data.item.assignee} maxlength="100" class="block border rounded p-2"/></label><button class="rounded border px-4 py-2">保存</button>
 </form>
 <div class="grid xl:grid-cols-2 gap-5 items-start">
  <section aria-label="やり取りの履歴" class="space-y-3 min-w-0"><h2 class="font-semibold">やり取りの履歴</h2>
   {#each data.messages as message}<article class="rounded-xl border bg-white p-4 min-w-0">
    <div class="flex flex-wrap justify-between gap-2 text-sm"><strong>{direction[message.direction]}</strong><span>{messageStates[message.state]} ／ {time(message.created_at)}</span></div>
    <p class="whitespace-pre-wrap break-words mt-3 text-sm">{message.body}</p>
    {#if message.error}<p class="mt-3 text-sm text-red-800">{message.error}</p>{/if}
    {#if message.state==='failed' || message.state==='uncertain'}<form method="post" use:enhance onsubmit={(e)=>{if(!confirm(message.state==='failed'?'同じ内容を再送しますか？':((e.submitter as HTMLButtonElement)?.value==='resolve_unsent'?'メールサーバーの履歴で未送信を確認しましたか？':'メールサーバーの履歴で送信済みを確認しましたか？'))) e.preventDefault();}} class="mt-3"><input type="hidden" name="revision" value={data.item.revision}/><input type="hidden" name="messageId" value={message.id}/><button name="action" value={message.state==='failed'?'retry':'resolve_sent'} class="rounded border px-3 py-2 text-sm">{message.state==='failed'?'再送する':'送信済みを確認した'}</button>{#if message.state==='uncertain'}<button name="action" value="resolve_unsent" class="rounded border px-3 py-2 text-sm ml-2">未送信を確認した</button><p class="text-sm mt-2">メールサーバーの履歴で結果を確認してから操作してください。未送信を確認した場合だけ再送できます。</p>{/if}</form>{/if}
    {#if message.direction==='out' && message.state==='sent'}
     {#if message.history_source?.account}
      <details class="mt-4 border-t pt-3 text-sm"><summary class="cursor-pointer">過去メール：{message.reusable?'承認済み':message.history_reference?'AIの参考利用中':'AIの参考利用停止中'}</summary>
       <p class="my-2">個人情報と引用を除去した参考本文です。現在のルールとして承認した回答とは区別されます。</p>
       <p class="whitespace-pre-wrap my-2">質問：{message.knowledge_question??'参考本文なし'}</p><p class="whitespace-pre-wrap my-2">回答：{message.knowledge_answer??'参考本文なし'}</p>
       <form method="post" use:enhance><input type="hidden" name="revision" value={data.item.revision}/><input type="hidden" name="messageId" value={message.id}/><button name="action" value={message.history_reference||message.reusable?'history_disable':'history_enable'} disabled={!message.knowledge_question||!message.knowledge_answer} class="rounded border px-3 py-2">{message.history_reference||message.reusable?'AIの参考利用を停止':'AIの参考利用を再開'}</button></form>
      </details>
     {/if}
     <details class="mt-4 border-t pt-3 text-sm"><summary class="cursor-pointer">{message.reusable?'回答例として利用中':'AI用の回答例として登録する'}</summary>
      <p class="my-2">氏名・予約番号・個別の特別対応を除き、再利用できる質問と回答に整えてください。</p>
      <form method="post" use:enhance class="space-y-2"><input type="hidden" name="revision" value={data.item.revision}/><input type="hidden" name="messageId" value={message.id}/><label class="block">一般化した質問<textarea class="block w-full border rounded p-2" name="question" maxlength="1000" required>{message.knowledge_question??''}</textarea></label><label class="block">一般化した回答<textarea class="block w-full border rounded p-2" name="answer" rows="5" maxlength="10000" required>{message.knowledge_answer??''}</textarea></label><label class="block">有効期限（任意）<input type="date" name="until" value={message.valid_until??''} class="block border rounded p-2"/></label><button name="action" value="approve" class="border rounded px-3 py-2">承認して登録</button>{#if message.reusable}<button name="action" value="revoke" formnovalidate class="border rounded px-3 py-2 ml-2">利用を停止</button>{/if}</form>
     </details>
     {#if message.ai_original}<details class="mt-3 text-sm"><summary>元のAI下書き</summary><p class="whitespace-pre-wrap mt-2">{message.ai_original}</p></details>{/if}
    {/if}
   </article>{/each}
  </section>
  <section class="rounded-xl border bg-white p-4 space-y-4 min-w-0"><h2 class="font-semibold">回答を作成</h2><p class="text-sm">宛先：{data.item.email} ／ AI下書きは担当者が確認してから送信してください。</p>
   {#if data.item.draft && data.item.draft_revision!==data.item.revision}<p class="text-sm text-amber-800">下書き作成後に履歴または状況が変わりました。最新のやり取りを確認し、下書きを保存してから送信してください。</p>{/if}
   <form method="post" use:enhance={()=>{busy=true;return async({update})=>{try{await update({reset:false});}finally{busy=false;}};}} onsubmit={(e)=>{const value=(e.submitter as HTMLButtonElement)?.value;if(value==='send'&&!confirm(`${data.item.email} にこの回答を送信しますか？`))e.preventDefault();if(value==='ai'&&body.trim()&&!confirm('現在の下書きをAI下書きで置き換えますか？'))e.preventDefault();}} class="space-y-3">
    <input type="hidden" name="revision" value={data.item.revision}/><label class="block">返信本文<textarea name="body" bind:value={body} rows="16" maxlength="20000" class="block w-full border rounded p-3 mt-2" aria-label="返信本文"></textarea></label>
    <div class="flex flex-wrap gap-2"><button name="action" value="ai" disabled={busy||!data.aiConfigured} class="rounded border px-3 py-2 disabled:opacity-50">{busy?'処理中…':'AI下書きを作成'}</button><button name="action" value="save" disabled={busy} class="rounded border px-3 py-2">下書きを保存</button><button name="action" value="send" disabled={busy||!body.trim()||data.messages.some(m=>m.direction==='out'&&['queued','sending','uncertain'].includes(m.state))} class="rounded bg-brand-800 text-white px-4 py-2 disabled:opacity-50">確認して送信</button></div>
    {#if !data.aiConfigured}<p class="text-sm text-amber-800">AI接続の設定待ちです。手動での回答は作成できます。</p>{/if}
   </form>
   <div class="border-t pt-3"><h3 class="font-semibold text-sm">AIが参照した資料</h3>{#each data.item.ai_sources as source}<details class="mt-2 text-sm"><summary class="cursor-pointer">{source.kind}：{source.question}</summary>{#if source.answered_at}<p class="text-xs mt-2">回答日：{time(source.answered_at)} ／ 当時の参考例です。</p>{/if}<p class="whitespace-pre-wrap mt-2">{source.answer}</p>{#if source.inquiry_id}<a class="inline-block underline mt-2" href="/admin/inquiries/{source.inquiry_id}">元のやり取りを確認</a>{/if}</details>{:else}<p class="text-sm mt-2">参照資料はありません。AIは不足する情報に要確認の印を付けます。</p>{/each}</div>
  </section>
 </div>
</div>


