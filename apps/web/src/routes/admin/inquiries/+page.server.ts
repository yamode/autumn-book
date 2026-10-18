import type { PageServerLoad } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import type { Inquiry,DraftJob } from '$lib/server/inquiries';
export type InboxItem=Inquiry&{preview:string;inquiry_draft_jobs:DraftJob|null};
export const load:PageServerLoad=async event=>{
 const {currentFacility}=await event.parent();
 const origin=event.url.searchParams.get('origin')==='history'?'history':'current';
 const rawStatus=event.url.searchParams.get('status')??(origin==='history'?'all':'open');
 const status=['open','all','new','working','waiting','done'].includes(rawStatus)?rawStatus:'open';
 const q=(event.url.searchParams.get('q')??'').slice(0,80).replace(/[,()%*|\\]/g,' ').trim();
 const rawPage=Number(event.url.searchParams.get('page')||1),page=Number.isFinite(rawPage)?Math.min(100000,Math.max(1,Math.floor(rawPage))):1;
 const empty={items:[] as InboxItem[],more:false,page,status,origin,q,health:null,counts:{new:0,working:0,waiting:0,done:0}};
 if(currentFacility.id!=='f-nishiwaga')return {...empty,unavailable:'お問い合わせ管理は現在、山人-yamado-で先行運用しています。施設を切り替えてください。'};
 if(!ADMIN_SUPABASE)return {...empty,unavailable:'お問い合わせ管理は本番データ環境で利用できます。'};
 const db=createSupabaseServerClient(event),facility=FACILITY_UUID[currentFacility.id];
 const base=(columns:string,head=false)=>{
  let query=db.schema('book').from('inquiries').select(columns,{head,count:head?'exact':undefined}).eq('facility_id',facility);
  query=origin==='history'?query.contains('profile',{history_account:'info@yamado.co.jp'}):query.is('profile->>history_account',null);
  return query;
 };
 let query=base('id,name,email,subject,status,assignee,updated_at,profile,draft_origin,draft_updated_at,inquiry_draft_jobs(state,error,updated_at),inquiry_messages(body,created_at)');
 if(status==='open')query=query.in('status',['new','working','waiting']);else if(status!=='all')query=query.eq('status',status);
 if(q)query=query.or('name.ilike.%'+q+'%,email.ilike.%'+q+'%,subject.ilike.%'+q+'%');
 const [rows,health,...stats]=await Promise.all([
  query.eq('inquiry_messages.direction','in').order('created_at',{referencedTable:'inquiry_messages',ascending:false}).limit(1,{referencedTable:'inquiry_messages'}).order('updated_at',{ascending:false}).order('id').range((page-1)*50,page*50),
  db.schema('book').rpc('admin_inquiry_sync_health',{p_facility:facility}),
  ...['new','working','waiting','done'].map(state=>base('id',true).eq('status',state))
 ]);
 const counts=Object.fromEntries(['new','working','waiting','done'].map((state,i)=>[state,stats[i]?.count??0])) as typeof empty.counts;
 const items=(rows.data??[]).slice(0,50).map(row=>{const {inquiry_messages,...rest}=row as unknown as Record<string,unknown>;return {...rest,preview:((inquiry_messages as {body:string}[]|null)?.[0]?.body??'').replace(/\s+/g,' ').slice(0,130)};}) as InboxItem[];
 return {...empty,items,more:(rows.data?.length??0)>50,counts,health:health.data as {last_sync_at:string|null;last_error:string|null}|null,unavailable:rows.error?'お問い合わせを読み込めませんでした。時間をおいて再読み込みしてください。':null};
};