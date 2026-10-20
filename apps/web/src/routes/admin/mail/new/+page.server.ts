import type {PageServerLoad} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
export const load:PageServerLoad=async event=>{
 const {db,tenant,facility}=await newsletterContext(event);
 const [assets,lists,settings]=await Promise.all([db.from('newsletter_assets').select('id,name,kind,document').eq('tenant_id',tenant),db.from('newsletter_lists').select('id,name,tags').eq('tenant_id',tenant),db.from('newsletter_settings').select('from_name,from_email,reply_to').eq('facility_id',facility).maybeSingle()]);
 return {facility,campaign:null,defaults:settings.data,assets:assets.data??[],lists:lists.data??[],deliveries:[]};
};
