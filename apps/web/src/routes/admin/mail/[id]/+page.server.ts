import {error} from '@sveltejs/kit';
import type {PageServerLoad} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
export const load:PageServerLoad=async event=>{
 const {db,tenant,facility}=await newsletterContext(event);
 const [c,assets,lists,deliveries,summary]=await Promise.all([
  db.from('newsletter_campaigns').select('*').eq('id',event.params.id).eq('facility_id',facility).eq('tenant_id',tenant).single(),
  db.from('newsletter_assets').select('id,name,kind,document').eq('tenant_id',tenant),db.from('newsletter_lists').select('id,name,tags').eq('tenant_id',tenant),
  db.from('newsletter_deliveries').select('id,kind,state,opened_at,clicked_at,error').eq('campaign_id',event.params.id).order('created_at',{ascending:false}).limit(100),
  db.rpc('admin_newsletter_delivery_summary',{p_facility:facility,p_id:event.params.id})
 ]);
 if(c.error||!c.data)error(404,'メールが見つかりません。');
 return {facility,campaign:c.data,assets:assets.data??[],lists:lists.data??[],deliveries:deliveries.data??[],summary:summary.error?null:summary.data};
};
