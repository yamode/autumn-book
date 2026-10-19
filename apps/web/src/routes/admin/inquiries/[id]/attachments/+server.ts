import {json,error} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {inquiryContext,limitedInquiryBytes} from '$lib/server/inquiry-compose';
import {inquiryAttachmentMime,INQUIRY_ATTACHMENT_LIMIT} from '$lib/inquiry-compose';
const reply=(data:unknown,status=200)=>json(data,{status,headers:{'cache-control':'no-store'}});

export const POST:RequestHandler=async event=>{
 const {db,item}=await inquiryContext(event,true);
 const bytes=await limitedInquiryBytes(event.request,INQUIRY_ATTACHMENT_LIMIT+65536);
 let form:FormData;try{form=await new Response(bytes,{headers:{'content-type':event.request.headers.get('content-type')??''}}).formData();}catch{error(400,'添付ファイルを確認してください。');}
 const file=form.get('file'),revision=Number(form.get('revision')),version=Number(form.get('version'));
 if(!(file instanceof File)||!file.size||file.size>INQUIRY_ATTACHMENT_LIMIT||!Number.isInteger(revision)||!Number.isInteger(version))return reply({error:'添付ファイルを確認してください。'},400);
 const filename=file.name.replace(/[\u0000-\u001f\u007f"\\/]/g,'').trim().slice(0,150);
 const mime=inquiryAttachmentMime(filename);if(!mime)return reply({error:'PDF・画像・Excel・Word・CSVを添付してください。'},400);
 const id=crypto.randomUUID(),path=item.id+'/'+id;
 const {error:upload}=await db.storage.from('book-inquiry-files').upload(path,file,{contentType:mime,upsert:false});
 if(upload)return reply({error:'アップロードできませんでした。接続をご確認ください。'},503);
 const {data,error:registration}=await db.schema('book').rpc('admin_inquiry_attachment',{p_id:item.id,p_revision:revision,p_version:version,p_attachment:id,p_filename:filename,p_mime:mime,p_size:file.size});
 if(registration){await db.storage.from('book-inquiry-files').remove([path]);return reply({error:registration.message.includes('draft_conflict')?'他の担当者または新着返信による変更があります。添付は追加されていません。画面を更新してください。':registration.message,conflict:registration.message.includes('draft_conflict')},registration.message.includes('draft_conflict')?409:400);}
 return reply(data);
};
export const DELETE:RequestHandler=async event=>{
 const {db,item}=await inquiryContext(event,true);
 const bytes=await limitedInquiryBytes(event.request,2048);
 let input:{id:string;revision:number;version:number};try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({error:'入力を確認してください。'},400);}
 if(!input||!Number.isInteger(input.revision)||!Number.isInteger(input.version)||typeof input.id!=='string')return reply({error:'入力を確認してください。'},400);
 const {data,error:removed}=await db.schema('book').rpc('admin_inquiry_attachment',{p_id:item.id,p_revision:input.revision,p_version:input.version,p_attachment:input.id,p_remove:true});
 if(removed)return reply({error:removed.message.includes('draft_conflict')?'新着返信または他の担当者の変更があります。画面を更新してください。':'添付を削除できませんでした。',conflict:removed.message.includes('draft_conflict')},409);
 await db.storage.from('book-inquiry-files').remove([data.attachment.storage_path]);
 return reply({revision:data.revision,version:data.version,saved_at:data.saved_at});
};
