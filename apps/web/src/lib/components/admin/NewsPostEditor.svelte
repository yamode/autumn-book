<script lang="ts">
 import {untrack} from 'svelte';
 import {enhance,deserialize} from '$app/forms';
 import {beforeNavigate} from '$app/navigation';
 import NewsMarkdownEditor from './NewsMarkdownEditor.svelte';
 import type {NewsPost} from '$lib/types';
 let {post,facilityId,hpPreviewSupported=false,canEdit=true,onDirty=(_dirty:boolean)=>{}}:{onDirty?:(dirty:boolean)=>void;post?:NewsPost;facilityId:string;hpPreviewSupported?:boolean;canEdit?:boolean}=$props();
 const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let title=$state(untrack(()=>post?.title??'')),body=$state(untrack(()=>post?.body??'')),publishedAt=$state(untrack(()=>post?.publishedAt??today())),isPublished=$state(untrack(()=>post?.isPublished??false));
 let saved=$state(untrack(()=>JSON.stringify({title,body,publishedAt,isPublished}))),busy=$state(false),uploading=$state(false),notice=$state(''),error=$state('');
 let formEl:HTMLFormElement;
 const dirty=$derived(JSON.stringify({title,body,publishedAt,isPublished})!==saved),locked=$derived(busy||uploading||!canEdit);
 $effect(()=>onDirty(dirty));
 function snapshot(published=isPublished){return JSON.stringify({title,body,publishedAt,isPublished:published});}
 beforeNavigate(nav=>{if(busy||uploading){nav.cancel();return;}if(dirty&&!confirm('保存していないお知らせの変更があります。移動しますか？'))nav.cancel();});
 function submit(){const pending=snapshot();busy=true;error='';notice='';return async({result,update}:Parameters<Exclude<Awaited<ReturnType<import('@sveltejs/kit').SubmitFunction>>,void>>[0])=>{try{await update({reset:false});if(result.type==='success'){saved=pending;notice=isPublished?'公開内容を保存しました。':'下書きを保存しました。';}else if(result.type==='failure')error=String(result.data?.message??'保存できませんでした。');else error='保存できませんでした。';}finally{busy=false;}};}
 function save(){if(!locked&&formEl.reportValidity())formEl.requestSubmit();}
 async function preview(){
  if(locked||!post||!formEl.reportValidity())return;
  const popup=window.open('about:blank','_blank');if(!popup){error='プレビューを開くため、このサイトのポップアップを許可してください。';return;}popup.opener=null;
  const pending=snapshot(false),form=new FormData(formEl);busy=true;error='';notice='';
  try{
   const response=await fetch('/admin/news?/preview',{method:'POST',body:form,headers:{accept:'application/json','x-sveltekit-action':'true'},signal:AbortSignal.timeout(20000)});
   const result=deserialize(await response.text());
   if(result.type!=='success'||typeof result.data?.previewUrl!=='string')throw Error(result.type==='failure'?String(result.data?.message??'プレビューを開けませんでした。'):'プレビューを開けませんでした。');
   const url=new URL(result.data.previewUrl);if(url.origin!=='https://www.yamado.co.jp')throw Error('プレビュー先を確認できません。');
   popup.location.href=url.href;saved=pending;notice='下書きを保存し、公式HPのプレビューを開きました。公開状態は変更していません。';
  }catch(e){popup.close();error=e instanceof Error?e.message:'プレビューを開けませんでした。';}finally{busy=false;}
 }
</script>
<form bind:this={formEl} method="POST" action={post?'?/save':'?/add'} use:enhance={submit} class="news-post-editor" aria-label={post?'お知らせを編集':'新しいお知らせ'}>
 <input type="hidden" name="facilityId" value={facilityId}/>{#if post}<input type="hidden" name="postId" value={post.id}/>{/if}
 <div class="post-fields"><label class="title-field">タイトル<input name="title" bind:value={title} required maxlength="200" placeholder="お知らせのタイトル" disabled={locked}/></label><label>掲載日<input name="publishedAt" type="date" bind:value={publishedAt} required disabled={locked}/></label>{#if post}<label class="publication"><input name="isPublished" type="checkbox" bind:checked={isPublished} disabled={locked}/>公開する</label>{/if}</div>
 <NewsMarkdownEditor bind:value={body} {facilityId} disabled={busy||!canEdit} onBusy={value=>uploading=value} onSave={save}/>
 <div class="post-editor-footer"><span class:unsaved={dirty}>{uploading?'画像を追加中…':busy?'処理中…':dirty?'未保存の変更があります':'保存済み'}{#if !post&&!dirty} · 新規{/if}</span><div>{#if post&&hpPreviewSupported&&!post.isPublished&&canEdit}<button type="button" class="preview-button" disabled={locked} onclick={()=>void preview()}>保存してHPでプレビュー ↗</button>{:else if post&&hpPreviewSupported&&post.isPublished}<a class="preview-button" href={`https://www.yamado.co.jp/news/${post.id}/`} target="_blank" rel="noopener noreferrer">HPで確認 ↗</a>{/if}{#if canEdit}<button type="submit" class="save-button" disabled={locked}>{busy?'処理中…':post?'変更を保存':'下書きを作成'}</button>{/if}</div></div>
 {#if !post}<p class="post-help">下書きの作成後に、公式HPの画面でプレビューできます。</p>{/if}
 {#if error}<p class="post-error" role="alert">{error}</p>{/if}{#if notice}<p class="post-notice" role="status">{notice}</p>{/if}
</form>
<style>
.news-post-editor{padding:1.3rem;background:#fff;color:#3c5134}.post-fields{display:flex;gap:1rem;align-items:flex-end;margin-bottom:1.1rem;flex-wrap:wrap}.post-fields label{display:grid;gap:.4rem;font-size:.7rem;color:#829073}.post-fields .title-field{flex:1;min-width:250px}.post-fields input:not([type=checkbox]){background:#fff;border:1px solid #dbe2d3;border-radius:.5rem;padding:.65rem .75rem;color:#3b5133;font-size:.83rem}.post-fields .publication{display:flex;align-items:center;gap:.45rem;padding-bottom:.65rem;font-size:.75rem}.publication input{accent-color:#66884d}.post-editor-footer{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-top:1rem}.post-editor-footer>span{font-size:.68rem;color:#92a17f}.post-editor-footer>.unsaved{color:#b58a49}.post-editor-footer>div{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}.post-editor-footer button,.preview-button{border:1px solid #d9e2cf;border-radius:.5rem;padding:.65rem .9rem;font-size:.75rem;transition:background .15s,box-shadow .15s,transform .15s}.preview-button{background:#fff;color:#6b8558}.preview-button:hover:not(:disabled){background:#eef4e6;border-color:#a9be94;box-shadow:0 2px 7px #38502b18}.post-editor-footer .save-button{background:#57764a;border-color:#57764a;color:#fff}.save-button:hover:not(:disabled){background:#3e5c31;box-shadow:0 3px 9px #304a2425;transform:translateY(-1px)}button:disabled{opacity:.45;cursor:default}.post-help{font-size:.67rem;color:#94a083;margin-top:.7rem}.post-error,.post-notice{font-size:.75rem;line-height:1.8;padding:.8rem 1rem;margin-top:1rem;border-radius:.55rem}.post-error{color:#a66746;background:#fff1e8}.post-notice{color:#66824e;background:#f1f6e9}input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #86a36c;outline-offset:2px}@media(max-width:650px){.news-post-editor{padding:1rem}.post-fields{gap:.8rem}.post-fields .title-field{min-width:100%;width:100%}.post-editor-footer{align-items:flex-start;flex-direction:column}.post-editor-footer>div{width:100%}.post-editor-footer .save-button{margin-left:auto}.preview-button{font-size:.7rem}}
</style>
