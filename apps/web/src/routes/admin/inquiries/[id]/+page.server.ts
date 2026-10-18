import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSupabaseServerClient, ADMIN_SUPABASE } from '$lib/server/auth';
import { aiConfigured, history, inquiry, makeDraft } from '$lib/server/inquiries';
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
 return {item,messages:await history(db,item.id),aiConfigured:aiConfigured()};
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
   const args: Record<string,unknown>={p_id:item.id,p_revision:revision,p_action:action,p_body:body};
   if(action==='ai') {
    const draft=await makeDraft(db,item,await history(db,item.id));
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
