import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient,ADMIN_SUPABASE } from '$lib/server/auth';
import { inquiry } from '$lib/server/inquiries';
import { FACILITY_UUID } from '$lib/server/supabase-data';
export const POST:RequestHandler=async event=>{
 const reply=(data:unknown,status=200)=>json(data,{status,headers:{'cache-control':'no-store'}});
 if(event.request.headers.get('origin')!==event.url.origin)return reply({error:'許可されていないアクセスです。'},403);
 if(!ADMIN_SUPABASE||!['admin','staff'].includes(event.locals.user?.role??''))return reply({error:'ログインし直してください。'},401);
 const reader=event.request.body?.getReader();if(!reader)return reply({error:'本文がありません。'},400);
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>85000){await reader.cancel();return reply({error:'本文が長すぎます。'},413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 let input:{body:string;revision:number;version:number};try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({error:'入力内容を確認してください。'},400);}
 if(!input||typeof input.body!=='string'||input.body.length>20000||!Number.isInteger(input.revision)||!Number.isInteger(input.version))return reply({error:'入力内容を確認してください。'},400);
 try{
  const db=createSupabaseServerClient(event),item=await inquiry(db,event.params.id);
  if(!item||item.facility_id!==FACILITY_UUID['f-nishiwaga'])return reply({error:'お問い合わせが見つかりません。'},404);
  const {data,error}=await db.schema('book').rpc('admin_inquiry_autosave',{p_id:item.id,p_revision:input.revision,p_version:input.version,p_body:input.body});
  if(error)return error.message.includes('draft_conflict')?reply({error:'新着返信または他の担当者の変更があります。本文をコピーし、再読み込みしてご確認ください。',conflict:true},409):reply({error:'保存できませんでした。入力内容を保ったまま再試行してください。'},503);
  return reply(data);
 }catch{return reply({error:'保存できませんでした。接続をご確認ください。'},503);}
};
