// Email-safe document model. The browser previews it; the server sanitizes it before saving.
export type BlockKind='heading'|'text'|'richtext'|'image'|'imageText'|'offer'|'callout'|'button'|'divider'|'spacer'|'html';
export type FontFamily='sans'|'serif'|'mono';
export const fontStacks:Record<FontFamily,string>={sans:"Arial,'Yu Gothic',Meiryo,sans-serif",serif:"'Yu Mincho','Hiragino Mincho ProN',Georgia,serif",mono:'Consolas,monospace'};
export type MailBlock={
 id:string;kind:BlockKind;text:string;url:string;alt:string;color:string;background:string;
 align:'left'|'center'|'right';padding:number;size:number;
 label?:string;font?:FontFamily;lineHeight?:number;letterSpacing?:number;
 paddingTop?:number;paddingRight?:number;paddingBottom?:number;paddingLeft?:number;
 backgroundImage?:string;mobileSize?:number;mobilePadding?:number;hideMobile?:boolean;hideDesktop?:boolean;
 imageWidth?:number;link?:string;caption?:string;imagePosition?:'left'|'right';columnGap?:number;
 eyebrow?:string;eyebrowColor?:string;heading?:string;headingSize?:number;boxColor?:string;borderColor?:string;
 previousPrice?:string;price?:string;priceSuffix?:string;note?:string;couponCode?:string;couponLabel?:string;
 buttonColor?:string;buttonTextColor?:string;buttonRadius?:number;buttonPaddingX?:number;buttonPaddingY?:number;buttonWidth?:'auto'|'full';
 dividerColor?:string;dividerWidth?:number;dividerThickness?:number;height?:number;
};
export type MailDocument={background:string;accent:string;blocks:MailBlock[]};
export const blockLabels:Record<BlockKind,string>={heading:'見出し',text:'テキスト',richtext:'リッチテキスト',image:'画像',imageText:'画像＋本文',offer:'価格・クーポン',callout:'特典・囲み枠',button:'ボタン',divider:'区切り線',spacer:'余白',html:'HTML'};
export function newBlock(kind:BlockKind):MailBlock{
 return {id:crypto.randomUUID(),kind,text:kind==='heading'?'新しいお知らせ':kind==='button'?'詳しく見る':kind==='text'?'ここに本文を入力してください。':['richtext','imageText','callout'].includes(kind)?'<p>ここに本文を入力してください。</p>':kind==='offer'?'早期予約のご案内':'',url:'',alt:'',color:'#292524',background:'#ffffff',align:['heading','button','offer','image'].includes(kind)?'center':'left',padding:24,size:kind==='heading'?28:16,font:'sans',lineHeight:1.85,imagePosition:'left',columnGap:20,boxColor:kind==='offer'?'#fbf6ed':'#f6f6f2',borderColor:'#b28a4c',eyebrow:kind==='offer'?'EARLY RESERVATION':'',priceSuffix:'円',couponLabel:'ご注文時にクーポンコードをご入力ください',headingSize:22};
}
export const emptyDocument=():MailDocument=>({background:'#f5f5f4',accent:'#8b282e',blocks:[newBlock('heading'),newBlock('text'),newBlock('button')]});
export const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function safeUrl(value:string,image=false):string{try{const u=new URL(value);return (image?u.protocol==='https:':['https:','http:','mailto:','tel:'].includes(u.protocol))?u.href:'';}catch{return '';}}
const color=(value:unknown,fallback:string)=>/^#[0-9a-f]{6}$/i.test(String(value))?String(value):fallback;
const number=(value:unknown,min:number,max:number,fallback:number)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Number(value))):fallback;
const optionalNumber=(value:unknown,min:number,max:number)=>value===undefined||value===null||value===''?undefined:number(value,min,max,min);
const text=(value:unknown,max=2000)=>String(value??'').slice(0,max);
export function normalizeDocument(input:unknown):MailDocument{
 const d=input as Partial<MailDocument>|null;
 if(!d||!Array.isArray(d.blocks)||d.blocks.length>100)throw Error('ブロックは100個以内で作成してください。');
 const ids=d.blocks.map(b=>text(b?.id,80));
 if(ids.some(id=>!id)||new Set(ids).size!==ids.length)throw Error('ブロックの識別情報が重複しています。');
 return {background:color(d.background,'#f5f5f4'),accent:color(d.accent,'#8b282e'),blocks:d.blocks.map((b,i)=>{
  if(!b||!Object.hasOwn(blockLabels,b.kind))throw Error('未対応のブロックです。');
  return {id:ids[i],kind:b.kind,text:text(b.text,50000),url:text(b.url),alt:text(b.alt,300),label:text(b.label,100),color:color(b.color,'#292524'),background:color(b.background,'#ffffff'),align:['left','center','right'].includes(b.align)?b.align:'left',padding:number(b.padding,0,96,24),size:number(b.size,14,48,16),font:b.font&&Object.hasOwn(fontStacks,b.font)?b.font:'sans',lineHeight:number(b.lineHeight,1,3,1.85),letterSpacing:number(b.letterSpacing,0,8,0),
   paddingTop:optionalNumber(b.paddingTop,0,96),paddingRight:optionalNumber(b.paddingRight,0,96),paddingBottom:optionalNumber(b.paddingBottom,0,96),paddingLeft:optionalNumber(b.paddingLeft,0,96),
   backgroundImage:text(b.backgroundImage),mobileSize:optionalNumber(b.mobileSize,14,48),mobilePadding:optionalNumber(b.mobilePadding,0,96),hideMobile:b.hideMobile===true,hideDesktop:b.hideDesktop===true,
   imageWidth:number(b.imageWidth,0,600,0),link:text(b.link),caption:text(b.caption,1000),imagePosition:b.imagePosition==='right'?'right':'left',columnGap:number(b.columnGap,0,64,20),
   eyebrow:text(b.eyebrow,200),eyebrowColor:color(b.eyebrowColor,'#8b633d'),heading:text(b.heading,500),headingSize:number(b.headingSize,14,40,22),boxColor:color(b.boxColor,b.kind==='offer'?'#fbf6ed':'#f6f6f2'),borderColor:color(b.borderColor,'#b28a4c'),
   previousPrice:text(b.previousPrice,100),price:text(b.price,100),priceSuffix:text(b.priceSuffix??'円',30),note:text(b.note,1000),couponCode:text(b.couponCode,100),couponLabel:text(b.couponLabel,300),
   buttonColor:b.buttonColor?color(b.buttonColor,'#8b282e'):undefined,buttonTextColor:color(b.buttonTextColor,'#ffffff'),buttonRadius:number(b.buttonRadius,0,32,6),buttonPaddingX:number(b.buttonPaddingX,8,64,24),buttonPaddingY:number(b.buttonPaddingY,8,48,16),buttonWidth:b.buttonWidth==='full'?'full':'auto',
   dividerColor:color(b.dividerColor,'#d6d3d1'),dividerWidth:number(b.dividerWidth,0,600,0),dividerThickness:number(b.dividerThickness,1,8,1),height:number(b.height,4,160,24)
  };
 })};
}
const richKinds:BlockKind[]=['richtext','html','imageText','callout'];
export const isRichBlock=(kind:BlockKind)=>richKinds.includes(kind);
export function renderDocument(input:MailDocument,preheader=''):string{
 const d=normalizeDocument(input),e=escapeHtml;
 const rules=d.blocks.map((b,i)=>`${b.hideDesktop?`.mail-block-${i}{display:none;mso-hide:all;}`:''}@media(max-width:600px){.mail-block-${i}{display:${b.hideMobile?'none':'table-row'}!important;}.mail-block-${i}>td{${b.mobilePadding!==undefined?`padding:${b.mobilePadding}px!important;`:''}${b.mobileSize!==undefined?`font-size:${b.mobileSize}px!important;`:''}}${b.mobileSize!==undefined?`.mail-block-${i}>td h2,.mail-block-${i} .mail-copy{font-size:${b.mobileSize}px!important;}`:''}}`).join('');
 const margin=(align:MailBlock['align'])=>align==='left'?'0':align==='right'?'0 0 0 auto':'0 auto';
 const blocks=d.blocks.map((b,i)=>{
  const top=b.paddingTop??b.padding,right=b.paddingRight??b.padding,bottom=b.paddingBottom??b.padding,left=b.paddingLeft??b.padding;
  const innerWidth=Math.max(100,600-left-right),txt=e(b.text).replace(/\n/g,'<br>');
  const img=(width:number)=>{
   const src=e(safeUrl(b.url,true)),w=Math.min(width,b.imageWidth||width);
   const image=src?`<img src="${src}" alt="${e(b.alt)}" width="${w}" style="display:block;border:0;width:100%;max-width:${w}px;height:auto;margin:${margin(b.align)};">`:'<p>画像を選択してください</p>';
   return b.link&&safeUrl(b.link)?`<a href="${e(safeUrl(b.link))}" style="display:block;text-decoration:none;">${image}</a>`:image;
  };
  let inside='';
  switch(b.kind){
   case 'heading':inside=`<h2 style="font-family:${fontStacks[b.font!]};font-size:${b.size}px;line-height:${b.lineHeight};font-weight:bold;margin:0;">${txt}</h2>`;break;
   case 'text':inside=`<div class="mail-copy" style="font-size:${b.size}px;line-height:${b.lineHeight};">${txt}</div>`;break;
   case 'richtext':case 'html':inside=b.text;break;
   case 'image':inside=img(innerWidth)+(b.caption?`<p style="font-size:14px;line-height:1.7;margin:16px 0 0;">${e(b.caption).replace(/\n/g,'<br>')}</p>`:'');break;
   case 'imageText':{
    const width=Math.floor((innerWidth-b.columnGap!)/2),content=`${b.eyebrow?`<div style="font-size:14px;letter-spacing:2px;color:${b.eyebrowColor};margin-bottom:8px;">${e(b.eyebrow)}</div>`:''}${b.heading?`<h2 style="font-size:${b.headingSize}px;line-height:1.6;margin:0 0 16px;font-family:${fontStacks[b.font!]};">${e(b.heading).replace(/\n/g,'<br>')}</h2>`:''}${b.text}`;
    const imageCell=`<td class="mail-column" width="${width}" valign="top" style="width:${width}px;vertical-align:top;">${img(width)}</td>`,textCell=`<td class="mail-column mail-copy" width="${width}" valign="top" style="width:${width}px;vertical-align:top;font-size:${b.size}px;line-height:${b.lineHeight};">${content}</td>`,gap=`<td class="mail-gap" width="${b.columnGap}" style="width:${b.columnGap}px;">&nbsp;</td>`;
    inside=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="mail-stack"><tr>${b.imagePosition==='right'?textCell+gap+imageCell:imageCell+gap+textCell}</tr></table>`;break;
   }
   case 'offer':inside=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${b.borderColor};background-color:${b.boxColor};"><tr><td style="padding:24px 18px;text-align:center;">${b.eyebrow?`<div style="font-size:14px;font-weight:bold;letter-spacing:2px;color:${b.eyebrowColor};">${e(b.eyebrow)}</div>`:''}<div style="font-size:20px;font-weight:bold;color:${b.color};margin:8px 0 16px;">${txt}</div>${b.previousPrice?`<div style="font-size:16px;color:#665b50;">通常 <span style="text-decoration:line-through;">${e(b.previousPrice)}${e(b.priceSuffix!)}</span></div>`:''}<div style="font-size:32px;line-height:1.5;font-weight:bold;color:${b.color};">${e(b.price!)}<span style="font-size:20px;">${e(b.priceSuffix!)}</span></div>${b.note?`<div style="font-size:14px;color:#665b50;">${e(b.note).replace(/\n/g,'<br>')}</div>`:''}${b.couponCode?`<div style="margin:18px 0 8px;font-size:14px;">${e(b.couponLabel!)}</div><div style="font-family:Consolas,monospace;font-size:22px;letter-spacing:3px;font-weight:bold;color:#392c27;background-color:#ffffff;border:1px dashed ${b.borderColor};padding:10px;">${e(b.couponCode)}</div>`:''}</td></tr></table>`;break;
   case 'callout':inside=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:4px solid ${b.borderColor};background-color:${b.boxColor};"><tr><td style="padding:16px 18px;font-size:${b.size}px;line-height:${b.lineHeight};">${b.text}</td></tr></table>`;break;
   case 'button':inside=`<table role="presentation" ${b.buttonWidth==='full'?'width="100%"':''} cellpadding="0" cellspacing="0" style="margin:${margin(b.align)};"><tr><td bgcolor="${b.buttonColor??d.accent}" style="border-radius:${b.buttonRadius}px;text-align:center;"><a href="${e(safeUrl(b.url))}" style="display:block;padding:${b.buttonPaddingY}px ${b.buttonPaddingX}px;color:${b.buttonTextColor};font-family:${fontStacks[b.font!]};font-size:${b.size}px;font-weight:bold;text-decoration:none;line-height:1.5;">${txt}</a></td></tr></table>`;break;
   case 'divider':inside=`<table role="presentation" width="${b.dividerWidth||'100%'}" cellpadding="0" cellspacing="0" style="max-width:100%;margin:${margin(b.align)};border-top:${b.dividerThickness}px solid ${b.dividerColor};"><tr><td style="font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`;break;
   case 'spacer':inside=`<div style="height:${b.height}px;">&nbsp;</div>`;break;
  }
  const bg=safeUrl(b.backgroundImage??'',true),cssBg=bg.replace(/[()'"\\]/g,c=>'%'+c.charCodeAt(0).toString(16));
  return `<tr class="mail-block-${i}" data-mail-block="${e(b.id)}"${b.hideDesktop?' style="display:none;mso-hide:all;"':''}><td align="${b.align}" style="padding:${top}px ${right}px ${bottom}px ${left}px;background-color:${b.background};${bg?`background-image:url('${e(cssBg)}');background-size:cover;background-position:center;`:''}color:${b.color};font-family:${fontStacks[b.font!]};text-align:${b.align};font-size:${b.size}px;line-height:${b.lineHeight};letter-spacing:${b.letterSpacing}px;">${inside}</td></tr>`;
 }).join('');
 return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><style>p{margin:0 0 16px;}p:last-child{margin-bottom:0;}@media(max-width:600px){.mail-shell{width:100%!important;}.mail-shell td{overflow-wrap:anywhere;}.mail-stack .mail-column{display:block!important;width:100%!important;box-sizing:border-box!important;}.mail-stack .mail-gap{display:block!important;width:100%!important;height:18px!important;}}${rules}</style></head><body style="margin:0;background:${d.background};font-family:${fontStacks.sans};"><div style="display:none;max-height:0;overflow:hidden;">${e(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${d.background}"><tr><td align="center" style="padding:24px 8px;"><table role="presentation" class="mail-shell" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;">${blocks}</table></td></tr></table></body></html>`;
}
export function auditDocument(d:MailDocument):string[]{
 if(!d.blocks.length)return ['コンテンツを追加してください'];
 if(d.blocks.every(b=>b.hideMobile))return ['モバイルで表示するブロックを1つ以上指定してください'];
 if(d.blocks.every(b=>b.hideDesktop))return ['PCで表示するブロックを1つ以上指定してください'];
 const attr=(tag:string,name:string)=>tag.match(new RegExp('\\s'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i'))?.slice(1).find(v=>v!==undefined)??'';
 return d.blocks.flatMap((b,i)=>{
  const issues=[];
  if(['heading','text','richtext','imageText','callout','button','html','offer'].includes(b.kind)&&!b.text.replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').trim()&&!/<img\b/i.test(b.text))issues.push('内容が空です');
  if(['image','imageText','button'].includes(b.kind)&&!safeUrl(b.url,b.kind!=='button'))issues.push('有効なURLを指定してください');
  if(['image','imageText'].includes(b.kind)&&!b.alt.trim())issues.push('代替テキストを入力してください');
  if(b.link&&!safeUrl(b.link))issues.push('画像のリンク先を確認してください');
  if(b.backgroundImage&&!safeUrl(b.backgroundImage,true))issues.push('背景画像はHTTPSのURLを指定してください');
  if(b.hideMobile&&b.hideDesktop)issues.push('PC・モバイルの両方で非表示になっています');
  if(b.kind==='offer'&&!b.price?.trim())issues.push('販売価格を入力してください');
  if(isRichBlock(b.kind)){
   for(const tag of b.text.match(/<a\b[^>]*>/gi)??[])if(!safeUrl(attr(tag,'href')))issues.push('本文内のリンク先を確認してください');
   for(const tag of b.text.match(/<img\b[^>]*>/gi)??[]){if(!safeUrl(attr(tag,'src'),true))issues.push('本文内の画像URLを確認してください');if(!attr(tag,'alt').trim())issues.push('本文内の画像に代替テキストを入力してください');}
  }
  return [...new Set(issues)].map(s=>`${i+1}. ${blockLabels[b.kind]}：${s}`);
 });
}
