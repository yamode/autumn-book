<script lang="ts">
 import Source from './NewsSourceEditor.svelte';
 import Rich from './NewsRichEditor.svelte';
 let {value=$bindable(''),name='body',facilityId,disabled=false,onBusy=(_v:boolean)=>{},onSave=()=>{}}:{value?:string;name?:string;facilityId:string;disabled?:boolean;onBusy?:(v:boolean)=>void;onSave?:()=>void}=$props();
 let source=$state(false),full=$state(false),uploading=$state(false);
 function busy(v:boolean){uploading=v;onBusy(v);}
</script>
<svelte:window onkeydown={e=>{if(e.key==='Escape')full=false;}}/>
<section class="writing" class:fullscreen={full} aria-label="お知らせの本文エディタ">
 <div class="mode-bar"><strong>本文</strong><div><button type="button" disabled={uploading} class:active={!source} onclick={()=>source=false}>見たまま編集</button><button type="button" disabled={uploading} class:active={source} onclick={()=>source=true}>Markdown</button><button type="button" onclick={()=>full=!full}>{full?'全画面を閉じる':'全画面'}</button></div></div>
 {#if source}<div class="source-shell"><Source bind:value {name} {facilityId} {disabled} onBusy={busy} {onSave}/></div>{:else}<input type="hidden" {name} {value}/><Rich bind:value {facilityId} {disabled} onBusy={busy} {onSave}/>{/if}
</section>
<style>
.writing{border:1px solid #e3e6dd;border-radius:10px;background:white;overflow:hidden}.mode-bar{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 18px;border-bottom:1px solid #eee;background:#fafbf8;font-size:12px}.mode-bar strong{font-weight:500}.mode-bar>div{display:flex;gap:4px}.mode-bar button{padding:6px 10px;border-radius:5px;color:#999}.mode-bar button:hover{background:#edf0e8;color:#444}.mode-bar .active{color:#3f5135;background:#edf2e7}.source-shell :global(.news-markdown){border:0;border-radius:0}.source-shell :global(.expand){display:none}.fullscreen{position:fixed;inset:12px;z-index:100;box-shadow:0 10px 80px #0004;overflow:auto}.fullscreen :global(.document-scroll){height:calc(100dvh - 170px)}@media(max-width:600px){.mode-bar{padding:10px}.mode-bar button{font-size:11px;padding:6px}.fullscreen{inset:4px}}
</style>
