import {error} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
export const GET:RequestHandler=async event=>{
 const {db,tenant,facility}=await newsletterContext(event);
 const {data,error:e}=await db.from('newsletter_campaigns').select('id,html').eq('id',event.params.id).eq('tenant_id',tenant).eq('facility_id',facility).single();
 if(e||!data)error(404,'メールが見つかりません。');
 return new Response(data.html,{headers:{'Content-Type':'text/html;charset=utf-8','Content-Disposition':`attachment; filename="newsletter-${data.id}.html"`,'Content-Security-Policy':"sandbox; default-src 'none'; img-src https:; style-src 'unsafe-inline';",'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
};
