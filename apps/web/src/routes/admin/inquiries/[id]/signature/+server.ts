import {json} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {inquiryContext,limitedInquiryBytes} from '$lib/server/inquiry-compose';
export const POST:RequestHandler=async event=>{
 const {db,item}=await inquiryContext(event,true);
 const bytes=await limitedInquiryBytes(event.request,16000);
 let input:{template:string;version:number};try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return json({error:'入力を確認してください。'},{status:400});}
 if(!input||typeof input.template!=='string'||!Number.isInteger(input.version)||input.template.length>3000||!input.template.includes('{担当者名}'))return json({error:'3,000文字以内で、{担当者名}を含む署名を入力してください。'},{status:400});
 const {data,error:save}=await db.schema('book').rpc('admin_inquiry_signature',{p_facility:item.facility_id,p_version:input.version,p_template:input.template});
 if(save)return json({error:save.message.includes('signature_conflict')?'署名テンプレートが他の担当者に更新されました。内容を控えて画面を更新してください。':'署名を保存できませんでした。'},{status:409});
 return json(data,{headers:{'cache-control':'no-store'}});
};
