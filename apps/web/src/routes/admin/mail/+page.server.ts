import type {PageServerLoad} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
export const load:PageServerLoad=async event=>{
 const {db,tenant,facility}=await newsletterContext(event);
 const {data:campaigns,error}=await db.from('newsletter_campaigns').select('id,name,subject,status,scheduled_at,updated_at').eq('tenant_id',tenant).eq('facility_id',facility).order('updated_at',{ascending:false}).limit(100);
 const states=['active','unsubscribed','bounced','complained','unconfirmed'];
 const counts=await Promise.all(states.map(s=>db.from('newsletter_contacts').select('id',{count:'exact',head:true}).eq('tenant_id',tenant).eq('status',s)));
 return {facility,campaigns:campaigns??[],counts:Object.fromEntries(states.map((s,i)=>[s,counts[i].count??0])),unavailable:error?'メルマガのデータベースを準備中です。':''};
};
