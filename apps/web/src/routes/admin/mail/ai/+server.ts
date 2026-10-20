import {json,error} from '@sveltejs/kit';
import type {RequestHandler} from './$types';
import {newsletterContext} from '$lib/server/newsletter';
import {createSupabaseServerClient} from '$lib/server/auth';
import {newsForm} from '$lib/server/news/editor';
export const POST:RequestHandler=async event=>{
 const {db,facility}=await newsletterContext(event,true),form=await newsForm(event.request,16000);
 if(form.get('facility')!==facility)error(409,'施設が切り替わっています。');
 const kind=String(form.get('kind')),prompt=String(form.get('prompt')??'').trim(),tone=String(form.get('tone')??'丁寧で上品');
 if(!['image','cta','subject','body'].includes(kind)||!prompt||prompt.length>2048)error(400,'生成内容は1〜2048文字で入力してください。');
 const ai=event.platform?.env?.AI;if(!ai)error(503,'AIサービスの接続を準備中です。');
 const {error:budget}=await db.rpc('admin_newsletter_ai_budget',{p_facility:facility,p_kind:kind==='image'?'image':'text'});
 if(budget)error(429,'AIの利用上限に達しました。時間をおいてお試しください。');
 try{
  if(kind==='image'){
   const result=await ai.run('@cf/black-forest-labs/flux-1-schnell',{prompt,steps:4});
   if(!result.image||result.image.length>12*1024*1024)throw Error('invalid_image');
   const bytes=Uint8Array.from(atob(result.image),c=>c.charCodeAt(0));
   if(bytes[0]!==255||bytes[1]!==216||bytes[2]!==255)throw Error('invalid_image');
   const path=`news/${facility}/mail-ai-${crypto.randomUUID()}.jpg`,storage=createSupabaseServerClient(event).storage.from('book-photos');
   const {error:e}=await storage.upload(path,bytes,{contentType:'image/jpeg',upsert:false,cacheControl:'31536000'});if(e)throw Error('upload_failed');
   const url=storage.getPublicUrl(path).data.publicUrl;
   const {error:assetError}=await db.rpc('admin_newsletter_asset',{p_facility:facility,p_kind:'image',p_name:'AI画像 '+new Date().toISOString(),p_document:{url,alt:prompt.slice(0,200),prompt}});
   if(assetError)throw Error('asset_failed');
   return json({url});
  }
  const task=kind==='cta'?'行動を促すボタンの文言を、各20文字以内で3案':kind==='subject'?'メールの件名を、各40文字以内で3案':'メールマガジンの本文を300〜600文字';
  const result=await ai.run('@cf/qwen/qwen3-30b-a3b-fp8',{messages:[{role:'system',content:`あなたは宿泊施設・山人の日本語メール編集者です。${task}を作成してください。トーンは${tone.slice(0,50)}。入力にない価格・期限・商品・予約状況は創作しないでください。回答は提案文だけとし、HTMLや解説を含めないでください。/no_think`},{role:'user',content:prompt}],max_tokens:1500,temperature:0.6});
  let text='';
  if(typeof result==='string')text=result;
  else if(result&&typeof result==='object'&&'choices' in result){const first=result.choices?.[0];if(first&&'message' in first)text=first.message?.content??'';else if(first&&'text' in first)text=first.text;}
  if(typeof text!=='string'||!text.trim())throw Error('empty_result');
  return json({text:text.replace(/<think>[\s\S]*?<\/think>/g,'').trim().slice(0,10000)});
 }catch{return json({error:'AI生成を完了できませんでした。入力内容またはサービスの接続状態を確認してください。'},{status:503});}
};
