<script lang="ts">
 import { enhance } from '$app/forms';
 import { beforeNavigate,goto,invalidateAll } from '$app/navigation';
 import { onMount,tick,untrack } from 'svelte';
 import type { SubmitFunction } from '@sveltejs/kit';
 import type { PageData,ActionData } from './$types';
 import { STATES } from '$lib/inquiries';
 import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
 import InquiryKnowledge from '$lib/components/admin/InquiryKnowledge.svelte';
 let {data,form}:{data:PageData;form:ActionData}=$props();
 let body=$state(untrack(()=>data.item.draft)),savedBody=$state(untrack(()=>data.item.draft));
 let revision=$state(untrack(()=>data.item.revision)),version=$state(untrack(()=>data.item.draft_version));
 let savedAt=$state(untrack(()=>data.item.draft_updated_at)),saving=$state(false),busy=$state(false),conflict=$state(false),saveError=$state('');
 let mobilePane=$state('conversation'),reviewOpen=$state(false),reviewChecked=$state(false);
 let reviewDialog:HTMLDialogElement,threadPane:HTMLElement;
 let timer:ReturnType<typeof setTimeout>|undefined,activeSave:Promise<boolean>|null=null;
 let loadedId=untrack(()=>data.item.id);
 const otherDirtyForms=new Set<HTMLFormElement>();let allowOtherFormLeave=false;
 function trackForm(e:Event){const form=e.target instanceof Element?e.target.closest('form'):null;if(form instanceof HTMLFormElement&&form.method==='post'&&form.dataset.noGuard===undefined){otherDirtyForms.add(form);allowOtherFormLeave=false;}}
 const dirty=$derived(body!==savedBody);
 const visibleMessages=$derived(data.messages.filter(m=>m.direction==='in'||m.direction==='out'));
 const notices=$derived(data.messages.filter(m=>m.direction!=='in'&&m.direction!=='out'));
 const autoPending=$derived(data.job?.state==='pending'||data.job?.state==='running');
 const activeSend=$derived(data.messages.some(m=>m.direction==='out'&&['queued','sending','uncertain'].includes(m.state)));
 const time=(s:string)=>new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const clock=(s:string)=>new Date(s).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 const stateLabel:Record<string,string>={received:'受信',queued:'送信待ち',sending:'送信中',sent:'送信済み',failed:'送信失敗',uncertain:'送信結果を確認'};
 $effect(()=>{const item=data.item;untrack(()=>{
  if(loadedId!==item.id){loadedId=item.id;body=savedBody=item.draft;revision=item.revision;version=item.draft_version;savedAt=item.draft_updated_at;conflict=false;saveError='';}
  else if(!dirty&&!saving&&!busy&&!reviewOpen){body=savedBody=item.draft;revision=item.revision;version=item.draft_version;savedAt=item.draft_updated_at;}
 });});
 function scheduleSave(){if(timer)clearTimeout(timer);saveError='';if(!conflict)timer=setTimeout(()=>void persist(),1000);}
 async function persist():Promise<boolean>{
  if(timer)clearTimeout(timer);
  if(activeSave){const ok=await activeSave;return ok&&body!==savedBody?persist():ok;}
  if(conflict)return false;if(body===savedBody)return true;
  const snapshot=body;saving=true;
  activeSave=(async()=>{
   try{
    const res=await fetch('/admin/inquiries/'+data.item.id+'/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:snapshot,revision,version})});
    const result=await res.json();
    if(!res.ok){conflict=!!result.conflict;throw new Error(result.error||'保存できませんでした。');}
    revision=result.revision;version=result.version;savedAt=result.saved_at;savedBody=snapshot;saveError='';return true;
   }catch(e){saveError=e instanceof Error?e.message:'保存できませんでした。接続をご確認ください。';return false;}
   finally{saving=false;activeSave=null;}
  })();
  const ok=await activeSave;if(ok&&body!==savedBody&&!busy)scheduleSave();return ok;
 }
 const submitAction:SubmitFunction=async({formData,formElement,cancel})=>{
  if(busy){cancel();return;}busy=true;
  if(!await persist()){busy=false;cancel();return;}
  formData.set('revision',String(revision));formData.set('draftVersion',String(version));
  const action=String(formData.get('action'));
  if(action==='ai'&&body.trim()&&!confirm('現在の下書きをAIで作り直しますか？')){busy=false;cancel();return;}
  return async({result,update})=>{
   try{await update({reset:false});await tick();if(result.type==='success'){otherDirtyForms.delete(formElement);allowOtherFormLeave=false;
    body=savedBody=data.item.draft;revision=data.item.revision;version=data.item.draft_version;savedAt=data.item.draft_updated_at;saveError='';conflict=false;
    if(action==='send'){reviewDialog.close();reviewOpen=false;mobilePane='conversation';}
   }}finally{busy=false;}
  };
 };
 async function reviewReply(){busy=true;const ok=await persist();busy=false;if(ok){reviewChecked=false;reviewOpen=true;reviewDialog.showModal();}}
 async function copyReply(){try{await navigator.clipboard.writeText(body);saveError='本文をコピーしました。入力内容を控えてから再読み込みできます。';}catch{saveError='本文を選択してコピーしてください。';}}
 async function refresh(){if(await persist())await invalidateAll();}
 beforeNavigate(nav=>{for(const f of otherDirtyForms)if(!f.isConnected)otherDirtyForms.delete(f);if(otherDirtyForms.size&&!allowOtherFormLeave&&nav.type!=='form'){if(nav.type==='leave'||!confirm('担当者や回答例に保存していない変更があります。移動しますか？')){nav.cancel();return;}allowOtherFormLeave=true;}if(!dirty&&!saving)return;if(nav.type==='leave'){nav.cancel();return;}if(nav.to?.url){nav.cancel();void persist().then(ok=>{if(ok)void goto(nav.to!.url);else allowOtherFormLeave=false;});}});
 onMount(()=>{
  void tick().then(()=>{if(threadPane)threadPane.scrollTop=threadPane.scrollHeight;});
  const poll=setInterval(()=>{if(!dirty&&!saving&&!busy&&!reviewOpen&&document.visibilityState==='visible')void invalidateAll();},autoPending?4000:10000);
  const online=()=>{if(dirty&&!conflict)void persist();};window.addEventListener('online',online);
  return()=>{clearInterval(poll);if(timer)clearTimeout(timer);window.removeEventListener('online',online);};
 });
</script>
<svelte:head><title>{data.item.subject} | お問い合わせ</title></svelte:head>
<div class="inquiry-desk" data-own-unsaved-guard oninput={trackForm}>
 <div class="desk-topline"><a href="/admin/inquiries" class="back"><span>←</span> 受信トレイ</a><button class="quiet-button" onclick={refresh} disabled={busy||saving}>履歴を更新</button></div>
 <header class="desk-heading"><div class="guest-avatar">{data.item.name.slice(0,1)}</div><div class="heading-copy"><div class="eyebrow">{data.item.profile.history_account?'過去メール':'山人-yamado- · お客様からのお問い合わせ'}</div><h1>{data.item.subject||'お問い合わせ'}</h1><p>{data.item.name} 様 <span>·</span> {data.item.email}</p></div><span class="status-pill status-{data.item.status}"><i></i>{STATES[data.item.status]}</span></header>
 {#if form?.message}<p class="feedback" role="status">{form.message}</p>{/if}
 <form class="assignment-bar" method="post" use:enhance={submitAction}>
  <input type="hidden" name="revision" value={revision}/><input type="hidden" name="action" value="status"/>
  <label>対応状況 <select name="status" value={data.item.status}>{#each Object.entries(STATES) as [key,label]}<option value={key}>{label}</option>{/each}</select></label>
  <label>担当 <input name="assignee" value={data.item.assignee} placeholder="担当者を設定" maxlength="100"/></label><button class="quiet-button" disabled={busy||saving}>変更を保存</button>
 </form>
 <nav class="mobile-tabs" aria-label="表示切替"><button class:active={mobilePane==='conversation'} onclick={()=>mobilePane='conversation'}>やり取り <span>{visibleMessages.length}</span></button><button class:active={mobilePane==='reply'} onclick={()=>mobilePane='reply'}>返信を作成 {#if data.item.draft}<i></i>{/if}</button></nav>
 <div class="workspace">
  <section class="composer-panel" class:mobile-hidden={mobilePane!=='reply'} aria-label="返信を作成">
   <div class="panel-title"><h2><AdminIcon name="plan"/>返信を作成</h2><span class="auto-label" aria-live="polite">自動保存 · {saveError?'要確認':saving?'保存中…':dirty?'未保存':'保存済み'}</span></div>
   {#if autoPending&&!dirty&&data.item.draft_origin!=='manual'}<div class="ai-banner"><span class="working-dot"></span><div><strong>AIが下書きを準備しています</strong><p>FAQと過去の回答を参照しています。先に入力することもできます。</p></div></div>{:else if data.job?.state==='failed'&&data.item.draft_origin!=='manual'}<div class="ai-banner failed"><div><strong>自動下書きを作成できませんでした</strong><p>下の「AIで作り直す」から再試行できます。手動でも返信できます。</p></div></div>{:else if data.item.draft_origin==='auto'&&!dirty}<div class="ai-ready"><AdminIcon name="shield"/><span>AI下書きを用意しました。内容をご確認ください。</span></div>{/if}
   {#if data.item.draft&&data.item.draft_revision!==data.item.revision}<p class="composer-warning">下書き作成後に新しいやり取りがあります。履歴を確認してから編集してください。</p>{/if}
   <div class="recipient-line"><span>宛先</span><strong>{data.item.email}</strong></div>
   <form id="inquiry-reply-form" method="post" use:enhance={submitAction} data-no-guard>
    <input type="hidden" name="revision" value={revision}/><input type="hidden" name="draftVersion" value={version}/>
    <label class="sr-only" for="reply-body">返信本文</label><textarea id="reply-body" name="body" bind:value={body} oninput={scheduleSave} onblur={()=>{if(dirty&&!conflict)void persist();}} disabled={busy} rows="16" maxlength="20000" placeholder={autoPending?'AI下書きを準備しています。ここから先に書き始めることもできます。':'お客様への返信を入力してください。入力した内容は自動保存されます。'}></textarea>
    <div class="save-bar" aria-live="polite"><span class:error={!!saveError} class:saved={!dirty&&!saving&&!saveError}><i></i>{saveError?'保存状況を確認してください':saving?'保存中…':dirty?'変更を保存します…':savedAt?'下書き保存済み · '+clock(savedAt):'入力すると自動保存します'}</span><span>{body.length.toLocaleString()} / 20,000</span></div>
    {#if saveError}<div class="save-error" role="alert"><p>{saveError}</p><div>{#if !conflict}<button type="button" onclick={()=>void persist()}>再試行</button>{/if}<button type="button" onclick={copyReply}>本文をコピー</button>{#if conflict}<button type="button" onclick={()=>{if(confirm('入力本文をコピーしましたか？ 最新の履歴を読み込みます。'))window.location.reload();}}>再読み込み</button>{/if}</div></div>{/if}
    <div class="composer-actions"><button name="action" value="ai" class="secondary-button" disabled={busy||saving||conflict||!data.aiConfigured}>AIで作り直す</button><button type="button" class="primary-button" disabled={busy||saving||conflict||!body.trim()||activeSend} onclick={reviewReply}>内容を確認して送信 <span>→</span></button></div>
   </form>
   <p class="send-note">{activeSend?'送信処理中の回答があります。結果を確認してから次の返信を作成してください。':'AIから自動送信されることはありません。送信前に宛先と本文を確認します。'}</p>
   <details class="sources" open={data.item.ai_sources.length>0}><summary><AdminIcon name="book"/>下書きの参考資料 <span>{data.item.ai_sources.length}件</span></summary><div class="source-list">{#each data.item.ai_sources as source}<details class="source-card"><summary><span class="source-kind">{source.kind}</span><strong>{source.question}</strong></summary>{#if source.answered_at}<p class="source-date">回答日：{time(source.answered_at)} · 当時の参考例です</p>{/if}<p>{source.answer}</p>{#if source.inquiry_id}<a href="/admin/inquiries/{source.inquiry_id}">元のやり取りを見る ↗</a>{/if}</details>{:else}<p class="no-sources">参照資料が不足する内容は、AIが【要確認】として残します。</p>{/each}</div></details>
  </section>
  <section class="thread-panel" class:mobile-hidden={mobilePane!=='conversation'} aria-label="やり取りの履歴">
   <div class="panel-title"><h2>やり取り</h2><span>{visibleMessages.length}件のメッセージ</span></div>
   <div class="thread-scroll" bind:this={threadPane}>
   {#each visibleMessages as message (message.id)}
    <article class="message-card" class:staff-message={message.direction==='out'}>
     <div class="message-heading"><span class="mini-avatar" class:staff-avatar={message.direction==='out'}>{message.direction==='in'?data.item.name.slice(0,1):'宿'}</span><div><strong>{message.direction==='in'?data.item.name+' 様':'山人-yamado-'}</strong><span>{message.direction==='in'?'お客様':stateLabel[message.state]}</span></div><time>{time(message.created_at)}</time></div>
     <div class="message-body">{message.body.slice(0,1600)}{#if message.body.length>1600}<details class="full-message"><summary>全文を表示</summary><div>{message.body.slice(1600)}</div></details>{/if}</div>
     {#if message.error}<p class="message-error">{message.error}</p>{/if}
     {#if message.state==='failed'||message.state==='uncertain'}<form method="post" use:enhance={submitAction} data-no-guard class="recovery-form" onsubmit={e=>{if(!confirm(message.state==='failed'?'同じ内容を再送しますか？':'メールサーバーの送信履歴で結果を確認しましたか？'))e.preventDefault();}}><input type="hidden" name="revision" value={revision}/><input type="hidden" name="messageId" value={message.id}/><button name="action" value={message.state==='failed'?'retry':'resolve_sent'} class="quiet-button">{message.state==='failed'?'再送する':'送信済みを確認した'}</button>{#if message.state==='uncertain'}<button name="action" value="resolve_unsent" class="quiet-button">未送信を確認した</button>{/if}</form>{/if}
     {#if message.direction==='out'&&message.state==='sent'}<InquiryKnowledge {message} {revision} submit={submitAction}/>{/if}
    </article>
   {/each}
   {#if notices.length}<details class="system-messages"><summary>受付控え・担当者通知 <span>{notices.length}件</span></summary>{#each notices as message}<div><strong>{message.direction==='receipt'?'お客様への受付控え':'infoへの受付通知'}</strong><span>{stateLabel[message.state]}</span><p>{message.body}</p></div>{/each}</details>{/if}
   </div>
  </section>
 </div>
</div>
<dialog bind:this={reviewDialog} class="review-dialog" aria-labelledby="reply-review-title" onclose={()=>reviewOpen=false} oncancel={()=>reviewOpen=false}>
 <header><div><p>送信前の最終確認</p><h2 id="reply-review-title">この内容で返信しますか？</h2></div><button aria-label="閉じる" onclick={()=>reviewDialog.close()}><AdminIcon name="close"/></button></header>
 <div class="review-recipient"><span>宛先</span><strong>{data.item.name} 様</strong><p>{data.item.email}</p></div><div class="review-body">{body}</div>
 {#if body.includes('【要確認')}<p class="composer-warning">本文に【要確認】が残っています。確認・編集してから送信してください。</p>{/if}
 <label class="review-check"><input type="checkbox" bind:checked={reviewChecked}/>宛先と本文を確認しました</label>
 <footer><button class="secondary-button" onclick={()=>reviewDialog.close()}>編集に戻る</button><button form="inquiry-reply-form" name="action" value="send" class="primary-button" disabled={!reviewChecked||busy||body.includes('【要確認')}>確認した内容で送信</button></footer>
</dialog>
<style>
 .inquiry-desk{--ink:#223b32;--muted:#7a827c;--line:#e6e9e3;--soft:#f7f8f5;max-width:1500px;margin:0 auto;color:#283a32}.desk-topline{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem}.back{display:flex;align-items:center;gap:.7rem;color:#67746b;font-size:.8rem;font-weight:600}.back span{font-size:1.1rem}.quiet-button{font-size:.75rem;color:#53665b;padding:.45rem .75rem;border:1px solid #dfe5df;border-radius:.6rem;background:white;white-space:nowrap}.desk-heading{display:flex;align-items:center;gap:1rem;margin-bottom:1.4rem}.guest-avatar{height:3rem;width:3rem;border-radius:1rem;background:#e8ede5;color:#47634d;display:grid;place-items:center;font-size:1.1rem;font-weight:600;flex-shrink:0}.heading-copy{min-width:0;flex:1}.eyebrow{font-size:.72rem;color:#869085;letter-spacing:.06em;margin-bottom:.3rem}.desk-heading h1{font-size:1.35rem;line-height:1.5;font-weight:650;letter-spacing:-.025em;overflow-wrap:anywhere}.heading-copy p{font-size:.75rem;color:#6e7c71;margin-top:.35rem;overflow-wrap:anywhere}.heading-copy p span{margin:0 .45rem;color:#bdc3bb}.status-pill{display:inline-flex;align-items:center;gap:.4rem;font-size:.68rem;font-weight:600;padding:.4rem .65rem;border-radius:100px;background:#eef1ed;color:#69796d;white-space:nowrap}.status-pill i{width:5px;height:5px;background:currentColor;border-radius:50%}.status-new{background:#fdf0dc;color:#986b23}.status-working{background:#eaf1ff;color:#4b6f9d}.status-waiting{background:#f2ecfa;color:#8662a1}.status-done{background:#eaf2e9;color:#557a52}.assignment-bar{display:flex;gap:.9rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem;padding:.8rem 1rem;background:#f3f5f0;border-radius:.9rem;font-size:.72rem}.assignment-bar label{display:flex;align-items:center;gap:.5rem;color:#7e877c}.assignment-bar select,.assignment-bar input{background:#fff;border:1px solid #e0e5dc;border-radius:.5rem;padding:.4rem .6rem;font-size:.75rem;color:#384f40;max-width:12rem}.workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1.5rem;align-items:start}.thread-panel,.composer-panel{min-width:0;background:#fff;border:1px solid var(--line);border-radius:1rem;overflow:hidden;box-shadow:0 2px 8px #273d2b03}.panel-title{display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.3rem;border-bottom:1px solid #edf0e9}.panel-title h2{font-size:.85rem;font-weight:650;display:flex;align-items:center;gap:.55rem}.panel-title>span{font-size:.72rem;color:#788570}.panel-title .auto-label{border:1px solid #e2e8dd;padding:.2rem .5rem;border-radius:100px;color:#7b8b72}.thread-scroll{max-height:calc(100vh - 320px);min-height:390px;overflow:auto;padding:1.25rem;background:#fafbf8;scrollbar-width:thin;scrollbar-color:#d7ddd3 transparent}.message-card{border:1px solid #e7ebe3;border-radius:.9rem;padding:1.1rem;background:#fff;margin-bottom:1rem}.staff-message{background:#f2f6ef;border-color:#e4ebdd}.message-heading{display:flex;align-items:center;gap:.6rem}.mini-avatar{display:grid;place-items:center;height:1.8rem;width:1.8rem;background:#f1eee6;border-radius:50%;color:#8b7d64;font-size:.7rem;flex-shrink:0}.staff-avatar{background:#dfe8da;color:#60795a}.message-heading strong{display:block;font-size:.72rem;font-weight:600}.message-heading div>span{display:block;color:#788570;font-size:.68rem;margin-top:.1rem}.message-heading time{margin-left:auto;color:#788570;font-size:.68rem;white-space:nowrap}.message-body{font-size:.85rem;line-height:1.95;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:1rem;color:#4e5e51}.full-message{font-size:.75rem}.full-message summary{cursor:pointer;color:#6f8868;padding-top:.6rem}.full-message div{white-space:pre-wrap}.message-error,.composer-warning{font-size:.72rem;line-height:1.7;color:#926b27;background:#fff6e7;padding:.75rem 1rem;border-radius:.6rem;margin:.7rem 1rem}.message-error{margin:.8rem 0 0}.recovery-form{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.7rem}.system-messages{font-size:.68rem;color:#8a9484;padding:.5rem}.system-messages summary{cursor:pointer}.system-messages summary span{float:right}.system-messages>div{padding:1rem 0;border-bottom:1px solid #e9ece5}.system-messages strong{font-weight:600}.system-messages span{float:right}.system-messages p{white-space:pre-wrap;font-size:.7rem;line-height:1.8;margin-top:.6rem}.ai-banner{display:flex;gap:.7rem;padding:1rem 1.2rem;background:#f2f5fb;color:#607494}.ai-banner strong{font-size:.75rem;font-weight:600}.ai-banner p{font-size:.72rem;line-height:1.7;margin-top:.25rem}.working-dot{height:.55rem;width:.55rem;margin-top:.35rem;flex-shrink:0;border-radius:50%;background:#8ca2c6;animation:pulse 1.5s ease-in-out infinite}.ai-ready{display:flex;gap:.5rem;align-items:center;background:#f2f6ef;color:#708366;padding:.8rem 1.2rem;font-size:.69rem}.failed{background:#fff6e8;color:#9a7a40}.recipient-line{display:flex;gap:.75rem;align-items:center;padding:.85rem 1.3rem;border-bottom:1px solid #f0f1ec;font-size:.7rem;overflow-wrap:anywhere}.recipient-line span{color:#788570}.recipient-line strong{font-weight:500;min-width:0;overflow-wrap:anywhere}.composer-panel textarea{display:block;width:100%;padding:1.25rem 1.3rem;border:0;outline:none;resize:vertical;height:clamp(260px,calc(100vh - 730px),420px);min-height:260px;font-size:.88rem;line-height:2.05;color:#3a4d3e;background:#fff;box-shadow:none}.composer-panel textarea:focus{background:#fefefb}.composer-panel textarea::placeholder{color:#adb4a5}.save-bar{display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.65rem 1.3rem;font-size:.68rem;color:#788570;border-top:1px solid #f2f3ef}.save-bar>span:first-child{display:flex;align-items:center;gap:.35rem}.save-bar i{width:4px;height:4px;border-radius:50%;background:currentColor}.save-bar .saved{color:#8b9f7f}.save-bar .error{color:#b06e50}.composer-actions{display:flex;justify-content:space-between;gap:.6rem;padding:.85rem 1.2rem;border-top:1px solid #eef0e8;background:#fcfdf9}.primary-button{display:inline-flex;gap:.75rem;align-items:center;justify-content:center;background:#2f4a3d;color:#fff;font-size:.75rem;font-weight:550;padding:.75rem 1rem;border-radius:.65rem;box-shadow:0 2px 4px #233b3210}.primary-button:hover{background:#213b2f}.secondary-button{font-size:.73rem;padding:.7rem .85rem;border:1px solid #e0e5d9;border-radius:.65rem;color:#697a5e;background:#fff}.send-note{font-size:.68rem;color:#788570;padding:.6rem 1.2rem .9rem;line-height:1.7}.sources{margin:.3rem 1.2rem 1.2rem;border-top:1px solid #eaeee2;padding-top:.9rem}.sources>summary{display:flex;align-items:center;gap:.5rem;color:#859374;font-size:.7rem;cursor:pointer}.sources>summary span{margin-left:auto;font-size:.68rem}.source-list{padding-top:.8rem;display:grid;gap:.5rem}.source-card{border:1px solid #e9eddf;border-radius:.65rem;padding:.75rem;background:#fdfef9}.source-card>summary{cursor:pointer}.source-kind{display:block;font-size:.56rem;color:#a19c78;margin-bottom:.3rem}.source-card strong{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:.7rem;font-weight:500;color:#687757;line-height:1.7}.source-card[open] strong{-webkit-line-clamp:unset}.source-card p{font-size:.7rem;line-height:1.9;white-space:pre-wrap;margin-top:.6rem;color:#7d886c;overflow-wrap:anywhere}.source-card a{display:inline-block;font-size:.72rem;margin-top:.6rem;color:#6c8258;text-decoration:underline}.source-card .source-date{font-size:.59rem;color:#788570}.no-sources{font-size:.72rem;color:#788570;line-height:1.8}.feedback{font-size:.75rem;padding:.8rem 1rem;border:1px solid #e5e7d9;background:#fafbef;border-radius:.75rem;margin-bottom:1rem;line-height:1.7}.save-error{font-size:.7rem;line-height:1.7;color:#aa664a;margin:.4rem 1.2rem .9rem}.save-error>div{display:flex;gap:.8rem;margin-top:.5rem}.save-error button{text-decoration:underline}.mobile-tabs{display:none}.review-dialog{width:min(600px,calc(100% - 2rem));max-height:90vh;border:1px solid #e2e8dc;border-radius:1.2rem;padding:1.5rem;color:#3b503f;box-shadow:0 24px 90px #192b2630}.review-dialog::backdrop{background:#1c302e60;backdrop-filter:blur(4px)}.review-dialog>header{display:flex;justify-content:space-between;align-items:center}.review-dialog header p{font-size:.72rem;color:#94a186}.review-dialog h2{font-size:1.1rem;font-weight:600;margin-top:.35rem}.review-recipient{background:#f7f9f2;border-radius:.75rem;padding:.8rem 1rem;margin:1.2rem 0;font-size:.75rem}.review-recipient span{font-size:.72rem;color:#9da991;margin-right:.75rem}.review-recipient p{font-size:.7rem;color:#859778;margin:.3rem 0 0 2.3rem;overflow-wrap:anywhere}.review-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem;line-height:2;max-height:40vh;overflow:auto;padding:.4rem .3rem}.review-check{display:flex;align-items:center;gap:.6rem;margin:1rem 0;font-size:.75rem}.review-check input{accent-color:#36583d}.review-dialog footer{display:flex;gap:.7rem;justify-content:flex-end;border-top:1px solid #e9eddf;padding-top:1rem}button:disabled{opacity:.4;cursor:not-allowed}@keyframes pulse{50%{opacity:.3}}
 @media(min-width:1600px){.workspace{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}}@media(max-width:1000px){.workspace{gap:1rem}.desk-heading h1{font-size:1.15rem}.composer-actions{flex-wrap:wrap}.composer-actions .primary-button{flex:1}}@media(max-width:767px){.desk-topline{margin-bottom:1rem}.desk-heading{gap:.7rem;flex-wrap:wrap}.guest-avatar{height:2.5rem;width:2.5rem;border-radius:.8rem}.desk-heading .status-pill{margin-left:3.2rem}.heading-copy p{font-size:.67rem}.assignment-bar{gap:.65rem;padding:.75rem;margin-bottom:1rem}.assignment-bar label{font-size:.72rem}.assignment-bar input{max-width:8rem}.assignment-bar select{max-width:10rem}.workspace{display:block}.mobile-tabs{display:flex;border-bottom:1px solid #e0e7d8;margin-bottom:1rem;gap:1rem}.mobile-tabs button{padding:.7rem .2rem;font-size:.8rem;color:#788570;display:flex;gap:.5rem;align-items:center}.mobile-tabs .active{border-bottom:2px solid #38563e;color:#38563e;font-weight:600}.mobile-tabs span{font-size:.68rem;padding:.1rem .35rem;background:#f0f4e9;border-radius:100px}.mobile-tabs i{height:5px;width:5px;border-radius:50%;background:#8aa570}.mobile-hidden{display:none}.thread-scroll{max-height:none;min-height:260px;padding:.9rem}.message-card{padding:.9rem}.message-heading time{font-size:.54rem}.composer-panel textarea{min-height:360px}.panel-title{padding:1rem}.assignment-bar .quiet-button{margin-left:auto}}
</style>