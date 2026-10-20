import type {PageServerLoad} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
export const load:PageServerLoad=async event=>{
 const {db,tenant,facility}=await newsletterContext(event),q=(event.url.searchParams.get('q')??'').slice(0,100),status=event.url.searchParams.get('status')??'',page=Math.max(1,Math.min(100000,Number(event.url.searchParams.get('page'))||1)),field=event.url.searchParams.get('field')==='name'?'name':'email';
 let query=db.from('newsletter_contacts').select('id,email,name,status,tags,fields,version,source,created_at,updated_at',{count:'exact'}).eq('tenant_id',tenant).order('email').range((page-1)*50,page*50-1);
 if(q)query=query.ilike(field,'%'+q.replace(/[%_\\]/g,'\\$&')+'%');
 if(['active','unconfirmed','unsubscribed','bounced','complained'].includes(status))query=query.eq('status',status);
 const [contacts,lists,imports]=await Promise.all([query,db.from('newsletter_lists').select('id,name,tags,query').eq('tenant_id',tenant).order('name'),db.from('newsletter_imports').select('id,name,imported,suppressed,created_at').eq('tenant_id',tenant).order('created_at',{ascending:false}).limit(15)]);
 if(contacts.error)throw Error('コンタクトを読み込めませんでした。');
 return {facility,contacts:contacts.data??[],count:contacts.count??0,lists:lists.data??[],imports:imports.data??[],page,q,status,field,tab:event.url.searchParams.get('tab')??'contacts'};
};
