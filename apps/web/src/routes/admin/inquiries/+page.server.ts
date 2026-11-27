import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import { inquiry, type Inquiry,type DraftJob } from '$lib/server/inquiries';
import { STATES } from '$lib/inquiries';
export type InboxItem=Inquiry&{preview:string;inquiry_draft_jobs:DraftJob|null};
export const load:PageServerLoad=async event=>{
 const {currentFacility}=await event.parent();
 const origin=event.url.searchParams.get('origin')==='history'?'history':'current';
 const rawStatus=event.url.searchParams.get('status')??(origin==='history'?'all':'open');
 const status=['open','all','new','working','waiting','done','no_action'].includes(rawStatus)?rawStatus:'open';
 const q=(event.url.searchParams.get('q')??'').slice(0,80).replace(/[,()%*|\\]/g,' ').trim();
 const rawPage=Number(event.url.searchParams.get('page')||1),page=Number.isFinite(rawPage)?Math.min(100000,Math.max(1,Math.floor(rawPage))):1;
 const empty={items:[] as InboxItem[],more:false,page,status,origin,q,health:null,counts:{new:0,working:0,waiting:0,done:0,no_action:0}};
 if(currentFacility.id!=='f-nishiwaga')return {...empty,unavailable:'お問い合わせ管理は現在、山人-yamado-で先行運用しています。施設を切り替えてください。'};
 if(!ADMIN_SUPABASE)return {...empty,unavailable:'お問い合わせ管理は本番データ環境で利用できます。'};
 const db=createSupabaseServerClient(event),facility=FACILITY_UUID[currentFacility.id];
 const base=(columns:string,head=false)=>{
  let query=db.schema('book').from('inquiries').select(columns,{head,count:head?'exact':undefined}).eq('facility_id',facility);
  query=origin==='history'?query.contains('profile',{history_account:'info@yamado.co.jp'}):query.is('profile->>history_account',null);
  return query;
 };
 let query=base('id,name,email,subject,status,assignee,revision,updated_at,profile,draft_origin,draft_updated_at,inquiry_draft_jobs(state,error,updated_at),inquiry_messages(body,created_at)');
 if(status==='open')query=query.in('status',['new','working','waiting']);else if(status!=='all')query=query.eq('status',status);
 if(q)query=query.or('name.ilike.%'+q+'%,email.ilike.%'+q+'%,subject.ilike.%'+q+'%');
 const [rows,health,...stats]=await Promise.all([
  query.eq('inquiry_messages.direction','in').order('created_at',{referencedTable:'inquiry_messages',ascending:false}).limit(1,{referencedTable:'inquiry_messages'}).order('updated_at',{ascending:false}).order('id').range((page-1)*50,page*50),
  db.schema('book').rpc('admin_inquiry_sync_health',{p_facility:facility}),
  ...['new','working','waiting','done','no_action'].map(state=>base('id',true).eq('status',state))
 ]);
 const counts=Object.fromEntries(['new','working','waiting','done','no_action'].map((state,i)=>[state,stats[i]?.count??0])) as typeof empty.counts;
 const items=(rows.data??[]).slice(0,50).map(row=>{const {inquiry_messages,...rest}=row as unknown as Record<string,unknown>;return {...rest,preview:((inquiry_messages as {body:string}[]|null)?.[0]?.body??'').replace(/\s+/g,' ').slice(0,130)};}) as InboxItem[];
 return {...empty,items,more:(rows.data?.length??0)>50,counts,health:health.data as {last_sync_at:string|null;last_error:string|null}|null,unavailable:rows.error?'お問い合わせを読み込めませんでした。時間をおいて再読み込みしてください。':null};
};

// 一覧から対応状況を変える（2026-11-27）。詳細画面の「状況」と同じ DB 関数（admin_inquiry_edit の status）で、
// 状況と担当者だけを書き換える（下書き・本文には触らない）。担当者は今の値をそのまま渡す（空で送ると外れてしまう）。
// 一覧を開いたあとに返信が届いた・ほかの担当者が変えた場合は revision が合わず止まるので、読み直してもらう。
export const actions:Actions={
 status:async event=>{
  if(!ADMIN_SUPABASE||!['admin','staff'].includes(event.locals.user?.role??''))return fail(403,{message:'スタッフとしてログインしてください。'});
  const form=await event.request.formData();
  const id=String(form.get('id')??''),status=String(form.get('status')??''),revision=Number(form.get('revision'));
  if(!STATES[status]||!/^[0-9a-f-]{36}$/i.test(id)||!Number.isInteger(revision))return fail(400,{message:'対応状況を変えられませんでした。再読み込みしてください。'});
  const db=createSupabaseServerClient(event),item=await inquiry(db,id);
  if(!item||item.facility_id!==FACILITY_UUID['f-nishiwaga'])return fail(404,{message:'お問い合わせが見つかりません。'});
  if(item.revision!==revision)return fail(409,{id,message:'新しい返信または他の担当者の変更があったため、変えていません。一覧を読み直しました。'});
  if(item.status===status)return {id,message:'対応状況は「'+STATES[status]+'」のままです。'};
  const {error:e}=await db.schema('book').rpc('admin_inquiry_edit',{p_id:item.id,p_revision:revision,p_action:'status',p_status:status,p_assignee:item.assignee??''});
  if(e)return fail(e.message.startsWith('conflict')?409:500,{id,message:e.message.startsWith('conflict')?'新しい返信または他の担当者の変更があったため、変えていません。一覧を読み直しました。':'対応状況を変えられませんでした。時間をおいてお試しください。'});
  return {id,message:'「'+(item.subject||'お問い合わせ')+'」を「'+STATES[status]+'」にしました。'};
 }
};
