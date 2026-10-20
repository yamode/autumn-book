<script lang="ts">
 import {blockLabels,isRichBlock,type MailBlock} from '$lib/newsletter';
 import MailRichText from './MailRichText.svelte';
 let {block,disabled=false,onPatch,onUpload,onDuplicate,onDelete,onSave,onCheckpoint}:{block:MailBlock;disabled?:boolean;onPatch:(patch:Partial<MailBlock>)=>void;onUpload:(file:File,id:string)=>void;onDuplicate:()=>void;onDelete:()=>void;onSave:()=>void;onCheckpoint:()=>void}=$props();
 let tab=$state('content');
 const patch=(key:keyof MailBlock,value:unknown)=>onPatch({[key]:value});
</script>
<section class="properties">
 <header><div><p class="eyebrow">BLOCK SETTINGS</p><h2>{blockLabels[block.kind]}</h2></div><span class="badge">編集中</span></header>
 <nav aria-label="ブロック設定"><button class:active={tab==='content'} onclick={()=>tab='content'}>コンテンツ</button><button class:active={tab==='style'} onclick={()=>tab='style'}>スタイル</button><button class:active={tab==='mobile'} onclick={()=>tab='mobile'}>モバイル</button></nav>
 <fieldset {disabled} onfocusin={onCheckpoint}>
 <label>ブロック名<input value={block.label??''} oninput={e=>patch('label',e.currentTarget.value)} placeholder={blockLabels[block.kind]}/></label>
 {#if tab==='content'}
  {#if isRichBlock(block.kind)&&block.kind!=='html'}<MailRichText bind:value={()=>block.text,v=>patch('text',v)} {disabled}/>{:else if ['heading','text','button','html','offer'].includes(block.kind)}<label>{block.kind==='html'?'HTMLコード':block.kind==='offer'?'特典の見出し':'テキスト'}<textarea rows={block.kind==='html'?14:5} value={block.text} oninput={e=>patch('text',e.currentTarget.value)}></textarea></label>{/if}
  {#if ['image','imageText'].includes(block.kind)}
   <label class="upload">画像をアップロード<input type="file" accept="image/png,image/jpeg,image/webp,image/avif" onchange={e=>{const file=e.currentTarget.files?.[0];if(file)onUpload(file,block.id);}}/></label>
   <label>画像URL<input value={block.url} oninput={e=>patch('url',e.currentTarget.value)} placeholder="https://…"/></label>
   <label>代替テキスト<input value={block.alt} oninput={e=>patch('alt',e.currentTarget.value)} placeholder="写真の内容を説明"/></label>
   <label>画像のリンク先（任意）<input value={block.link??''} oninput={e=>patch('link',e.currentTarget.value)} placeholder="https://…"/></label>
   <label>画像の最大幅（px・0で全幅）<input type="number" min="0" max="600" value={block.imageWidth??0} oninput={e=>patch('imageWidth',e.currentTarget.valueAsNumber)}/></label>
   {#if block.kind==='image'}<label>写真下のキャプション<textarea rows="2" value={block.caption??''} oninput={e=>patch('caption',e.currentTarget.value)}></textarea></label>{/if}
  {/if}
  {#if block.kind==='imageText'}<label>英字ラベル<input value={block.eyebrow??''} oninput={e=>patch('eyebrow',e.currentTarget.value)}/></label><label>見出し<textarea rows="3" value={block.heading??''} oninput={e=>patch('heading',e.currentTarget.value)}></textarea></label><label>画像の位置<select value={block.imagePosition??'left'} onchange={e=>patch('imagePosition',e.currentTarget.value)}><option value="left">左</option><option value="right">右</option></select></label><p class="hint">モバイルでは縦に並びます。</p>{/if}
  {#if block.kind==='offer'}
   <label>英字ラベル<input value={block.eyebrow??''} oninput={e=>patch('eyebrow',e.currentTarget.value)}/></label>
   <div class="pair"><label>通常価格<input value={block.previousPrice??''} oninput={e=>patch('previousPrice',e.currentTarget.value)} placeholder="36,000"/></label><label>販売価格<input value={block.price??''} oninput={e=>patch('price',e.currentTarget.value)} placeholder="32,400"/></label></div>
   <label>価格の単位<input value={block.priceSuffix??'円'} oninput={e=>patch('priceSuffix',e.currentTarget.value)}/></label><label>割引・送料などの説明<input value={block.note??''} oninput={e=>patch('note',e.currentTarget.value)}/></label>
   <label>クーポンの案内文<input value={block.couponLabel??''} oninput={e=>patch('couponLabel',e.currentTarget.value)}/></label><label>クーポンコード<input value={block.couponCode??''} oninput={e=>patch('couponCode',e.currentTarget.value)}/></label>
  {/if}
  {#if block.kind==='button'}<label>リンク先URL<input value={block.url} oninput={e=>patch('url',e.currentTarget.value)} placeholder="https://…"/></label>{/if}
  {#if block.kind==='spacer'}<label>余白の高さ（px）<input type="number" min="4" max="160" value={block.height??24} oninput={e=>patch('height',e.currentTarget.valueAsNumber)}/></label>{/if}
 {:else if tab==='style'}
  <label>書体<select value={block.font??'sans'} onchange={e=>patch('font',e.currentTarget.value)}><option value="sans">ゴシック</option><option value="serif">明朝</option><option value="mono">等幅</option></select></label>
  <div class="pair"><label>文字サイズ<input type="number" min="14" max="48" value={block.size} oninput={e=>patch('size',e.currentTarget.valueAsNumber)}/></label><label>行間<input type="number" min="1" max="3" step="0.05" value={block.lineHeight??1.85} oninput={e=>patch('lineHeight',e.currentTarget.valueAsNumber)}/></label></div>
  <label>配置<select value={block.align} onchange={e=>patch('align',e.currentTarget.value)}><option value="left">左寄せ</option><option value="center">中央</option><option value="right">右寄せ</option></select></label>
  <div class="pair"><label>文字色<input type="color" value={block.color} oninput={e=>patch('color',e.currentTarget.value)}/></label><label>背景色<input type="color" value={block.background} oninput={e=>patch('background',e.currentTarget.value)}/></label></div>
  <label>文字間（px）<input type="number" min="0" max="8" step="0.5" value={block.letterSpacing??0} oninput={e=>patch('letterSpacing',e.currentTarget.valueAsNumber)}/></label>
  {#if ['offer','imageText'].includes(block.kind)}<label>英字ラベルの色<input type="color" value={block.eyebrowColor??'#8b633d'} oninput={e=>patch('eyebrowColor',e.currentTarget.value)}/></label>{/if}
  <h3>外側の余白</h3><div class="pair">{#each [['paddingTop','上'],['paddingRight','右'],['paddingBottom','下'],['paddingLeft','左']] as [key,label]}<label>{label}（px）<input type="number" min="0" max="96" value={(block as any)[key]??block.padding} oninput={e=>patch(key as keyof MailBlock,e.currentTarget.valueAsNumber)}/></label>{/each}</div>
  {#if ['offer','callout'].includes(block.kind)}<div class="pair"><label>枠の中の背景<input type="color" value={block.boxColor??'#fbf6ed'} oninput={e=>patch('boxColor',e.currentTarget.value)}/></label><label>枠・ラベルの色<input type="color" value={block.borderColor??'#b28a4c'} oninput={e=>patch('borderColor',e.currentTarget.value)}/></label></div>{/if}
  {#if block.kind==='imageText'}<div class="pair"><label>見出しの大きさ<input type="number" min="14" max="40" value={block.headingSize??22} oninput={e=>patch('headingSize',e.currentTarget.valueAsNumber)}/></label><label>列の間隔<input type="number" min="0" max="64" value={block.columnGap??20} oninput={e=>patch('columnGap',e.currentTarget.valueAsNumber)}/></label></div>{/if}
  {#if block.kind==='button'}
   <div class="pair"><label>ボタンの色<input type="color" value={block.buttonColor??'#8b282e'} oninput={e=>patch('buttonColor',e.currentTarget.value)}/></label><label>ボタンの文字色<input type="color" value={block.buttonTextColor??'#ffffff'} oninput={e=>patch('buttonTextColor',e.currentTarget.value)}/></label></div>
   <label>ボタンの幅<select value={block.buttonWidth??'auto'} onchange={e=>patch('buttonWidth',e.currentTarget.value)}><option value="auto">テキストに合わせる</option><option value="full">横幅いっぱい</option></select></label>
   <div class="pair"><label>左右の余白<input type="number" min="8" max="64" value={block.buttonPaddingX??24} oninput={e=>patch('buttonPaddingX',e.currentTarget.valueAsNumber)}/></label><label>上下の余白<input type="number" min="8" max="48" value={block.buttonPaddingY??16} oninput={e=>patch('buttonPaddingY',e.currentTarget.valueAsNumber)}/></label></div><label>角丸<input type="number" min="0" max="32" value={block.buttonRadius??6} oninput={e=>patch('buttonRadius',e.currentTarget.valueAsNumber)}/></label>
  {/if}
  {#if block.kind==='divider'}<label>線の色<input type="color" value={block.dividerColor??'#d6d3d1'} oninput={e=>patch('dividerColor',e.currentTarget.value)}/></label><div class="pair"><label>線の太さ<input type="number" min="1" max="8" value={block.dividerThickness??1} oninput={e=>patch('dividerThickness',e.currentTarget.valueAsNumber)}/></label><label>線の幅（0で全幅）<input type="number" min="0" max="600" value={block.dividerWidth??0} oninput={e=>patch('dividerWidth',e.currentTarget.valueAsNumber)}/></label></div>{/if}
  <details><summary>背景画像</summary><label>背景画像URL<input value={block.backgroundImage??''} oninput={e=>patch('backgroundImage',e.currentTarget.value)} placeholder="https://…"/></label><p class="hint">画像が表示されない環境でも読める背景色にしてください。</p></details>
 {:else}
  <p class="hint">空欄はPCと共通。中央の「モバイル」で確認できます。</p>
  <label>文字サイズ（px）<input type="number" min="14" max="48" value={block.mobileSize} oninput={e=>patch('mobileSize',e.currentTarget.value===''?undefined:e.currentTarget.valueAsNumber)}/></label>
  <label>余白（px）<input type="number" min="0" max="96" value={block.mobilePadding} oninput={e=>patch('mobilePadding',e.currentTarget.value===''?undefined:e.currentTarget.valueAsNumber)}/></label>
  <label class="check"><input type="checkbox" checked={block.hideMobile??false} onchange={e=>patch('hideMobile',e.currentTarget.checked)}/>モバイルで非表示</label><label class="check"><input type="checkbox" checked={block.hideDesktop??false} onchange={e=>patch('hideDesktop',e.currentTarget.checked)}/>PCで非表示</label>
 {/if}
 </fieldset>
 <footer><button disabled={disabled} onclick={onDuplicate}>複製</button><button disabled={disabled} onclick={onSave}>ブロック保存</button><button class="danger" disabled={disabled} onclick={onDelete}>削除</button></footer>
</section>
<style>
 .properties{font-size:14px;color:#292524}header{display:flex;align-items:center;justify-content:space-between;padding:20px;border-bottom:1px solid #eeeae4}h2{font-size:19px;font-weight:650}.eyebrow{font-size:14px;letter-spacing:1px;color:#8b633d;margin-bottom:4px}.badge{background:#f8eee7;color:#8b633d;padding:4px 8px;border-radius:5px;font-size:14px}nav{display:flex;padding:8px;gap:4px;border-bottom:1px solid #eeeae4}nav button{flex:1;padding:9px 4px;font-size:14px;border-radius:6px}.active{background:#f0eae3;color:#6b3a2e;font-weight:600}fieldset{padding:18px;display:flex;flex-direction:column;gap:17px;border:0;min-width:0}label{display:block;font-size:14px;font-weight:500}input:not([type=checkbox]),textarea,select{display:block;margin-top:7px;width:100%;min-height:42px;border:1px solid #d9d3ca;background:#fff;border-radius:7px;padding:9px 10px;font-size:14px;font-weight:400}input[type=color]{padding:4px;height:42px}textarea{line-height:1.7}.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}.hint{font-size:14px;line-height:1.7;color:#78716c}.check{display:flex;align-items:center;gap:9px}.upload{padding:14px;border:1px dashed #bca68c;border-radius:8px;color:#795637;background:#fcfaf6}.upload input{font-size:14px;max-width:100%}summary{cursor:pointer;font-size:14px}h3{font-weight:600}footer{border-top:1px solid #eeeae4;display:flex;gap:7px;padding:16px;flex-wrap:wrap}footer button{border:1px solid #d9d3ca;border-radius:6px;padding:9px 10px;min-height:42px;font-size:14px}.danger{color:#b42318}button:hover{background:#f5f2ed}button:disabled{opacity:.45}input:focus,textarea:focus,select:focus{outline:2px solid #b28a4c;outline-offset:1px}
</style>
