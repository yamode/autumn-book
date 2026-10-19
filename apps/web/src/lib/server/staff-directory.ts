import type {SupabaseClient} from '@supabase/supabase-js';
export const STAFF_COLUMNS='id,facility_id,tenant_id,hr_employee_id,name,kana,nickname,department,is_active,can_take_reservation,exclude_from_room_assignment,manual_import,sort_order,updated_at,book_overrides';
export async function facilityStaff(db:SupabaseClient,facilityId:string){
 const {data,error}=await db.schema('pms').from('staff_directory').select(STAFF_COLUMNS).eq('facility_id',facilityId).order('sort_order',{nullsFirst:false}).order('kana',{nullsFirst:false}).order('name');
 if(error)throw Error('スタッフマスタを取得できません。');
 return data??[];
}
