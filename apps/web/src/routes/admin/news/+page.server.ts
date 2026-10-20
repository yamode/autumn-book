import {fail} from '@sveltejs/kit';
import type {Actions,PageServerLoad,RequestEvent} from './$types';
import {listNewsAdmin as demoList,addNews,newsPosts} from '$lib/server/store';
import {DATA_SOURCE} from '$lib/server/supabase';
import {createSupabaseServerClient} from '$lib/server/auth';
import {listNewsAdmin,addNewsAdmin,updateNewsAdmin,FACILITY_UUID} from '$lib/server/supabase-data';
import {currentBookFacility} from '$lib/server/partners/staff';
import {newsForm,newsInput} from '$lib/server/news/editor';
import {issueNewsPreview,newsPreviewSite} from '$lib/server/news/preview';
export const load:PageServerLoad=async event=>{
 const {currentFacility}=await event.parent(),facilityId=FACILITY_UUID[currentFacility.id];
 const site=newsPreviewSite(facilityId);
 return {posts:DATA_SOURCE==='supabase'?await listNewsAdmin(createSupabaseServerClient(event),facilityId):demoList(currentFacility.id),publicNewsBase:DATA_SOURCE==='supabase'&&site?site.origin+'/news/':null,hpPreviewSupported:DATA_SOURCE==='supabase'&&!!site};
};
async function inputFor(event:RequestEvent){
 const form=await newsForm(event.request),selected=currentBookFacility(event);
 if(form.get('facilityId')!==selected.id)throw Error('施設が切り替わっています。再読み込みしてください。');
 return {form,input:newsInput(form),facilityId:FACILITY_UUID[selected.id],bookFacilityId:selected.id};
}
function message(e:unknown){return e instanceof Error?e.message:'保存できませんでした。';}
export const actions:Actions={
 delete:async event=>{
  if(event.locals.user?.role!=='admin')return fail(403,{message:'編集権限がありません。'});
  try{
   const form=await newsForm(event.request),selected=currentBookFacility(event),id=String(form.get('postId')??'');
   if(form.get('facilityId')!==selected.id)return fail(409,{message:'施設が切り替わっています。再読み込みしてください。'});
   if(!id||form.get('confirmDelete')!==id)return fail(400,{message:'削除するお知らせを確認してください。'});
   if(DATA_SOURCE==='supabase'){
    const {data,error}=await createSupabaseServerClient(event).schema('book').from('news_posts').delete().eq('id',id).eq('facility_id',FACILITY_UUID[selected.id]).select('id').maybeSingle();
    if(error||!data)return fail(409,{message:'削除できませんでした。記事の状態や施設の権限を確認してください。'});
   }else{
    const index=newsPosts.findIndex(n=>n.id===id&&n.facilityId===selected.id);
    if(index<0)return fail(404,{message:'お知らせが見つかりません。'});
    newsPosts.splice(index,1);
   }
   return {deleted:id};
  }catch(e){return fail(400,{message:message(e)});}
 },
 autosave:async event=>{
  if(event.locals.user?.role!=='admin')return fail(403,{message:'編集権限がありません。'});
  try{const {form,input,facilityId,bookFacilityId}=await inputFor(event),id=String(form.get('postId')??'');
   if(DATA_SOURCE==='supabase'){const db=createSupabaseServerClient(event);if(!id){const created=await addNewsAdmin(db,facilityId,input);return {saved:created.id};}
    const {data,error}=await db.schema('book').from('news_posts').update({title:input.title,body:input.body,published_at:input.publishedAt,cover_image_url:input.coverImageUrl,cover_image_alt:input.coverImageAlt}).eq('id',id).eq('facility_id',facilityId).select('id').maybeSingle();if(error||!data)return fail(409,{message:'自動保存できませんでした。'});return {saved:id};}
   if(!id){addNews({facilityId:bookFacilityId,...input,isPublished:false});return {saved:demoList(bookFacilityId)[0]?.id};}
   const post=newsPosts.find(n=>n.id===id&&n.facilityId===bookFacilityId);if(!post)return fail(404,{message:'お知らせが見つかりません。'});Object.assign(post,input);return {saved:id};
  }catch(e){return fail(400,{message:message(e)});}
 },
 add:async event=>{
  if(event.locals.user?.role!=='admin')return fail(403,{message:'編集権限がありません。'});
  try{
   const {input,facilityId,bookFacilityId}=await inputFor(event);
   if(DATA_SOURCE==='supabase'){const post=await addNewsAdmin(createSupabaseServerClient(event),facilityId,input);return {added:post.id};}
   addNews({facilityId:bookFacilityId,...input,isPublished:false});return {added:'demo'};
  }catch(e){return fail(400,{message:message(e)});}
 },
 save:async event=>{
  if(event.locals.user?.role!=='admin')return fail(403,{message:'編集権限がありません。'});
  try{
   const {form,input,facilityId,bookFacilityId}=await inputFor(event),id=String(form.get('postId')??''),isPublished=form.get('isPublished')==='on';
   if(DATA_SOURCE==='supabase'){
    const db=createSupabaseServerClient(event),{data:post}=await db.schema('book').from('news_posts').select('id').eq('id',id).eq('facility_id',facilityId).maybeSingle();
    if(!post)return fail(404,{message:'お知らせが見つかりません。'});
    await updateNewsAdmin(db,id,{...input,isPublished});return {saved:id};
   }
   const post=newsPosts.find(n=>n.id===id&&n.facilityId===bookFacilityId);if(!post)return fail(404,{message:'お知らせが見つかりません。'});Object.assign(post,input,{isPublished});return {saved:id};
  }catch(e){return fail(400,{message:message(e)});}
 },
 preview:async event=>{
  if(event.locals.user?.role!=='admin'||DATA_SOURCE!=='supabase')return fail(403,{message:'管理者としてログインしてください。'});
  try{
   const {form,input,facilityId}=await inputFor(event),id=String(form.get('postId')??'');
   const site=newsPreviewSite(facilityId);
   if(!site)return fail(403,{message:'この施設のHPプレビューは利用できません。'});
   const token=await issueNewsPreview(id,facilityId);if(!token)return fail(503,{message:'HPプレビューの設定を確認してください。'});
   const {data,error}=await createSupabaseServerClient(event).schema('book').from('news_posts').update({title:input.title,body:input.body,published_at:input.publishedAt,cover_image_url:input.coverImageUrl,cover_image_alt:input.coverImageAlt}).eq('id',id).eq('facility_id',facilityId).eq('is_published',false).select('id').maybeSingle();
   if(error||!data)return fail(409,{message:'下書きを保存できませんでした。公開状態や施設の権限を確認してください。'});
   return {previewUrl:site.origin+'/news/'+id+'/?preview='+encodeURIComponent(token),saved:id};
  }catch(e){return fail(400,{message:message(e)});}
 }
};
