import {error,type RequestEvent} from '@sveltejs/kit';
import sanitizeHtml from 'sanitize-html';
import {env} from '$env/dynamic/private';
import {ADMIN_SUPABASE,createSupabaseServerClient} from './auth';
import {currentBookFacility} from './partners/staff';
import {FACILITY_UUID} from './supabase-data';
import {normalizeDocument,renderDocument,auditDocument,isRichBlock,type MailDocument} from '$lib/newsletter';
import {audienceFilter} from '$lib/newsletter-audience';
const DEBUG=env.NEWSLETTER_DEBUG==='true';
export function newsletterDebug(action:string,details:Record<string,string|number|boolean>){if(DEBUG)console.info('[newsletter]',action,details);}
export async function newsletterContext(event:RequestEvent,write=false){
 if(!ADMIN_SUPABASE||event.locals.user?.role!=='admin')error(403,'メルマガ管理には管理者権限が必要です。');
 if(write&&event.request.headers.get('origin')!==event.url.origin)error(403,'不正なリクエストです。');
 const facility=FACILITY_UUID[currentBookFacility(event).id],db=createSupabaseServerClient(event).schema('book');
 const {data:tenant,error:e}=await db.rpc('admin_newsletter_context',{p_facility:facility});
 if(e||!tenant)error(403,'施設とテナントの管理権限を確認してください。');
 event.setHeaders({'cache-control':'no-store'});
 return {db,facility,tenant:String(tenant)};
}
// Raw HTML blocks never execute in the administration page. Remove active
// content here as well so downloaded HTML and delivered messages are safe.
export function newsletterHtml(document:MailDocument,preheader:string){
 const cssColor=[/^#[a-f0-9]{3,8}$/i,/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i];
 return sanitizeHtml(renderDocument(document,preheader),{
  allowedTags:['html','head','body','meta','style','table','tbody','tr','td','th','div','span','p','h1','h2','h3','h4','strong','b','em','i','u','s','br','hr','a','img','ul','ol','li','blockquote'],
  allowedAttributes:{'*':['style','class','role','align','valign','width','height','bgcolor','background','cellpadding','cellspacing'],meta:['charset','name','content'],a:['href','title'],img:['src','alt','width','height']},
  allowedSchemes:['https','http','mailto','tel'],allowedSchemesByTag:{img:['https']},allowProtocolRelative:false,
  allowedStyles:{'*':{
   color:cssColor, 'background-color':cssColor,background:cssColor,
   'background-image':[/^url\(['"]https:\/\/[^'"\s<>()\\]+['"]\)$/i],'background-size':[/^cover$/],'background-position':[/^center$/],'mso-hide':[/^all$/],
   'font-family':[/^[\w\s,'"-]+$/], 'font-size':[/^\d+(px|%)$/], 'font-weight':[/^(normal|bold|[1-9]00)$/],
   'line-height':[/^[\d.]+(px|%)?$/], 'text-align':[/^(left|center|right)$/], 'text-decoration':[/^(none|underline|line-through)$/],
   padding:[/^[\d.\s]+(px)?([\s\d.px]+)?$/],'padding-top':[/^\d+px$/],'padding-right':[/^\d+px$/],'padding-bottom':[/^\d+px$/],'padding-left':[/^\d+px$/],margin:[/^[\d.px\sauto-]+$/], 'margin-top':[/^\d+px$/], 'margin-bottom':[/^\d+px$/],
   width:[/^[\d.]+(px|%)$/],'max-width':[/^[\d.]+(px|%)$/],height:[/^(auto|[\d.]+px)$/],'max-height':[/^\d+(px)?$/],
   border:[/^(0|\d+px (solid|dashed) #[a-f0-9]{3,8})$/i],'border-top':[/^\d+px solid #[a-f0-9]{3,8}$/i],
   'border-left':[/^\d+px solid #[a-f0-9]{3,8}$/i],'border-radius':[/^\d+px$/],display:[/^(none|block|inline-block)$/],overflow:[/^hidden$/],
   'letter-spacing':[/^[\d.]+px$/],'vertical-align':[/^(top|middle|bottom)$/]
  }},
  // Only our fixed responsive stylesheet is allowed. User-provided <style>
  // elements are removed from HTML blocks before rendering below.
  allowVulnerableTags:true
 });
}
export function campaignInput(raw:Record<string,unknown>){
 const document=normalizeDocument(raw.document);
 for(const b of document.blocks)if(isRichBlock(b.kind))b.text=sanitizeHtml(b.text,{allowedTags:['table','tbody','tr','td','div','span','p','h1','h2','h3','strong','b','em','i','u','s','blockquote','br','hr','a','img','ul','ol','li'],allowedAttributes:{'*':['style','align','width','cellpadding','cellspacing','bgcolor'],a:['href'],img:['src','alt','width']},allowedSchemes:['https','http','mailto','tel'],allowProtocolRelative:false});
 const subject=String(raw.subject??'').trim(),preheader=String(raw.preheader??'').slice(0,150);
 if(subject.length>200)throw Error('件名は200文字以内で入力してください。');
 const html=newsletterHtml(document,preheader);if(html.length>500000)throw Error('メールの容量が大きすぎます。');
 const text=document.blocks.map(b=>b.kind==='offer'?[b.eyebrow,b.text,b.previousPrice?'通常 '+b.previousPrice+b.priceSuffix:'',b.price!+b.priceSuffix,b.note,b.couponLabel,b.couponCode].filter(Boolean).join('\n'):isRichBlock(b.kind)?[b.eyebrow,b.heading,sanitizeHtml(b.text,{allowedTags:[],allowedAttributes:{}})].filter(Boolean).join('\n'):b.kind==='button'?`${b.text}\n${b.url}`:b.kind==='image'?[b.alt,b.caption,b.link].filter(Boolean).join('\n'):b.text).join('\n\n');
 const email=(value:unknown)=>{const v=String(value??'').trim();if(v&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v))throw Error('メールアドレスを確認してください。');return v;};
 return {name:String(raw.name??'名称未設定').slice(0,200),subject,preheader,document,html,plain_text:text,from_name:String(raw.from_name??'').slice(0,100),from_email:email(raw.from_email),reply_to:email(raw.reply_to),audience_tags:Array.isArray(raw.audience_tags)?raw.audience_tags.map(String).slice(0,100):[],audience_filter:audienceFilter(raw.audience_filter)};
}
export {auditDocument};
