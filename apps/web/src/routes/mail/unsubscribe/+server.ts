import {env} from '$env/dynamic/public';
import type {RequestHandler} from './$types';
import {newsForm} from '$lib/server/news/editor';
const valid=(token:string|null):token is string=>!!token&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
const page=(body:string,status=200)=>new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>メールの配信停止 ｜ 山人</title><style>body{margin:0;padding:48px 20px;background:#f5f5f4;color:#292524;font:16px/1.8 sans-serif}main{max-width:520px;margin:auto;padding:32px;background:white;border-radius:12px}h1{font-size:24px}button{padding:14px 24px;background:#292524;color:white;border:0;border-radius:8px;font-size:16px;cursor:pointer}</style></head><body><main>${body}</main></body></html>`,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"}});
export const GET:RequestHandler=async({url})=>valid(url.searchParams.get('t'))?page('<h1>メールの配信を停止する</h1><p>山人からのメールマガジンの配信を停止します。</p><form method="POST"><button name="confirm" value="yes">配信を停止する</button></form>'):page('<h1>リンクをご確認ください</h1><p>メールに記載された配信停止リンクを開いてください。</p>',400);
export const POST:RequestHandler=async({request,url,fetch})=>{
 const token=url.searchParams.get('t');if(!valid(token))return page('<h1>リンクをご確認ください</h1>',400);
 if(Number(request.headers.get('content-length')??0)>2048)return new Response(null,{status:413});
 const form=await newsForm(request,2048),oneClick=form.get('List-Unsubscribe')==='One-Click';
 if(!oneClick&&(request.headers.get('origin')!==url.origin||form.get('confirm')!=='yes'))return new Response(null,{status:403});
 if(!env.PUBLIC_SUPABASE_URL)return page('<h1>現在処理できません</h1><p>時間をおいて、もう一度お試しください。</p>',503);
 try{
  const r=await fetch(env.PUBLIC_SUPABASE_URL+'/functions/v1/newsletter-unsubscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('suppression unavailable');
  return oneClick?new Response(null,{status:204,headers:{'cache-control':'no-store'}}):page('<h1>配信を停止しました</h1><p>今後のメールマガジン配信から除外します。</p><p>ご予約に関するご案内などは引き続きお送りします。</p>');
 }catch{return page('<h1>停止を完了できませんでした</h1><p>時間をおいて、もう一度お試しください。</p>',503);}
};
