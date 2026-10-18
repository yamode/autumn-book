import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';
import { aiConfigured, history, inquiry, makeDraft,draftJob } from '$lib/server/inquiries';
import { FACILITY_UUID } from '$lib/server/supabase-data';

export const load: PageServerLoad = async event => {
 if(!ADMIN_SUPABASE) error(503,'本番データ環境で利用できます。');
 const db=createSupabaseServerClient(event);
 const item=await inquiry(db,event.params.id);
 if(!item || item.facility_id!==FACILITY_UUID['f-nishiwaga']) error(404,'お問い合わせが見つかりません。');
 if(event.cookies.get('ab_fac')!=='f-nishiwaga') {
  event.cookies.set('ab_fac','f-nishiwaga',{path:'/',httpOnly:true,sameSite:'lax',secure:event.url.protocol==='https:'});
  redirect(303,event.url.pathname);
 }
 const [messages,job]=await Promise.all([history(db,item.id),draftJob(db,item.id)]);
 return {item,messages,job,aiConfigured:aiConfigured()};
};
export const actions: Actions = {
 default: async event => {
  if(!ADMIN_SUPABASE || !['admin','staff'].includes(event.locals.user?.role??'')) return fail(403,{message:'スタッフとしてログインしてください。'});
  const form=await event.request.formData();
  const body=String(form.get('body')??'');
  try {
   const db=createSupabaseServerClient(event), item=await inquiry(db,event.params.id);
   if(!item || item.facility_id!==FACILITY_UUID['f-nishiwaga']) return fail(404,{message:'お問い合わせが見つかりません。',body});
   const action=String(form.get('action')??'save');
   const revision=Number(form.get('revision'));
   if(revision!==item.revision) return fail(409,{message:'新しい返信または他の担当者の変更があります。入力内容を控えて再読み込みしてください。',body});
   if(action==='history_enable'||action==='history_disable') {
    const {error:he}=await db.schema('book').rpc('admin_inquiry_history_reference',{p_id:item.id,p_revision:revision,p_message:String(form.get('messageId')),p_enable:action==='history_enable'});
    if(he)throw new Error(he.message);
    return {message:action==='history_enable'?'過去メールの参考利用を再開しました。':'過去メールの参考利用を停止しました。'};
   }
   const expectedVersion=Number(form.get('draftVersion'));
   if(['ai','save','send'].includes(action)&&expectedVersion!==item.draft_version)return fail(409,{message:'他の担当者の下書きが更新されました。入力本文をコピーし、再読み込みしてください。',body});
   const args: Record<string,unknown>={p_id:item.id,p_revision:revision,p_action:action,p_body:body,p_expected_draft_version:item.draft_version};
   if(action==='ai') {
    const draft=await makeDraft(db,item);
    Object.assign(args,{p_body:draft.text,p_sources:draft.sources,p_model:draft.model});
   }
   if(action==='status') Object.assign(args,{p_status:String(form.get('status')),p_assignee:String(form.get('assignee')??'')});
   if(['approve','revoke','retry','resolve_sent','resolve_unsent'].includes(action)) args.p_message=String(form.get('messageId'));
   if(action==='approve') Object.assign(args,{p_question:String(form.get('question')??''),p_answer:String(form.get('answer')??''),p_until:String(form.get('until')??'')||null});
   const {error:e}=await db.schema('book').rpc('admin_inquiry_edit',args);
   if(e) throw new Error(e.message);
   return {message:action==='send'?'送信を受け付けました。送信キューの結果は画面を更新して確認できます。':action==='ai'?'AI下書きを保存しました。根拠と要確認箇所をご確認ください。':'保存しました。',...(action==='send'?{body:''}:{})};
  } catch(e) {return fail(400,{message:e instanceof Error?e.message:'処理に失敗しました。',...(form.has('body')?{body}:{})});}
 }
};
