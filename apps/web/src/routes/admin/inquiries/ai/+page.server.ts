import {error,fail} from '@sveltejs/kit';
import type {PageServerLoad,Actions} from './$types';
import {ADMIN_SUPABASE,createSupabaseServerClient} from '$lib/server/auth';
import {currentBookFacility} from '$lib/server/partners/staff';
import {FACILITY_UUID} from '$lib/server/supabase-data';
export const load:PageServerLoad=async event=>{
 if(!ADMIN_SUPABASE)error(503,'本番データ環境で利用できます。');
 event.setHeaders({'cache-control':'no-store'});
 const facilityId=FACILITY_UUID[currentBookFacility(event).id];
 const {data,error:e}=await createSupabaseServerClient(event).schema('book').rpc('admin_inquiry_ai_settings',{p_facility:facilityId});
 if(e||!data)error(403,'共通AI設定を取得できません。施設のアクセス権限を確認してください。');
 return {facilityId,settings:data as {tenant_id:string;configured_model:string|null;effective_model:string;can_edit:boolean}};
};
export const actions:Actions={save:async event=>{
 if(!ADMIN_SUPABASE||!['admin','staff'].includes(event.locals.user?.role??''))return fail(403,{message:'スタッフとしてログインしてください。'});
 const form=await event.request.formData(),facilityId=FACILITY_UUID[currentBookFacility(event).id];
 if(form.get('facilityId')!==facilityId)return fail(409,{message:'施設が切り替わっています。画面を更新してください。'});
 const {error:e}=await createSupabaseServerClient(event).schema('book').rpc('admin_save_inquiry_ai_settings',{p_facility:facilityId,p_model:String(form.get('model')??''),p_expected:String(form.get('expected')??'')});
 if(e){if(e.message.includes('settings_changed'))return fail(409,{message:'PMSまたは別の画面で設定が変更されています。再読み込みしてから保存してください。'});if(e.message.includes('forbidden'))return fail(403,{message:'設定変更にはテナント管理者権限が必要です。'});return fail(400,{message:'保存できませんでした。モデルの選択と権限を確認してください。'});}
 return {done:'共通のAIモデル設定を保存しました。PMSとBookの次回の生成から反映されます。'};
}};
