import {json} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {ADMIN_SUPABASE,createSupabaseServerClient} from '$lib/server/auth';
import {inquiry} from '$lib/server/inquiries';
import {FACILITY_UUID} from '$lib/server/supabase-data';
export const POST:RequestHandler=async event=>{
 const reply=(value:unknown,status=200)=>json(value,{status,headers:{'cache-control':'no-store'}});
 if(event.request.headers.get('origin')!==event.url.origin)return reply({error:'許可されていないアクセスです。'},403);
 if(!ADMIN_SUPABASE||!['admin','staff'].includes(event.locals.user?.role??''))return reply({error:'スタッフとしてログインしてください。'},403);
 const reader=event.request.body?.getReader();if(!reader)return reply({error:'入力内容を確認してください。'},400);
 let raw='',size=0;const decoder=new TextDecoder();
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply({error:'入力内容が大きすぎます。'},413);}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
 let input:{action:string;query?:string;group?:string};try{input=JSON.parse(raw);}catch{return reply({error:'入力内容を確認してください。'},400);}
 if(!input||!['search','link','copy'].includes(input.action)||input.query!==undefined&&(typeof input.query!=='string'||input.query.length>100)||input.action!=='search'&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(input.group??''))return reply({error:'予約と検索条件を確認してください。'},400);
 try{
  const db=createSupabaseServerClient(event),item=await inquiry(db,event.params.id);
  if(!item||item.facility_id!==FACILITY_UUID['f-nishiwaga'])return reply({error:'お問い合わせが見つかりません。'},404);
  const args=input.action==='search'?{p_id:item.id,p_query:input.query??''}:{p_id:item.id,p_group:input.group};
  const {data,error}=await db.schema('book').rpc('admin_inquiry_pms_'+input.action,args);
  if(error)return reply({error:'予約との連携を保存できませんでした。施設・権限を確認し、再度お試しください。'},409);
  return reply({data});
 }catch{return reply({error:'予約との連携を処理できませんでした。'},503);}
};
