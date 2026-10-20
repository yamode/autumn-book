// Shared document model: the browser previews this model in a sandbox; only the
// server's sanitized rendering is stored for delivery.
export type BlockKind = 'heading' | 'text' | 'richtext' | 'image' | 'button' | 'divider' | 'spacer' | 'html';
export type MailBlock = { id: string; kind: BlockKind; text: string; url: string; alt: string; color: string; background: string; backgroundImage?:string; mobileSize?:number;mobilePadding?:number;hideMobile?:boolean;hideDesktop?:boolean;align: 'left' | 'center' | 'right'; padding: number; size: number };
export type MailDocument = { background: string; accent: string; blocks: MailBlock[] };
export const blockLabels: Record<BlockKind,string> = {heading:'見出し',text:'テキスト',richtext:'リッチテキスト',image:'画像',button:'ボタン',divider:'区切り線',spacer:'余白',html:'HTML'};
export function newBlock(kind: BlockKind): MailBlock {
 return {id:crypto.randomUUID(),kind,text:kind==='heading'?'新しいお知らせ':kind==='button'?'詳しく見る':kind==='text'?'ここに本文を入力してください。':kind==='richtext'?'<p>ここに本文を入力してください。</p>':'',url:'',alt:'',color:'#292524',background:'#ffffff',align:kind==='heading'||kind==='button'?'center':'left',padding:24,size:kind==='heading'?28:16};
}
export function emptyDocument(): MailDocument {return {background:'#f5f5f4',accent:'#8b282e',blocks:[newBlock('heading'),newBlock('text'),newBlock('button')]};}
export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function safeUrl(value:string,image=false): string {
 try { const u=new URL(value);return (image?u.protocol==='https:':['https:','http:','mailto:','tel:'].includes(u.protocol))?u.href:'';}catch{return '';}
}
const color=(s:string,fallback:string)=>/^#[0-9a-f]{6}$/i.test(s)?s:fallback;
export function normalizeDocument(input: unknown): MailDocument {
 const d=input as Partial<MailDocument>|null;
 if(!d||!Array.isArray(d.blocks)||d.blocks.length>100)throw Error('ブロックは100個以内で作成してください。');
 if(d.blocks.some(b=>!b||!b.id)||new Set(d.blocks.map(b=>b.id)).size!==d.blocks.length)throw Error('ブロックの識別情報が重複しています。');
 return {background:color(d.background??'','#f5f5f4'),accent:color(d.accent??'','#8b282e'),blocks:d.blocks.map(b=>{
  if(!b||!Object.hasOwn(blockLabels,b.kind))throw Error('未対応のブロックです。');
  return {id:String(b.id).slice(0,80),kind:b.kind,text:String(b.text??'').slice(0,50000),url:String(b.url??'').slice(0,2000),alt:String(b.alt??'').slice(0,300),color:color(b.color,'#292524'),background:color(b.background,'#ffffff'),backgroundImage:String(b.backgroundImage??'').slice(0,2000),mobileSize:b.mobileSize===undefined?undefined:Math.min(48,Math.max(14,Number(b.mobileSize)||16)),mobilePadding:b.mobilePadding===undefined?undefined:Math.min(64,Math.max(0,Number(b.mobilePadding)||0)),hideMobile:b.hideMobile===true,hideDesktop:b.hideDesktop===true,align:['left','center','right'].includes(b.align)?b.align:'left',padding:Math.min(64,Math.max(0,Number(b.padding)||0)),size:Math.min(48,Math.max(14,Number(b.size)||16))};
 })};
}
export function renderDocument(input:MailDocument,preheader=''): string {
 const d=normalizeDocument(input),e=escapeHtml;
 const rules=d.blocks.map((b,i)=>`${b.hideDesktop?`.mail-block-${i}{display:none;mso-hide:all;}`:''}@media(max-width:600px){.mail-block-${i}{display:${b.hideMobile?'none':'table-row'}!important;} .mail-block-${i}>td{${b.mobilePadding!==undefined?`padding:${b.mobilePadding}px!important;`:''}${b.mobileSize!==undefined?`font-size:${b.mobileSize}px!important;`:''}}${b.mobileSize!==undefined?`.mail-block-${i}>td h2,.mail-block-${i}>td>div{font-size:${b.mobileSize}px!important;}`:''}}`).join('');
 const blocks=d.blocks.map((b,i)=>{
  const txt=e(b.text).replace(/\n/g,'<br>'),url=e(safeUrl(b.url,b.kind==='image'));
  const inside=b.kind==='heading'?`<h2 style="font-size:${b.size}px;line-height:1.5;margin:0;">${txt}</h2>`:b.kind==='text'?`<div style="font-size:${b.size}px;line-height:1.85;">${txt}</div>`:b.kind==='image'?url?`<img src="${url}" alt="${e(b.alt)}" width="552" style="display:block;border:0;width:100%;max-width:100%;height:auto;">`: '<p>画像を選択してください</p>':b.kind==='button'?`<table role="presentation" cellpadding="0" cellspacing="0" style="margin:${b.align==='left'?'0':b.align==='right'?'0 0 0 auto':'0 auto'};"><tr><td bgcolor="${d.accent}" style="border-radius:6px;text-align:center;"><a href="${url}" style="display:inline-block;padding:16px 24px;color:#ffffff;font-size:18px;font-weight:bold;text-decoration:none;line-height:1.5;">${txt}</a></td></tr></table>`:b.kind==='divider'?'<hr style="border:0;border-top:1px solid #d6d3d1;">':b.kind==='spacer'?'<div style="height:24px;">&nbsp;</div>':b.text;
  const bg=safeUrl(b.backgroundImage??'',true),cssBg=bg.replace(/[()'"\\]/g,c=>'%'+c.charCodeAt(0).toString(16));
  return `<tr class="mail-block-${i}"${b.hideDesktop?' style="display:none;mso-hide:all;"':''}><td${bg?` background="${e(bg)}"`:''} style="padding:${b.padding}px;background-color:${b.background};${bg?`background-image:url('${e(cssBg)}');background-size:cover;background-position:center;`:''}color:${b.color};text-align:${b.align};font-size:${b.size}px;line-height:1.85;">${inside}</td></tr>`;
 }).join('');
 return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><style>@media(max-width:600px){.mail-shell{width:100%!important;}.mail-shell td{overflow-wrap:anywhere;}}${rules}</style></head><body style="margin:0;background:${d.background};font-family:Arial,'Yu Gothic',Meiryo,sans-serif;"><div style="display:none;max-height:0;overflow:hidden;">${e(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${d.background}"><tr><td align="center" style="padding:24px 8px;"><table role="presentation" class="mail-shell" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;">${blocks}</table></td></tr></table></body></html>`;
}
export function auditDocument(d:MailDocument): string[] {
 if(!d.blocks.length)return ['コンテンツを追加してください'];
 if(d.blocks.every(b=>b.hideMobile))return ['モバイルで表示するブロックを1つ以上指定してください'];
 if(d.blocks.every(b=>b.hideDesktop))return ['PCで表示するブロックを1つ以上指定してください'];
 const attr=(tag:string,name:string)=>tag.match(new RegExp('\\s'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'))?.slice(1).find(v=>v!==undefined)??'';
 return d.blocks.flatMap((b,i)=>{
  const issues=[];
  if(['heading','text','richtext','button','html'].includes(b.kind)&&!b.text.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').trim()&&!/<img\b/i.test(b.text))issues.push('内容が空です');
  if(['image','button'].includes(b.kind)&&!safeUrl(b.url,b.kind==='image'))issues.push('有効なURLを指定してください');
  if(b.kind==='image'&&!b.alt.trim())issues.push('代替テキストを入力してください');
  if(b.backgroundImage&&!safeUrl(b.backgroundImage,true))issues.push('背景画像はHTTPSのURLを指定してください');
  if(b.hideMobile&&b.hideDesktop)issues.push('PC・モバイルの両方で非表示になっています');
  if(['html','richtext'].includes(b.kind)){
   for(const tag of b.text.match(/<a\b[^>]*>/gi)??[])if(!safeUrl(attr(tag,'href')))issues.push('本文内のリンク先を確認してください');
   for(const tag of b.text.match(/<img\b[^>]*>/gi)??[]){if(!safeUrl(attr(tag,'src'),true))issues.push('本文内の画像URLを確認してください');if(!attr(tag,'alt').trim())issues.push('本文内の画像に代替テキストを入力してください');}
  }
  return [...new Set(issues)].map(s=>`${i+1}. ${blockLabels[b.kind]}：${s}`);
 });
}
