<script lang="ts">
 import type {Snippet} from 'svelte';
 import Source from './NewsSourceEditor.svelte';
 import Rich from './NewsRichEditor.svelte';
 let {value=$bindable(''),name='body',facilityId,source=false,disabled=false,onBusy=(_v:boolean)=>{},onSave=()=>{},onToolbar}:{value?:string;name?:string;facilityId:string;source?:boolean;disabled?:boolean;onBusy?:(v:boolean)=>void;onSave?:()=>void;onToolbar?:(tools:Snippet|undefined)=>void}=$props();
</script>
<section class="writing" aria-label="お知らせの本文エディタ">
 {#if source}<Source bind:value {name} {facilityId} {disabled} {onBusy} {onSave} {onToolbar}/>{:else}<input type="hidden" {name} {value}/><Rich bind:value {facilityId} {disabled} {onBusy} {onSave} {onToolbar}/>{/if}
</section>
<style>.writing{background:#fff;min-width:0}</style>
