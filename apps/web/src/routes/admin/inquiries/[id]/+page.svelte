<script lang="ts">
 import '$lib/styles/inquiry-interactions.css';
 import { enhance } from '$app/forms';
 import { beforeNavigate,goto,invalidateAll } from '$app/navigation';
 import { onMount,tick,untrack } from 'svelte';
 import type { SubmitFunction } from '@sveltejs/kit';
 import type { PageData,ActionData } from './$types';
 import { STATES,INQUIRY_TYPES,canDraftInquiry } from '$lib/inquiries';
 import AdminIcon from '$lib/components/admin/AdminIcon.svelte';
 import InquiryKnowledge from '$lib/components/admin/InquiryKnowledge.svelte';
 import InquiryMailBody from '$lib/components/admin/InquiryMailBody.svelte';
 import {splitInquiryMail,inquiryMailPreview} from '$lib/inquiry-mail-display';
 import {renderInquirySignature,replyWithoutSignature,replyWithSignature,inquiryAttachmentMime,attachmentSize,INQUIRY_ATTACHMENT_LIMIT,INQUIRY_ATTACHMENT_COUNT,type InquiryAttachment} from '$lib/inquiry-compose';
 let {data,form}:{data:PageData;form:ActionData}=$props();
 let body=$state(untrack(()=>replyWithoutSignature(data.item.draft,data.item.draft_signature))),savedBody=$state(untrack(()=>replyWithoutSignature(data.item.draft,data.item.draft_signature)));
 let assignee=$state(untrack(()=>data.item.assignee)),savedAssignee=$state(untrack(()=>data.item.assignee));
 let template=$state(untrack(()=>data.signature.template)),templateVersion=$state(untrack(()=>data.signature.version)),templateEdit=$state(untrack(()=>data.signature.template));
 let savedSignature=$state(untrack(()=>data.item.draft_signature)),templateSaving=$state(false),templateError=$state('');
 let attachments=$state<InquiryAttachment[]>(untrack(()=>data.attachments)),uploading=$state(false),attachmentError=$state(''),dragOver=$state(false);
 let fileInput:HTMLInputElement;
 const signature=$derived(renderInquirySignature(template,assignee));
 const fullReply=$derived(replyWithSignature(body,signature));
 const templateDirty=$derived(templateEdit!==template);
 const draftFiles=$derived(attachments.filter(f=>!f.message_id));
 let revision=$state(untrack(()=>data.item.revision)),version=$state(untrack(()=>data.item.draft_version));
 let savedAt=$state(untrack(()=>data.item.draft_updated_at)),saving=$state(false),busy=$state(false),conflict=$state(false),saveError=$state('');
 let draftJa=$state<{source_text:string;text_ja:string;language:string}|null>(untrack(()=>data.draftTranslation));
 let messageJa=$state<Record<string,{text_ja:string;language:string}>>(untrack(()=>Object.fromEntries(data.messageTranslations.map(t=>[t.target,t]))));
 let translationBusy=$state<Record<string,boolean>>({}),translationError=$state<Record<string,string>>({});
 const receptionState=(id:string)=>data.receptionJobs.find(j=>j.message_id===id);
 $effect(()=>{const incoming=data.messageTranslations;untrack(()=>{messageJa={...messageJa,...Object.fromEntries(incoming.map(t=>[t.target,t]))};});});
 const draftJaCurrent=$derived(draftJa?.source_text===body.trimEnd());
 const languageLabel=(code:string)=>({ja:'日本語',en:'英語','zh-Hant':'中国語（繁体字）','zh-Hans':'中国語（簡体字）',zh:'中国語',ko:'韓国語',fr:'フランス語',de:'ドイツ語',es:'スペイン語'}[code]??code);
 async function translate(target:string){
  if(translationBusy[target])return;
  translationBusy={...translationBusy,[target]:true};translationError={...translationError,[target]:''};
  const sourceBody=body.trimEnd(),sourceId=data.item.id;
  try{
   if(target==='draft'&&!await persist())return;
   const res=await fetch('/admin/inquiries/'+data.item.id+'/translate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({target,version})});
   const result=await res.json();if(sourceId!==data.item.id)return;if(!res.ok)throw Error(result.error||'翻訳できませんでした。');
   if(target==='draft'){if(sourceBody!==body.trimEnd())throw Error('本文が変わりました。最新の内容で翻訳してください。');draftJa=result;}
   else messageJa={...messageJa,[target]:result};
  }catch(e){translationError={...translationError,[target]:e instanceof Error?e.message:'翻訳できませんでした。'};}
  finally{translationBusy={...translationBusy,[target]:false};}
 }
 let mobilePane=$state('conversation'),reviewOpen=$state(false),reviewChecked=$state(false);
 let reviewDialog:HTMLDialogElement,threadPane:HTMLElement;
 let timer:ReturnType<typeof setTimeout>|undefined,activeSave:Promise<boolean>|null=null;
 let loadedId=untrack(()=>data.item.id);
 const otherDirtyForms=new Set<HTMLFormElement>();let allowOtherFormLeave=false;
 function trackForm(e:Event){const form=e.target instanceof Element?e.target.closest('form'):null;if(form instanceof HTMLFormElement&&form.method==='post'&&form.dataset.noGuard===undefined){otherDirtyForms.add(form);allowOtherFormLeave=false;}}
 const dirty=$derived(body!==savedBody||assignee!==savedAssignee||!!body.trim()&&signature!==savedSignature);
 const visibleMessages=$derived(data.messages.filter(m=>m.direction==='in'||m.direction==='out').map(m=>{const parts=splitInquiryMail(m.body);return {...m,parts,preview:inquiryMailPreview(parts)};}));
 let panelOpen=$state<Record<string,boolean>>({});
 const latestMessage=$derived(visibleMessages.at(-1)?.id);
 function setPanels(open:boolean){panelOpen=Object.fromEntries(visibleMessages.map(m=>[m.id,open]));}
 const notices=$derived(data.messages.filter(m=>m.direction!=='in'&&m.direction!=='out'));
 const aiEligible=$derived(canDraftInquiry(data.item));
 const autoPending=$derived(aiEligible&&(data.job?.state==='pending'||data.job?.state==='running'));
 const activeSend=$derived(data.messages.some(m=>m.direction==='out'&&['queued','sending','uncertain'].includes(m.state)));
 const time=(s:string)=>new Date(s).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
 const clock=(s:string)=>new Date(s).toLocaleTimeString('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',second:'2-digit'});
 const stateLabel:Record<string,string>={received:'受信',queued:'送信待ち',sending:'送信中',sent:'送信済み',failed:'送信失敗',uncertain:'送信結果を確認'};
 function syncDraft(){
  draftJa=data.draftTranslation;messageJa=Object.fromEntries(data.messageTranslations.map(t=>[t.target,t]));
  body=savedBody=replyWithoutSignature(data.item.draft,data.item.draft_signature);assignee=savedAssignee=data.item.assignee;savedSignature=data.item.draft_signature;
  revision=data.item.revision;version=data.item.draft_version;savedAt=data.item.draft_updated_at;attachments=data.attachments;
  if(!templateDirty){template=templateEdit=data.signature.template;templateVersion=data.signature.version;}
 }
 $effect(()=>{const item=data.item;const files=data.attachments;const settings=data.signature;untrack(()=>{
  if(loadedId!==item.id){loadedId=item.id;panelOpen={};template=templateEdit=settings.template;templateVersion=settings.version;syncDraft();conflict=false;saveError='';}
  else if(!dirty&&!saving&&!busy&&!reviewOpen){syncDraft();if(dirty&&body.trim()&&!conflict)scheduleSave();}
 });});
 function scheduleSave(){if(timer)clearTimeout(timer);saveError='';if(!conflict)timer=setTimeout(()=>void persist(),1000);}
 async function persist():Promise<boolean>{
  if(timer)clearTimeout(timer);
  if(activeSave){const ok=await activeSave;return ok&&dirty?persist():ok;}
  if(conflict)return false;if(!dirty)return true;
  const snapshot=body,snapshotName=assignee;saving=true;
  activeSave=(async()=>{
   try{
    const res=await fetch('/admin/inquiries/'+data.item.id+'/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({body:snapshot,revision,version,assignee:snapshotName,templateVersion})});
    const result=await res.json();
    if(!res.ok){conflict=!!result.conflict;throw new Error(result.error||'保存できませんでした。');}
    revision=result.revision;version=result.version;savedAt=result.saved_at;savedBody=snapshot;savedAssignee=snapshotName;savedSignature=result.signature;saveError='';return true;
   }catch(e){saveError=e instanceof Error?e.message:'保存できませんでした。接続をご確認ください。';return false;}
   finally{saving=false;activeSave=null;}
  })();
  const ok=await activeSave;if(ok&&dirty&&!busy)scheduleSave();return ok;
 }
 const submitAction:SubmitFunction=async({formData,formElement,cancel})=>{
  if(busy){cancel();return;}busy=true;
  if(!await persist()){busy=false;cancel();return;}
  formData.set('revision',String(revision));formData.set('draftVersion',String(version));
  if(formData.has('body'))formData.set('body',fullReply);
  const action=String(formData.get('action'));
  if(action==='ai'&&body.trim()&&!confirm('現在の下書きをAIで作り直しますか？')){busy=false;cancel();return;}
  return async({result,update})=>{
   try{await update({reset:false});await tick();if(result.type==='success'){otherDirtyForms.delete(formElement);allowOtherFormLeave=false;
    syncDraft();saveError='';conflict=false;
    if(action==='send'){reviewDialog.close();reviewOpen=false;mobilePane='conversation';}
   }}finally{busy=false;if(dirty&&body.trim())scheduleSave();}
  };
 };
 async function reviewReply(){busy=true;const ok=await persist();busy=false;if(ok){reviewChecked=false;reviewOpen=true;reviewDialog.showModal();}}
 async function copyReply(){try{await navigator.clipboard.writeText(fullReply);saveError='本文をコピーしました。入力内容を控えてから再読み込みできます。';}catch{saveError='本文を選択してコピーしてください。';}}
 async function addFiles(files:File[]){
  dragOver=false;if(busy||saving||conflict||reviewOpen)return;attachmentError='';
  if(draftFiles.length+files.length>INQUIRY_ATTACHMENT_COUNT||draftFiles.reduce((n,f)=>n+f.size_bytes,0)+files.reduce((n,f)=>n+f.size,0)>INQUIRY_ATTACHMENT_LIMIT){attachmentError='添付は10件・合計5MBまでです。';return;}
  if(files.some(f=>!f.size||!inquiryAttachmentMime(f.name))){attachmentError='PDF・画像・Excel・Word・CSVを添付してください。';return;}
  busy=uploading=true;
  try{
   if(!await persist())return;
   for(const file of files){
    const form=new FormData();form.set('file',file);form.set('revision',String(revision));form.set('version',String(version));
    const res=await fetch('/admin/inquiries/'+data.item.id+'/attachments',{method:'POST',body:form});const result=await res.json();
    if(!res.ok){conflict=!!result.conflict;throw new Error(result.error||'添付できませんでした。');}
    attachments=[...attachments,result.attachment];revision=result.revision;version=result.version;savedAt=result.saved_at;
   }
  }catch(e){attachmentError=e instanceof Error?e.message:'添付できませんでした。';}finally{busy=uploading=false;if(fileInput)fileInput.value='';}
 }
 async function removeFile(id:string){
  if(busy||saving||conflict)return;busy=uploading=true;attachmentError='';
  try{if(!await persist())return;
   const res=await fetch('/admin/inquiries/'+data.item.id+'/attachments',{method:'DELETE',headers:{'content-type':'application/json'},body:JSON.stringify({id,revision,version})});const result=await res.json();
   if(!res.ok){conflict=!!result.conflict;throw new Error(result.error||'添付を削除できませんでした。');}
   attachments=attachments.filter(f=>f.id!==id);revision=result.revision;version=result.version;savedAt=result.saved_at;
  }catch(e){attachmentError=e instanceof Error?e.message:'添付を削除できませんでした。';}finally{busy=uploading=false;}
 }
 async function saveTemplate(){
  if(busy||saving)return;templateSaving=busy=true;templateError='';
  try{if(!await persist())return;
   const res=await fetch('/admin/inquiries/'+data.item.id+'/signature',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({template:templateEdit,version:templateVersion})});const result=await res.json();
   if(!res.ok)throw new Error(result.error||'署名を保存できませんでした。');
   template=templateEdit=result.template;templateVersion=result.version;
  }catch(e){templateError=e instanceof Error?e.message:'署名を保存できませんでした。';}finally{templateSaving=busy=false;if(dirty)scheduleSave();}
 }
 async function refresh(){if(await persist())await invalidateAll();}
 beforeNavigate(nav=>{if(uploading||templateSaving){nav.cancel();return;}if(templateDirty&&!allowOtherFormLeave&&nav.type!=='form'){if(nav.type==='leave'||!confirm('署名テンプレートに未保存の変更があります。移動しますか？')){nav.cancel();return;}allowOtherFormLeave=true;}for(const f of otherDirtyForms)if(!f.isConnected)otherDirtyForms.delete(f);if(otherDirtyForms.size&&!allowOtherFormLeave&&nav.type!=='form'){if(nav.type==='leave'||!confirm('担当者や回答例に保存していない変更があります。移動しますか？')){nav.cancel();return;}allowOtherFormLeave=true;}if(!dirty&&!saving)return;if(nav.type==='leave'){nav.cancel();return;}if(nav.to?.url){nav.cancel();void persist().then(ok=>{if(ok)void goto(nav.to!.url);else allowOtherFormLeave=false;});}});
 onMount(()=>{
  if(dirty)scheduleSave();
  void tick().then(()=>{if(threadPane)threadPane.scrollTop=threadPane.scrollHeight;});
  const poll=setInterval(()=>{if(!dirty&&!templateDirty&&!saving&&!busy&&!reviewOpen&&document.visibilityState==='visible')void invalidateAll();},autoPending?4000:10000);
  const online=()=>{if(dirty&&!conflict)void persist();};window.addEventListener('online',online);
  return()=>{clearInterval(poll);if(timer)clearTimeout(timer);window.removeEventListener('online',online);};
 });
</script>
<svelte:head><title>{data.item.subject} | お問い合わせ</title></svelte:head>
<div class="inquiry-desk" data-own-unsaved-guard oninput={trackForm}>
 <div class="desk-topline"><a href="/admin/inquiries" class="back"><span>←</span> 受信トレイ</a><button class="quiet-button" onclick={refresh} disabled={busy||saving}>履歴を更新</button></div>
 <header class="desk-heading"><div class="guest-avatar">{data.item.name.slice(0,1)}</div><div class="heading-copy"><div class="eyebrow">{data.item.profile.history_account?'過去メール':data.item.profile.history_origin_account?'過去メールから継続':'山人-yamado- · お客様からのお問い合わせ'}</div>{#if INQUIRY_TYPES[data.item.profile.inquiry_type]}<span class="inquiry-type-badge">{INQUIRY_TYPES[data.item.profile.inquiry_type]}</span>{/if}<h1>{data.item.subject||'お問い合わせ'}</h1><p>{data.item.name} 様 <span>·</span> {data.item.email}</p></div><span class="status-pill status-{data.item.status}"><i></i>{STATES[data.item.status]}</span></header>
 {#if form?.message}<p class="feedback" role="status">{form.message}</p>{/if}
 <form class="assignment-bar" method="post" use:enhance={submitAction}>
  <input type="hidden" name="revision" value={revision}/><input type="hidden" name="action" value="status"/>
  <label>対応状況 <select name="status" value={data.item.status}>{#each Object.entries(STATES) as [key,label]}<option value={key}>{label}</option>{/each}</select></label>
  <button class="quiet-button" disabled={busy||saving}>変更を保存</button>
 </form>
 <nav class="mobile-tabs" aria-label="表示切替"><button class:active={mobilePane==='conversation'} onclick={()=>mobilePane='conversation'}>やり取り <span>{visibleMessages.length}</span></button><button class:active={mobilePane==='reply'} onclick={()=>mobilePane='reply'}>返信を作成 {#if data.item.draft}<i></i>{/if}</button></nav>
 <div class="workspace">
  <section class="composer-panel" class:mobile-hidden={mobilePane!=='reply'} aria-label="返信を作成">
   <div class="panel-title"><h2><AdminIcon name="plan"/>返信を作成</h2><span class="auto-label" aria-live="polite">自動保存 · {saveError?'要確認':saving?'保存中…':dirty?'未保存':'保存済み'}</span></div>
   {#if autoPending&&!dirty&&data.item.draft_origin!=='manual'}<div class="ai-banner"><span class="working-dot"></span><div><strong>AIが下書きを準備しています</strong><p>FAQと過去の回答を参照しています。先に入力することもできます。</p></div></div>{:else if aiEligible&&data.job?.state==='failed'&&data.item.draft_origin!=='manual'}<div class="ai-banner failed"><div><strong>自動下書きを作成できませんでした</strong><p>下の「AIで作り直す」から再試行できます。手動でも返信できます。</p></div></div>{:else if aiEligible&&data.item.draft_origin==='auto'&&!dirty}<div class="ai-ready"><AdminIcon name="shield"/><span>AI下書きを用意しました。内容をご確認ください。</span></div>{/if}
   {#if data.item.draft&&data.item.draft_revision!==data.item.revision}<p class="composer-warning">下書き作成後に新しいやり取りがあります。履歴を確認してから編集してください。</p>{/if}
   <div class="recipient-line"><span>宛先</span><strong>{data.item.email}</strong></div>
   <form id="inquiry-reply-form" method="post" use:enhance={submitAction} data-no-guard>
    <input type="hidden" name="revision" value={revision}/><input type="hidden" name="draftVersion" value={version}/>
    <div class="reply-assignee"><label for="reply-assignee">担当者名</label><select id="reply-assignee" bind:value={assignee} onchange={scheduleSave} onblur={()=>{if(dirty&&!conflict)void persist();}} disabled={busy}><option value="">担当者を選択</option>{#if assignee&&!data.staff.some(s=>s.is_active&&s.name===assignee)}<option value={assignee}>{assignee}（現在の担当者）</option>{/if}{#each data.staff.filter(s=>s.is_active) as person(person.id)}<option value={person.name}>{person.name}{person.nickname&&person.nickname!==person.name?' / '+person.nickname:''}</option>{/each}</select><a href="/admin/staff-directory">マスタ管理</a></div>
    <label class="sr-only" for="reply-body">返信本文</label><textarea id="reply-body" name="body" bind:value={body} oninput={scheduleSave} onblur={()=>{if(dirty&&!conflict)void persist();}} disabled={busy} rows="16" maxlength={Math.max(0,20000-signature.length-(signature?2:0))} placeholder={autoPending?'AI下書きを準備しています。ここから先に書き始めることもできます。':'お客様への返信を入力してください。入力した内容は自動保存されます。'}></textarea>
    {#if signature}<details class="reply-signature"><summary>署名：{assignee}</summary><div>{signature}</div></details>{/if}
    <div class="attachment-zone" class:drag-over={dragOver} role="region" aria-label="添付ファイル" ondragover={event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();dragOver=true;}}} ondragleave={event=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))dragOver=false;}} ondrop={event=>{event.preventDefault();void addFiles(Array.from(event.dataTransfer?.files??[]));}}>
     <div class="attachment-heading"><span>{uploading?'添付を保存中…':'ファイルをここにドロップ'}</span><button type="button" class="quiet-button" disabled={busy||saving||conflict} onclick={()=>fileInput.click()}>ファイルを選択</button></div>
     <input class="sr-only" type="file" multiple bind:this={fileInput} aria-label="添付ファイルを選択" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.avif,.bmp,.tif,.tiff,.xlsx,.xlsm,.xls,.docx,.doc,.csv" onchange={event=>void addFiles(Array.from(event.currentTarget.files??[]))}/>
     <p class="attachment-limit">PDF・画像・Excel・Word・CSV · 合計5MBまで</p>
     {#if draftFiles.length}<ul class="attachment-list">{#each draftFiles as file (file.id)}<li><a href="/admin/inquiries/{data.item.id}/attachments/{file.id}" download>{file.filename}<span>{attachmentSize(file.size_bytes)}</span></a><button type="button" disabled={busy||saving||conflict} aria-label={file.filename+'を削除'} onclick={()=>void removeFile(file.id)}>×</button></li>{/each}</ul>{/if}
     {#if attachmentError}<p class="attachment-error" role="alert">{attachmentError}</p>{/if}
    </div>
    <div class="save-bar" aria-live="polite"><span class:error={!!saveError} class:saved={!dirty&&!saving&&!saveError}><i></i>{saveError?'保存状況を確認してください':saving?'保存中…':dirty?'変更を保存します…':savedAt?'下書き保存済み · '+clock(savedAt):'入力すると自動保存します'}</span><span>{fullReply.length.toLocaleString()} / 20,000</span></div>
    {#if saveError}<div class="save-error" role="alert"><p>{saveError}</p><div>{#if !conflict}<button type="button" onclick={()=>void persist()}>再試行</button>{/if}<button type="button" onclick={copyReply}>本文をコピー</button>{#if conflict}<button type="button" onclick={()=>{if(confirm('入力本文をコピーしましたか？ 最新の履歴を読み込みます。'))window.location.reload();}}>再読み込み</button>{/if}</div></div>{/if}
    <div class="composer-actions"><button name="action" value="ai" class="secondary-button" disabled={busy||saving||conflict||!data.aiConfigured||!aiEligible}>AIで作り直す</button><button type="button" class="primary-button" disabled={busy||saving||conflict||!body.trim()||activeSend||templateDirty||fullReply.length>20000} onclick={reviewReply}>内容を確認して送信 <span>→</span></button></div>
   </form>
   <section class="translation-panel draft-translation" aria-label="返信の日本語訳">
    <div class="translation-heading"><strong>返信の日本語訳{#if draftJaCurrent&&draftJa}<span>原文：{languageLabel(draftJa.language)}</span>{/if}</strong><button type="button" class="quiet-button" disabled={busy||saving||!body.trim()||translationBusy.draft} onclick={()=>void translate('draft')}>{translationBusy.draft?'翻訳中…':draftJaCurrent?'訳を更新':'日本語訳を表示'}</button></div>
    {#if draftJaCurrent&&draftJa}<div class="translation-text">{draftJa.text_ja}</div>{:else if draftJa}<p class="translation-stale">返信本文が変更されています。日本語訳を更新してください。</p>{/if}
    {#if translationError.draft}<p class="translation-error" role="alert">{translationError.draft}</p>{/if}
   </section>
   <p class="send-note">{activeSend?'送信処理中の回答があります。結果を確認してから次の返信を作成してください。':'AIから自動送信されることはありません。送信前に宛先と本文を確認します。'}</p>
   <details class="signature-settings"><summary>署名テンプレートを編集</summary><label for="signature-template">山人-yamado-共通の署名</label><textarea id="signature-template" bind:value={templateEdit} oninput={()=>allowOtherFormLeave=false} maxlength="3000" rows="7" disabled={busy}></textarea><p>{'{担当者名}'}に入力した名前が入ります。</p><div><button type="button" class="quiet-button" disabled={busy||saving||!templateDirty} onclick={()=>{templateEdit=template;templateError='';}}>変更を戻す</button><button type="button" class="quiet-button" disabled={busy||saving||!templateDirty} onclick={()=>void saveTemplate()}>{templateSaving?'保存中…':'テンプレートを保存'}</button></div>{#if templateError}<p class="attachment-error" role="alert">{templateError}</p>{/if}</details>
   <details class="sources" open={data.item.ai_sources.length>0}><summary><AdminIcon name="book"/>下書きの参考資料 <span>{data.item.ai_sources.length}件</span></summary><div class="source-list">{#each data.item.ai_sources as source}<details class="source-card"><summary><span class="source-kind">{source.kind}</span><strong>{source.question}</strong></summary>{#if source.answered_at}<p class="source-date">回答日：{time(source.answered_at)} · 当時の参考例です</p>{/if}<p>{source.answer}</p>{#if source.inquiry_id}<a href="/admin/inquiries/{source.inquiry_id}">元のやり取りを見る ↗</a>{/if}</details>{:else}<p class="no-sources">参照資料が不足する内容は、AIが【要確認】として残します。</p>{/each}</div></details>
  </section>
  <section class="thread-panel" class:mobile-hidden={mobilePane!=='conversation'} aria-label="やり取りの履歴">
   <div class="panel-title"><h2>やり取り <span class="message-count">{visibleMessages.length}件</span></h2><div class="thread-actions"><button type="button" onclick={()=>setPanels(true)}>すべて開く</button><button type="button" onclick={()=>setPanels(false)}>閉じる</button></div></div>
   <div class="thread-scroll" bind:this={threadPane}>
   {#each visibleMessages as message (message.id)}
    <details class="message-card" class:staff-message={message.direction==='out'} open={panelOpen[message.id]??(message.id===latestMessage||['queued','sending','failed','uncertain'].includes(message.state))} ontoggle={event=>{panelOpen[message.id]=event.currentTarget.open;}}>
     <summary class="message-summary"><div class="message-heading"><span class="mini-avatar" class:staff-avatar={message.direction==='out'}>{message.direction==='in'?data.item.name.slice(0,1):'宿'}</span><div><strong>{message.direction==='in'?data.item.name+' 様':message.actor_name||'山人-yamado-'}</strong><span>{message.direction==='in'?'受信':stateLabel[message.state]}{#if message.id===latestMessage} · 最新{/if}</span></div><time>{time(message.created_at)}</time><span class="message-chevron">›</span></div><p class="message-preview">{message.preview}</p></summary>
     <div class="message-content"><InquiryMailBody parts={message.parts} original={message.body}/>
     {#if message.direction==='in'}<section class="translation-panel" aria-label="受信メールの日本語訳">
      <div class="translation-heading"><strong>日本語訳{#if messageJa[message.id]}<span>原文：{languageLabel(messageJa[message.id].language)}</span>{/if}</strong><button type="button" class="quiet-button" disabled={translationBusy[message.id]} onclick={()=>void translate(message.id)}>{translationBusy[message.id]?'翻訳中…':messageJa[message.id]?'訳を更新':'日本語訳を表示'}</button></div>
      {#if messageJa[message.id]}<details open={message.id===latestMessage}><summary>本文の訳を見る</summary><div class="translation-text">{messageJa[message.id].text_ja}</div></details>{/if}
      {#if !messageJa[message.id]&&['pending','running'].includes(receptionState(message.id)?.state??'')}<p class="translation-status">日本語訳を自動作成中です。</p>{:else if !messageJa[message.id]&&receptionState(message.id)?.state==='failed'}<p class="translation-error">自動翻訳できませんでした。「日本語訳を表示」から再作成できます。</p>{/if}
      {#if translationError[message.id]}<p class="translation-error" role="alert">{translationError[message.id]}</p>{/if}
     </section>{/if}
     {#if attachments.some(f=>f.message_id===message.id)}<ul class="attachment-list sent-files">{#each attachments.filter(f=>f.message_id===message.id) as file}<li><a href="/admin/inquiries/{data.item.id}/attachments/{file.id}" download>{file.filename}<span>{attachmentSize(file.size_bytes)}</span></a></li>{/each}</ul>{/if}
     {#if message.error}<p class="message-error">{message.error}</p>{/if}
     {#if message.state==='failed'||message.state==='uncertain'}<form method="post" use:enhance={submitAction} data-no-guard class="recovery-form" onsubmit={e=>{if(!confirm(message.state==='failed'?'同じ内容を再送しますか？':'メールサーバーの送信履歴で結果を確認しましたか？'))e.preventDefault();}}><input type="hidden" name="revision" value={revision}/><input type="hidden" name="messageId" value={message.id}/><button name="action" value={message.state==='failed'?'retry':'resolve_sent'} class="quiet-button">{message.state==='failed'?'再送する':'送信済みを確認した'}</button>{#if message.state==='uncertain'}<button name="action" value="resolve_unsent" class="quiet-button">未送信を確認した</button>{/if}</form>{/if}
     {#if message.direction==='out'&&message.state==='sent'}<InquiryKnowledge {message} {revision} submit={submitAction}/>{/if}
     </div>
    </details>
   {/each}
   {#if notices.length}<details class="system-messages"><summary>受付控え・担当者通知 <span>{notices.length}件</span></summary>{#each notices as message}<div><strong>{message.direction==='receipt'?'お客様への受付控え':'infoへの受付通知'}</strong><span>{stateLabel[message.state]}</span><p>{message.body}</p></div>{/each}</details>{/if}
   </div>
  </section>
 </div>
</div>
<dialog bind:this={reviewDialog} class="review-dialog" aria-labelledby="reply-review-title" onclose={()=>reviewOpen=false} oncancel={()=>reviewOpen=false}>
 <header><div><p>送信前の最終確認</p><h2 id="reply-review-title">この内容で返信しますか？</h2></div><button aria-label="閉じる" onclick={()=>reviewDialog.close()}><AdminIcon name="close"/></button></header>
 <div class="review-recipient"><span>宛先</span><strong>{data.item.name} 様</strong><p>{data.item.email}</p></div><div class="review-body">{fullReply}</div>
 {#if draftFiles.length}<div class="review-files"><strong>添付 {draftFiles.length}件</strong><ul class="attachment-list">{#each draftFiles as file}<li><span>{file.filename} · {attachmentSize(file.size_bytes)}</span></li>{/each}</ul></div>{/if}
 {#if fullReply.includes('【要確認')}<p class="composer-warning">本文に【要確認】が残っています。確認・編集してから送信してください。</p>{/if}
 <label class="review-check"><input type="checkbox" bind:checked={reviewChecked}/>宛先と本文を確認しました</label>
 <footer><button class="secondary-button" onclick={()=>reviewDialog.close()}>編集に戻る</button><button form="inquiry-reply-form" name="action" value="send" class="primary-button" disabled={!reviewChecked||busy||fullReply.includes('【要確認')||templateDirty}>確認した内容で送信</button></footer>
</dialog>
<style>
 .inquiry-desk{--ink:#223b32;--muted:#7a827c;--line:#e6e9e3;--soft:#f7f8f5;max-width:1500px;margin:0 auto;color:#283a32}.desk-topline{display:flex;justify-content:space-between;align-items:center;margin-bottom:1.5rem}.back{display:flex;align-items:center;gap:.7rem;color:#67746b;font-size:.8rem;font-weight:600}.back span{font-size:1.1rem}.quiet-button{font-size:.75rem;color:#53665b;padding:.45rem .75rem;border:1px solid #dfe5df;border-radius:.6rem;background:white;white-space:nowrap}.desk-heading{display:flex;align-items:center;gap:1rem;margin-bottom:1.4rem}.guest-avatar{height:3rem;width:3rem;border-radius:1rem;background:#e8ede5;color:#47634d;display:grid;place-items:center;font-size:1.1rem;font-weight:600;flex-shrink:0}.heading-copy{min-width:0;flex:1}.eyebrow{font-size:.72rem;color:#869085;letter-spacing:.06em;margin-bottom:.3rem}.desk-heading h1{font-size:1.35rem;line-height:1.5;font-weight:650;letter-spacing:-.025em;overflow-wrap:anywhere}.heading-copy p{font-size:.75rem;color:#6e7c71;margin-top:.35rem;overflow-wrap:anywhere}.heading-copy p span{margin:0 .45rem;color:#bdc3bb}.status-pill{display:inline-flex;align-items:center;gap:.4rem;font-size:.68rem;font-weight:600;padding:.4rem .65rem;border-radius:100px;background:#eef1ed;color:#69796d;white-space:nowrap}.status-pill i{width:5px;height:5px;background:currentColor;border-radius:50%}.status-new{background:#fdf0dc;color:#986b23}.status-working{background:#eaf1ff;color:#4b6f9d}.status-waiting{background:#f2ecfa;color:#8662a1}.status-done{background:#eaf2e9;color:#557a52}.assignment-bar{display:flex;gap:.9rem;align-items:center;flex-wrap:wrap;margin-bottom:1.5rem;padding:.8rem 1rem;background:#f3f5f0;border-radius:.9rem;font-size:.72rem}.assignment-bar label{display:flex;align-items:center;gap:.5rem;color:#7e877c}.assignment-bar select,.assignment-bar input{background:#fff;border:1px solid #e0e5dc;border-radius:.5rem;padding:.4rem .6rem;font-size:.75rem;color:#384f40;max-width:12rem}.workspace{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1.5rem;align-items:start}.thread-panel,.composer-panel{min-width:0;background:#fff;border:1px solid var(--line);border-radius:1rem;overflow:hidden;box-shadow:0 2px 8px #273d2b03}.panel-title{display:flex;align-items:center;justify-content:space-between;padding:1.1rem 1.3rem;border-bottom:1px solid #edf0e9}.panel-title h2{font-size:.85rem;font-weight:650;display:flex;align-items:center;gap:.55rem}.panel-title>span{font-size:.72rem;color:#788570}.panel-title .auto-label{border:1px solid #e2e8dd;padding:.2rem .5rem;border-radius:100px;color:#7b8b72}.thread-scroll{max-height:calc(100vh - 320px);min-height:390px;overflow:auto;padding:1.25rem;background:#fafbf8;scrollbar-width:thin;scrollbar-color:#d7ddd3 transparent}.message-card{border:1px solid #e7ebe3;border-radius:.9rem;padding:1.1rem;background:#fff;margin-bottom:1rem}.staff-message{background:#f2f6ef;border-color:#e4ebdd}.message-heading{display:flex;align-items:center;gap:.6rem}.mini-avatar{display:grid;place-items:center;height:1.8rem;width:1.8rem;background:#f1eee6;border-radius:50%;color:#8b7d64;font-size:.7rem;flex-shrink:0}.staff-avatar{background:#dfe8da;color:#60795a}.message-heading strong{display:block;font-size:.72rem;font-weight:600}.message-heading div>span{display:block;color:#788570;font-size:.68rem;margin-top:.1rem}.message-heading time{margin-left:auto;color:#788570;font-size:.68rem;white-space:nowrap}.message-error,.composer-warning{font-size:.72rem;line-height:1.7;color:#926b27;background:#fff6e7;padding:.75rem 1rem;border-radius:.6rem;margin:.7rem 1rem}.message-error{margin:.8rem 0 0}.recovery-form{display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.7rem}.system-messages{font-size:.68rem;color:#8a9484;padding:.5rem}.system-messages summary{cursor:pointer}.system-messages summary span{float:right}.system-messages>div{padding:1rem 0;border-bottom:1px solid #e9ece5}.system-messages strong{font-weight:600}.system-messages span{float:right}.system-messages p{white-space:pre-wrap;font-size:.7rem;line-height:1.8;margin-top:.6rem}.ai-banner{display:flex;gap:.7rem;padding:1rem 1.2rem;background:#f2f5fb;color:#607494}.ai-banner strong{font-size:.75rem;font-weight:600}.ai-banner p{font-size:.72rem;line-height:1.7;margin-top:.25rem}.working-dot{height:.55rem;width:.55rem;margin-top:.35rem;flex-shrink:0;border-radius:50%;background:#8ca2c6;animation:pulse 1.5s ease-in-out infinite}.ai-ready{display:flex;gap:.5rem;align-items:center;background:#f2f6ef;color:#708366;padding:.8rem 1.2rem;font-size:.69rem}.failed{background:#fff6e8;color:#9a7a40}.recipient-line{display:flex;gap:.75rem;align-items:center;padding:.85rem 1.3rem;border-bottom:1px solid #f0f1ec;font-size:.7rem;overflow-wrap:anywhere}.recipient-line span{color:#788570}.recipient-line strong{font-weight:500;min-width:0;overflow-wrap:anywhere}.composer-panel textarea{display:block;width:100%;padding:1.25rem 1.3rem;border:0;outline:none;resize:vertical;height:clamp(260px,calc(100vh - 730px),420px);min-height:260px;font-size:.88rem;line-height:2.05;color:#3a4d3e;background:#fff;box-shadow:none}.composer-panel textarea:focus{background:#fefefb}.composer-panel textarea::placeholder{color:#adb4a5}.save-bar{display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.65rem 1.3rem;font-size:.68rem;color:#788570;border-top:1px solid #f2f3ef}.save-bar>span:first-child{display:flex;align-items:center;gap:.35rem}.save-bar i{width:4px;height:4px;border-radius:50%;background:currentColor}.save-bar .saved{color:#8b9f7f}.save-bar .error{color:#b06e50}.composer-actions{display:flex;justify-content:space-between;gap:.6rem;padding:.85rem 1.2rem;border-top:1px solid #eef0e8;background:#fcfdf9}.primary-button{display:inline-flex;gap:.75rem;align-items:center;justify-content:center;background:#2f4a3d;color:#fff;font-size:.75rem;font-weight:550;padding:.75rem 1rem;border-radius:.65rem;box-shadow:0 2px 4px #233b3210}.primary-button:hover{background:#213b2f}.secondary-button{font-size:.73rem;padding:.7rem .85rem;border:1px solid #e0e5d9;border-radius:.65rem;color:#697a5e;background:#fff}.send-note{font-size:.68rem;color:#788570;padding:.6rem 1.2rem .9rem;line-height:1.7}.sources{margin:.3rem 1.2rem 1.2rem;border-top:1px solid #eaeee2;padding-top:.9rem}.sources>summary{display:flex;align-items:center;gap:.5rem;color:#859374;font-size:.7rem;cursor:pointer}.sources>summary span{margin-left:auto;font-size:.68rem}.source-list{padding-top:.8rem;display:grid;gap:.5rem}.source-card{border:1px solid #e9eddf;border-radius:.65rem;padding:.75rem;background:#fdfef9}.source-card>summary{cursor:pointer}.source-kind{display:block;font-size:.56rem;color:#a19c78;margin-bottom:.3rem}.source-card strong{display:-webkit-box;-webkit-line-clamp:2;line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:.7rem;font-weight:500;color:#687757;line-height:1.7}.source-card[open] strong{-webkit-line-clamp:unset;line-clamp:unset}.source-card p{font-size:.7rem;line-height:1.9;white-space:pre-wrap;margin-top:.6rem;color:#7d886c;overflow-wrap:anywhere}.source-card a{display:inline-block;font-size:.72rem;margin-top:.6rem;color:#6c8258;text-decoration:underline}.source-card .source-date{font-size:.59rem;color:#788570}.no-sources{font-size:.72rem;color:#788570;line-height:1.8}.feedback{font-size:.75rem;padding:.8rem 1rem;border:1px solid #e5e7d9;background:#fafbef;border-radius:.75rem;margin-bottom:1rem;line-height:1.7}.save-error{font-size:.7rem;line-height:1.7;color:#aa664a;margin:.4rem 1.2rem .9rem}.save-error>div{display:flex;gap:.8rem;margin-top:.5rem}.save-error button{text-decoration:underline}.mobile-tabs{display:none}.review-dialog{width:min(600px,calc(100% - 2rem));max-height:90vh;border:1px solid #e2e8dc;border-radius:1.2rem;padding:1.5rem;color:#3b503f;box-shadow:0 24px 90px #192b2630}.review-dialog::backdrop{background:#1c302e60;backdrop-filter:blur(4px)}.review-dialog>header{display:flex;justify-content:space-between;align-items:center}.review-dialog header p{font-size:.72rem;color:#94a186}.review-dialog h2{font-size:1.1rem;font-weight:600;margin-top:.35rem}.review-recipient{background:#f7f9f2;border-radius:.75rem;padding:.8rem 1rem;margin:1.2rem 0;font-size:.75rem}.review-recipient span{font-size:.72rem;color:#9da991;margin-right:.75rem}.review-recipient p{font-size:.7rem;color:#859778;margin:.3rem 0 0 2.3rem;overflow-wrap:anywhere}.review-body{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem;line-height:2;max-height:40vh;overflow:auto;padding:.4rem .3rem}.review-check{display:flex;align-items:center;gap:.6rem;margin:1rem 0;font-size:.75rem}.review-check input{accent-color:#36583d}.review-dialog footer{display:flex;gap:.7rem;justify-content:flex-end;border-top:1px solid #e9eddf;padding-top:1rem}button:disabled{opacity:.4;cursor:not-allowed}@keyframes pulse{50%{opacity:.3}}
 @media(min-width:1600px){.workspace{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr)}}@media(max-width:1000px){.workspace{gap:1rem}.desk-heading h1{font-size:1.15rem}.composer-actions{flex-wrap:wrap}.composer-actions .primary-button{flex:1}}@media(max-width:767px){.desk-topline{margin-bottom:1rem}.desk-heading{gap:.7rem;flex-wrap:wrap}.guest-avatar{height:2.5rem;width:2.5rem;border-radius:.8rem}.desk-heading .status-pill{margin-left:3.2rem}.heading-copy p{font-size:.67rem}.assignment-bar{gap:.65rem;padding:.75rem;margin-bottom:1rem}.assignment-bar label{font-size:.72rem}.assignment-bar input{max-width:8rem}.assignment-bar select{max-width:10rem}.workspace{display:block}.mobile-tabs{display:flex;border-bottom:1px solid #e0e7d8;margin-bottom:1rem;gap:1rem}.mobile-tabs button{padding:.7rem .2rem;font-size:.8rem;color:#788570;display:flex;gap:.5rem;align-items:center}.mobile-tabs .active{border-bottom:2px solid #38563e;color:#38563e;font-weight:600}.mobile-tabs span{font-size:.68rem;padding:.1rem .35rem;background:#f0f4e9;border-radius:100px}.mobile-tabs i{height:5px;width:5px;border-radius:50%;background:#8aa570}.mobile-hidden{display:none}.thread-scroll{max-height:none;min-height:260px;padding:.9rem}.message-card{padding:.9rem}.message-heading time{font-size:.54rem}.composer-panel textarea{min-height:360px}.panel-title{padding:1rem}.assignment-bar .quiet-button{margin-left:auto}}
 .message-count{font-size:.68rem;font-weight:400;color:#788570;margin-left:.2rem}.thread-actions{display:flex;gap:.7rem;font-size:.68rem;color:#71816b}.thread-actions button:hover{text-decoration:underline}.message-card{padding:0}.message-summary{padding:1rem;cursor:pointer;list-style:none}.message-summary::-webkit-details-marker{display:none}.message-summary:focus-visible{outline:2px solid #6e8867;outline-offset:-3px;border-radius:.8rem}.message-summary:hover{background:#eaf0e630}.message-chevron{font-size:1.2rem;color:#819174;transition:transform .15s}.message-card[open]>.message-summary .message-chevron{transform:rotate(90deg)}.message-preview{font-size:.75rem;color:#7a8773;margin:.6rem 0 0 2.4rem;line-height:1.7;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}.message-card[open]>.message-summary .message-preview{display:none}.message-content{padding:0 1rem 1rem}.message-heading strong{overflow-wrap:anywhere}.message-heading time{font-size:.65rem}.source-card strong{line-clamp:2}.source-card[open] strong{line-clamp:unset}@media(max-width:767px){.message-card{padding:0}.message-summary{padding:.85rem}.message-content{padding:0 .85rem .85rem}.message-heading time{font-size:.58rem}.thread-actions{gap:.6rem;font-size:.65rem}}
 .reply-assignee{display:flex;align-items:center;gap:.8rem;padding:.7rem 1.3rem;border-bottom:1px solid #eef1e9;font-size:.72rem;color:#788570}.reply-assignee select{min-width:0;width:min(230px,70%);padding:.4rem .6rem;border:1px solid #e0e5dc;border-radius:.5rem;font-size:.8rem;color:#384f40}.reply-assignee a{margin-left:auto;white-space:nowrap;color:#637c52;text-decoration:underline;font-size:.68rem}.reply-signature{padding:.7rem 1.3rem 1rem;white-space:pre-wrap;border-top:1px dashed #e4e9df;color:#72806c;font-size:.75rem;line-height:1.8}.reply-signature>summary{cursor:pointer;font-size:.7rem;color:#788570}.reply-signature>div{margin-top:.5rem}.attachment-zone{margin:.5rem 1.2rem .8rem;padding:.85rem;border:1px dashed #d5ddce;border-radius:.7rem;background:#fafcf7;transition:background .15s,border-color .15s}.attachment-zone.drag-over{background:#ecf3e5;border-color:#6d8e5f;box-shadow:0 0 0 2px #6d8e5f25}.attachment-heading{display:flex;align-items:center;justify-content:space-between;gap:.6rem;font-size:.72rem;color:#708366}.attachment-heading .quiet-button{font-size:.68rem;padding:.35rem .55rem}.attachment-limit{font-size:.63rem;color:#8a967e;margin-top:.35rem;line-height:1.7}.attachment-list{list-style:none;padding:0;margin:.6rem 0 0;display:grid;gap:.4rem;font-size:.72rem}.attachment-list li{display:flex;align-items:center;gap:.5rem;padding:.45rem .6rem;border:1px solid #e3e9dc;border-radius:.5rem;background:#fff;min-width:0}.attachment-list a{display:flex;flex:1;min-width:0;overflow-wrap:anywhere;align-items:center;justify-content:space-between;gap:.6rem;color:#557348;text-decoration:underline}.attachment-list a span{color:#88957b;font-size:.63rem;white-space:nowrap;flex-shrink:0;text-decoration:none}.attachment-list button{font-size:1.1rem;color:#8b9682;padding:0 .2rem;flex-shrink:0}.attachment-error{font-size:.72rem;line-height:1.7;color:#aa664a;margin-top:.5rem}.sent-files{margin-top:.8rem}.signature-settings{margin:.2rem 1.2rem 1rem;border-top:1px solid #e8eddf;padding-top:.7rem;font-size:.72rem;color:#788570}.signature-settings>summary{cursor:pointer}.signature-settings>label{display:block;font-size:.7rem;margin-top:.8rem}.signature-settings textarea{height:180px;min-height:140px;max-height:400px;border:1px solid #dfe6d7;border-radius:.6rem;padding:.7rem;margin-top:.4rem;font-size:.75rem;line-height:1.8;white-space:pre-wrap}.signature-settings>p{font-size:.65rem;margin-top:.4rem}.signature-settings>div{display:flex;justify-content:flex-end;gap:.5rem;margin-top:.6rem}.review-files{margin-top:1rem;font-size:.75rem}.review-files>strong{font-weight:500}.review-files li>span{overflow-wrap:anywhere}@media(max-width:767px){.reply-assignee{padding:.7rem 1rem}.reply-signature{padding:.7rem 1rem}.attachment-zone{margin:.5rem .9rem .8rem;padding:.7rem}.attachment-heading{flex-wrap:wrap}.attachment-list a{flex-wrap:wrap}.signature-settings{margin:.2rem 1rem 1rem}}
.inquiry-type-badge{display:inline-block;background:#f0f3e9;color:#627457;border:1px solid #dce4d5;padding:.2rem .5rem;border-radius:.4rem;font-size:.72rem;margin:.3rem 0}
.translation-panel{border:1px solid #dce5d5;border-radius:.7rem;padding:.85rem;margin-top:1rem;background:#f7faf3}.draft-translation{margin:.3rem 1.2rem 1rem}.translation-heading{display:flex;align-items:center;justify-content:space-between;gap:.7rem}.translation-heading strong{font-size:.75rem;font-weight:550;color:#536c48}.translation-heading strong span{display:block;font-size:.64rem;font-weight:400;color:#798972;margin-top:.25rem}.translation-heading .quiet-button{font-size:.68rem;padding:.4rem .6rem;white-space:nowrap}.translation-text{font-size:.8rem;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.95;color:#465b43;margin-top:.7rem;max-height:420px;overflow:auto}.translation-panel details>summary{font-size:.7rem;color:#73856a;cursor:pointer;margin-top:.7rem}.translation-stale,.translation-status{font-size:.72rem;color:#7b8971;margin-top:.6rem}.translation-error{font-size:.72rem;line-height:1.8;margin-top:.6rem;color:#a16d47}.translation-error{color:#ab5949}
</style>
