import {json,error} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {newsletterContext,campaignInput,auditDocument,newsletterDebug} from '$lib/server/newsletter';
import {newsForm} from '$lib/server/news/editor';
export const POST:RequestHandler=async event=>{
 const {db,facility,tenant}=await newsletterContext(event,true);
 const form=await newsForm(event.request,2*1024*1024);
 if(form.get('facility')!==facility)error(409,'施設が切り替わっています。再読み込みしてください。');
 let data:Record<string,unknown>;try{data=JSON.parse(String(form.get('data')??'{}'));}catch{error(400,'入力を読み取れません。');}
 const action=String(form.get('action'));
 newsletterDebug('action',{action,facility});
 let result;
 try{
  if(action==='save')result=await db.rpc('admin_newsletter_save',{p_facility:facility,p_id:data.id||null,p_revision:Number(data.revision)||0,p_data:campaignInput(data)});
  else if(action==='import')result=await db.rpc('admin_newsletter_import',{p_facility:facility,p_name:String(data.name??''),p_rows:data.rows});
  else if(action==='list')result=await db.rpc('admin_newsletter_list',{p_facility:facility,p_name:String(data.name??''),p_tags:data.tags});
  else if(action==='asset'){
   const kind=String(data.kind??'');
   if(!['template','block','brand'].includes(kind))error(400,'保存する種類を確認してください。');
   const document=kind==='brand'?data.document:campaignInput({document:data.document}).document;
   result=await db.rpc('admin_newsletter_asset',{p_facility:facility,p_kind:kind,p_name:String(data.name??''),p_document:document});
  }
  else if(action==='contact')result=await db.rpc('admin_newsletter_contact',{p_facility:facility,p_id:data.id,p_version:Number(data.version),p_name:String(data.name??''),p_tags:data.tags,p_suppress:data.suppress===true});
  else if(action==='profile')result=await db.rpc('admin_newsletter_profile',{p_facility:facility,p_id:data.id,p_data:data.update??null});
  else if(action==='settings')result=await db.rpc('admin_newsletter_settings',{p_facility:facility,p_data:data});
  else if(action==='count'){
   let query=db.from('newsletter_contacts').select('id',{count:'exact',head:true}).eq('tenant_id',tenant).eq('status','active');
   const tags=Array.isArray(data.tags)?data.tags.map(String).slice(0,100):[];
   if(tags.length)query=query.overlaps('tags',tags);
   const {count,error:e}=await query;
   if(e)throw Error('対象件数を取得できませんでした。');
   return json({data:{count:count??0}});
  }
  else if(action==='test'||action==='schedule'||action==='cancel'){
   const {data:c}=await db.from('newsletter_campaigns').select('*').eq('id',data.id).eq('facility_id',facility).single();
   if(!c||c.revision!==data.revision)error(409,'保存後に内容が変わっています。最新の下書きを確認してください。');
   if(action!=='cancel'&&(!c.subject||!c.from_name||!c.from_email||!c.reply_to||auditDocument(c.document).length))error(400,'件名・差出人・返信先と配信前チェックを確認してください。');
   result=await db.rpc('admin_newsletter_dispatch',{p_facility:facility,p_id:c.id,p_revision:c.revision,p_action:action,p_at:data.scheduled_at||null,p_count:Number(data.count)||0});
  }else error(400,'未対応の操作です。');
 }catch(e){if(e&&typeof e==='object'&&'status' in e)throw e;return json({error:e instanceof Error?e.message:'保存できません。'},{status:400});}
 if(result.error)return json({error:result.error.message.includes('conflict')?'他の画面で変更されています。再読み込みしてください。':result.error.message},{status:409});
 return json({data:result.data});
};
