import type {PageServerLoad} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
export const load:PageServerLoad=async event=>{
 const {db,facility}=await newsletterContext(event);
 const {data,error}=await db.from('newsletter_settings').select('from_name,from_email,reply_to,organization,postal_address,enabled').eq('facility_id',facility).maybeSingle();
 if(error)throw Error('配信設定を取得できませんでした。');
 return {facility,settings:data};
};
