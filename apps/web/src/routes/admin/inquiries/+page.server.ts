import type { PageServerLoad } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';
import { FACILITY_UUID } from '$lib/server/supabase-data';
import type { Inquiry } from '$lib/server/inquiries';
export const load: PageServerLoad = async event => {
 const { currentFacility } = await event.parent();
 if(currentFacility.id!=='f-nishiwaga') return {items:[] as Inquiry[],unavailable:'お問い合わせ管理は現在、山人-yamado-で先行運用しています。施設を切り替えてください。',more:false,page:1,status:'',health:null};
 if(!ADMIN_SUPABASE) return {items:[] as Inquiry[], unavailable:'お問い合わせ管理は本番データ環境で利用できます。', more:false,page:1,status:'',health:null};
 const db = createSupabaseServerClient(event);
 let query = db.schema('book').from('inquiries').select('id,name,email,subject,status,assignee,updated_at').eq('facility_id',FACILITY_UUID[currentFacility.id]);
 const status = event.url.searchParams.get('status');
 if(status && ['new','working','waiting','done'].includes(status)) query=query.eq('status',status);
 const rawPage=Number(event.url.searchParams.get('page')||1);
 const page=Number.isFinite(rawPage)?Math.min(100000,Math.max(1,Math.floor(rawPage))):1;
 const {data,error} = await query.order('updated_at',{ascending:false}).order('id').range((page-1)*50,page*50);
 const {data:health}=await db.schema('book').rpc('admin_inquiry_sync_health',{p_facility:FACILITY_UUID[currentFacility.id]});
 return {items:(data??[]).slice(0,50) as Inquiry[], more:(data?.length??0)>50, page,status:status??'', health:health as {last_sync_at:string|null;last_error:string|null}|null, unavailable:error?'お問い合わせDBの準備が完了していません。管理者にご確認ください。':null};
};
