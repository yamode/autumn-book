<script lang="ts">
 import type { MailPart } from '$lib/inquiry-mail-display';
 let { parts, original }: { parts: MailPart[]; original: string } = $props();
</script>

<div class="mail-body">
 {#each parts as part}
  {#if part.kind === 'body'}
   <div class="current-body">{part.text.slice(0, 1600)}{#if part.text.length > 1600}<details class="long-body"><summary>本文の続きを表示</summary><div>{part.text.slice(1600)}</div></details>{/if}</div>
  {:else}
   <details class="mail-fold" class:quote={part.kind === 'quote'}>
    <summary>{part.kind === 'quote' ? '引用メール' : '署名'}<span>{part.text.split('\n').length}行</span></summary>
    <div class="fold-content">{part.text}</div>
   </details>
  {/if}
 {/each}
 {#if parts.some(p => p.kind !== 'body')}
  <details class="original-mail"><summary>原文を表示</summary><div>{original}</div></details>
 {/if}
</div>

<style>
 .mail-body{font-size:.85rem;line-height:1.95;overflow-wrap:anywhere;color:#4e5e51}.current-body,.fold-content,.original-mail>div{white-space:pre-wrap}.current-body+.current-body{margin-top:1rem}.mail-fold{margin-top:.8rem;border:1px solid #e4e8e1;border-radius:.55rem;background:#f8faf6;font-size:.75rem}.mail-fold>summary{display:flex;align-items:center;gap:.5rem;cursor:pointer;padding:.5rem .7rem;color:#71816b;list-style:none}.mail-fold>summary::before{content:'›';font-size:1rem;line-height:1;transition:transform .15s}.mail-fold[open]>summary::before{transform:rotate(90deg)}.mail-fold summary::-webkit-details-marker{display:none}.mail-fold>summary span{margin-left:auto;color:#87927f;font-size:.65rem}.fold-content{padding:.75rem;border-top:1px solid #e4e8e1;max-height:360px;overflow:auto;color:#73806d;font-size:.75rem}.quote .fold-content{border-left:3px solid #d9e1d2}.original-mail{font-size:.68rem;margin-top:.6rem;color:#829078}.original-mail>summary,.long-body>summary{cursor:pointer}.original-mail>div{margin-top:.5rem;max-height:400px;overflow:auto;background:#f8faf6;padding:.7rem}.long-body{font-size:inherit}.long-body>summary{font-size:.72rem;color:#71816b;padding:.4rem 0}
</style>
