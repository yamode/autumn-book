export type NewsImageSize = 'small' | 'medium' | 'large';
export const NEWS_IMAGE_SIZES = [{value:'small',label:'小'},{value:'medium',label:'中'},{value:'large',label:'大'}] as const;
export function newsImageSize(value:unknown):NewsImageSize{return value==='small'||value==='medium'?value:'large';}
export function cleanImageCaption(value:string):string{return Array.from(value.replace(/[\r\n]+/g,' ').trim()).slice(0,300).join('').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,'\uFFFD');}
export function imageTitle(size:NewsImageSize,caption:string):string{return 'news-image:'+size+':'+encodeURIComponent(cleanImageCaption(caption));}
export function parseImageTitle(title:string):{size:NewsImageSize;caption:string}|null{
 const match=/^news-image:(small|medium|large):([^\s]*)$/.exec(title);if(!match)return null;
 try{return {size:newsImageSize(match[1]),caption:cleanImageCaption(decodeURIComponent(match[2]))};}catch{return null;}
}
export function imageMarkdown(src:string,alt:string,size:NewsImageSize='large',caption='',title=''):string{
 const escapedAlt=alt.replace(/\\/g,'\\\\').replace(/[\[\]]/g,'\\$&').replace(/[\r\n]+/g,' ');
 const metadata=size!=='large'||caption?imageTitle(size,caption):title;
 return '!['+escapedAlt+']('+src.replace(/[\s()<>]/g,c=>encodeURIComponent(c))+(metadata?' "'+metadata.replace(/"/g,'&quot;')+'"':'')+')';
}
export function escapeImageText(text:string):string{return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
export function selectedMarkdownImage(source:string,start:number,end:number){
 const pattern=/!\[((?:\\.|[^\\\]])*)\]\((\S+?)(?:\s+"([^"]*)")?\)/g;
 for(const match of source.matchAll(pattern)){const from=match.index!,to=from+match[0].length;if(start<from||end>to)continue;const meta=parseImageTitle(match[3]||'');return {start:from,end:to,src:match[2],alt:match[1].replace(/\\([\\\[\]])/g,'$1'),size:meta?.size??'large' as NewsImageSize,caption:meta?.caption??'',title:meta?'':match[3]||''};}
 return null;
}
