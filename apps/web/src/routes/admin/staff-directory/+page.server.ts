import {error,fail,type RequestEvent} from '@sveltejs/kit';
import type {Actions,PageServerLoad} from './$types';
import {ADMIN_SUPABASE,createSupabaseServerClient} from '$lib/server/auth';
import {currentBookFacility,staffHasFacilityAccess} from '$lib/server/partners/staff';
import {FACILITY_UUID} from '$lib/server/supabase-data';
import {facilityStaff,STAFF_COLUMNS} from '$lib/server/staff-directory';
async function context(event:RequestEvent){
 if(!ADMIN_SUPABASE)error(503,'本番データ環境で利用できます。');
 if(!['admin','staff'].includes(event.locals.user?.role??''))error(403,'スタッフとしてログインしてください。');
 const facility=currentBookFacility(event),facilityId=FACILITY_UUID[facility.id];
 if(!facilityId||!await staffHasFacilityAccess(event,facilityId))error(403,'この施設へのアクセス権限がありません。');
 return {facility,facilityId,db:createSupabaseServerClient(event)};
}
export const load:PageServerLoad=async event=>{
 event.setHeaders({'cache-control':'no-store'});
 const {facility,facilityId,db}=await context(event);
 return {facility,facilityId,staff:await facilityStaff(db,facilityId),canEdit:event.locals.user?.role==='admin'};
};
export const actions:Actions={
 save:async event=>{
  if(event.locals.user?.role!=='admin')return fail(403,{message:'スタッフマスタの編集は管理者のみ可能です。'});
  const {facilityId,db}=await context(event),form=await event.request.formData();
  if(form.get('facilityId')!==facilityId)return fail(409,{message:'施設が切り替わっています。画面を更新してください。'});
  const id=String(form.get('id')??''),name=String(form.get('name')??'').trim(),kana=String(form.get('kana')??'').trim(),nickname=String(form.get('nickname')??'').trim(),department=String(form.get('department')??'').trim();
  if(!name||[name,kana,nickname,department].some(v=>v.length>100))return fail(400,{message:'氏名は必須です。各項目は100文字以内で入力してください。'});
  const values={name,kana:kana||null,nickname:nickname||null,department:department||null,is_active:form.has('is_active'),can_take_reservation:form.has('can_take_reservation'),exclude_from_room_assignment:form.has('exclude_from_room_assignment')};
  const table=db.schema('pms').from('staff_directory');
  if(id){
   const {data:old,error:oe}=await table.select(STAFF_COLUMNS).eq('facility_id',facilityId).eq('id',id).single();
   if(oe||!old)return fail(404,{message:'スタッフが見つかりません。'});
   if(old.updated_at!==form.get('updated_at'))return fail(409,{message:'別の画面で更新されています。再読み込みしてください。'});
   const overrides={...(old.book_overrides??{})};
   for(const key of ['name','kana','nickname','department','is_active'] as const)if(old[key]!==values[key])overrides[key]=values[key];
   const {data,error:e}=await db.schema('pms').from('staff_directory').update({...values,book_overrides:overrides}).eq('id',id).eq('facility_id',facilityId).eq('updated_at',old.updated_at).select('id');
   if(e||!data?.length)return fail(409,{message:'保存できませんでした。画面を更新して再度お試しください。'});
  }else{
   const {data:facility,error:fe}=await db.schema('core').from('facilities').select('tenant_id').eq('id',facilityId).single();
   if(fe||!facility)return fail(403,{message:'施設情報を取得できません。'});
   const {error:e}=await table.insert({...values,facility_id:facilityId,tenant_id:facility.tenant_id,hr_employee_id:'book:'+crypto.randomUUID(),manual_import:true});
   if(e)return fail(400,{message:'登録できませんでした。入力と施設の権限を確認してください。'});
  }
  return {done:'スタッフ情報を保存しました。'};
 },
 remove:async event=>{
  if(event.locals.user?.role!=='admin')return fail(403,{message:'スタッフマスタの編集は管理者のみ可能です。'});
  const {facilityId,db}=await context(event),form=await event.request.formData();
  if(form.get('facilityId')!==facilityId)return fail(409,{message:'施設が切り替わっています。画面を更新してください。'});
  const id=String(form.get('id')??'');
  const {data:old,error:oe}=await db.schema('pms').from('staff_directory').select('updated_at,book_overrides').eq('facility_id',facilityId).eq('id',id).single();
  if(oe||!old||old.updated_at!==form.get('updated_at'))return fail(409,{message:'別の画面で更新されています。再読み込みしてください。'});
  const {data,error:e}=await db.schema('pms').from('staff_directory').update({is_active:false,book_overrides:{...(old.book_overrides??{}),is_active:false}}).eq('facility_id',facilityId).eq('id',id).eq('updated_at',old.updated_at).select('id');
  if(e||!data?.length)return fail(409,{message:'削除できませんでした。画面を更新してください。'});
  return {done:'スタッフを無効化しました。履歴は保持され、編集から再び有効にできます。'};
 }
};
