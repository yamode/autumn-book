import {error,type RequestEvent} from '@sveltejs/kit';
import sanitizeHtml from 'sanitize-html';
import {env} from '$env/dynamic/private';
import {ADMIN_SUPABASE,createSupabaseServerClient} from './auth';
import {currentBookFacility} from './partners/staff';
import {FACILITY_UUID} from './supabase-data';
import {normalizeDocument,renderDocument,auditDocument,type MailDocument} from '$lib/newsletter';
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
 return sanitizeHtml(renderDocument(document,preheader),{
  allowedTags:['html','head','body','meta','style','table','tbody','tr','td','th','div','span','p','h1','h2','h3','h4','strong','b','em','i','u','s','br','hr','a','img','ul','ol','li','blockquote'],
  allowedAttributes:{'*':['style','class','role','align','width','height','bgcolor','cellpadding','cellspacing'],meta:['charset','name','content'],a:['href','title'],img:['src','alt','width','height']},
  allowedSchemes:['https','http','mailto','tel'],allowedSchemesByTag:{img:['https']},allowProtocolRelative:false,
  allowedStyles:{'*':{
   color:[/^#[a-f0-9]{3,8}$/i], 'background-color':[/^#[a-f0-9]{3,8}$/i],background:[/^#[a-f0-9]{3,8}$/i],
   'font-family':[/^[\w\s,'"-]+$/], 'font-size':[/^\d+(px|%)$/], 'font-weight':[/^(normal|bold|[1-9]00)$/],
   'line-height':[/^[\d.]+(px|%)?$/], 'text-align':[/^(left|center|right)$/], 'text-decoration':[/^(none|underline|line-through)$/],
   padding:[/^[\d.\s]+(px)?([\s\d.px]+)?$/],margin:[/^[\d.px\sauto-]+$/], 'margin-top':[/^\d+px$/], 'margin-bottom':[/^\d+px$/],
   width:[/^[\d.]+(px|%)$/],'max-width':[/^[\d.]+(px|%)$/],height:[/^(auto|[\d.]+px)$/],'max-height':[/^\d+(px)?$/],
   border:[/^(0|\d+px (solid|dashed) #[a-f0-9]{3,8})$/i],'border-top':[/^\d+px solid #[a-f0-9]{3,8}$/i],
   'border-left':[/^\d+px solid #[a-f0-9]{3,8}$/i],'border-radius':[/^\d+px$/],display:[/^(none|block|inline-block)$/],overflow:[/^hidden$/],
   'letter-spacing':[/^\d+px$/]
  }},
  // Only our fixed responsive stylesheet is allowed. User-provided <style>
  // elements are removed from HTML blocks before rendering below.
  allowVulnerableTags:true
 });
}
export function campaignInput(raw:Record<string,unknown>){
 const document=normalizeDocument(raw.document);
 for(const b of document.blocks)if(['html','richtext'].includes(b.kind))b.text=sanitizeHtml(b.text,{allowedTags:['table','tbody','tr','td','div','span','p','h1','h2','h3','strong','b','em','i','u','s','blockquote','br','hr','a','img','ul','ol','li'],allowedAttributes:{'*':['style','align','width','cellpadding','cellspacing','bgcolor'],a:['href'],img:['src','alt','width']},allowedSchemes:['https','http','mailto','tel'],allowProtocolRelative:false});
 const subject=String(raw.subject??'').trim(),preheader=String(raw.preheader??'').slice(0,150);
 if(subject.length>200)throw Error('件名は200文字以内で入力してください。');
 const html=newsletterHtml(document,preheader);if(html.length>500000)throw Error('メールの容量が大きすぎます。');
 const text=document.blocks.map(b=>['html','richtext'].includes(b.kind)?sanitizeHtml(b.text,{allowedTags:[],allowedAttributes:{}}):b.kind==='button'?`${b.text}\n${b.url}`:b.kind==='image'?b.alt:b.text).join('\n\n');
 const email=(value:unknown)=>{const v=String(value??'').trim();if(v&&!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v))throw Error('メールアドレスを確認してください。');return v;};
 return {name:String(raw.name??'名称未設定').slice(0,200),subject,preheader,document,html,plain_text:text,from_name:String(raw.from_name??'').slice(0,100),from_email:email(raw.from_email),reply_to:email(raw.reply_to),audience_tags:Array.isArray(raw.audience_tags)?raw.audience_tags.map(String).slice(0,100):[]};
}
export {auditDocument};
