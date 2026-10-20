<script lang="ts">
 import {onMount,type Snippet} from 'svelte';
 let {title,onDismiss,children}:{title:string;onDismiss:()=>void;children:Snippet}=$props();
 let element:HTMLDialogElement;
 onMount(()=>{
  const previous=document.activeElement;
  element.showModal();
  return()=>{element.close();if(previous instanceof HTMLElement)previous.focus();};
 });
</script>
<dialog bind:this={element} aria-label={title} oncancel={e=>{e.preventDefault();onDismiss();}}>
 {@render children()}
</dialog>
<style>dialog{width:calc(100% - 32px);max-width:576px;max-height:85vh;padding:0;border:0;border-radius:12px;overflow:auto;background:white;color:#292524}dialog::backdrop{background:#0008}</style>
