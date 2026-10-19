import {error} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {inquiryContext} from '$lib/server/inquiry-compose';
export const GET:RequestHandler=async event=>{
 const {db,item}=await inquiryContext(event);
 const {data:file,error:missing}=await db.schema('book').from('inquiry_attachments').select('filename,mime_type,storage_path').eq('id',event.params.attachmentId).eq('inquiry_id',item.id).maybeSingle();
 if(missing||!file)error(404,'添付ファイルが見つかりません。');
 const {data:blob,error:download}=await db.storage.from('book-inquiry-files').download(file.storage_path);
 if(download||!blob)error(503,'添付ファイルを取得できません。');
 const filename=encodeURIComponent(file.filename).replace(/['()*]/g,(c)=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 return new Response(blob,{headers:{'content-type':'application/octet-stream','content-disposition':`attachment; filename="attachment"; filename*=UTF-8''${filename}`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
};
