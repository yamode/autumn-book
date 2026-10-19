import {json} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {createSupabaseServerClient,ADMIN_SUPABASE} from '$lib/server/auth';
export const POST:RequestHandler=async event=>{
 const reply=(data:unknown,status=200)=>json(data,{status,headers:{'cache-control':'no-store'}});
 if(event.request.headers.get('origin')!==event.url.origin)return reply({error:'許可されていないアクセスです。'},403);
 if(!ADMIN_SUPABASE||!['admin','staff'].includes(event.locals.user?.role??''))return reply({error:'ログインし直してください。'},401);
 const reader=event.request.body?.getReader();if(!reader)return reply({error:'入力内容を確認してください。'},400);
 let text='',size=0;const decoder=new TextDecoder();while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply({error:'入力内容を確認してください。'},413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
 let input:{target:string;version?:number};try{input=JSON.parse(text);}catch{return reply({error:'入力内容を確認してください。'},400);}
 if(!input||typeof input.target!=='string'||(input.target!=='draft'&&!/^[a-f0-9-]{36}$/i.test(input.target)))return reply({error:'入力内容を確認してください。'},400);
 try{
  const db=createSupabaseServerClient(event);
  const {data,error}=await db.functions.invoke('translate-inquiry',{body:{id:event.params.id,target:input.target,version:input.version}});
  if(error){let message='翻訳できませんでした。時間をおいて再度お試しください。';try{const result=await error.context?.json();if(typeof result?.error==='string')message=result.error;}catch{}return reply({error:message},503);}
  return reply(data);
 }catch{return reply({error:'翻訳できませんでした。接続をご確認ください。'},503);}
};
