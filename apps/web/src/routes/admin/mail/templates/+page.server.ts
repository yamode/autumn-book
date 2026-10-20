import type {PageServerLoad} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
export const load:PageServerLoad=async event=>{
 const {db,tenant}=await newsletterContext(event);
 const {data,error}=await db.from('newsletter_assets').select('id,name,kind,document').eq('tenant_id',tenant).order('created_at',{ascending:false});
 if(error)throw Error('テンプレートを取得できませんでした。');return {assets:data??[]};
};
