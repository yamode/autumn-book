import type {PageServerLoad} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
import {newsletterTemplates} from '$lib/newsletter-templates';
export const load:PageServerLoad=async event=>{
 const {db,tenant,facility}=await newsletterContext(event);
 const [assets,lists,settings]=await Promise.all([db.from('newsletter_assets').select('id,name,kind,document').eq('tenant_id',tenant),db.from('newsletter_lists').select('id,name,tags').eq('tenant_id',tenant),db.from('newsletter_settings').select('from_name,from_email,reply_to').eq('facility_id',facility).maybeSingle()]);
 const choices=[...newsletterTemplates(),...(assets.data??[])],selected=choices.find(a=>a.kind==='template'&&a.id===event.url.searchParams.get('template'));
 return {facility,campaign:null,templateId:selected?.id??'',template:selected?.document,defaults:settings.data,assets:choices,lists:lists.data??[],deliveries:[]};
};
