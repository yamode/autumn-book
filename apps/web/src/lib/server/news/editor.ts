import {error} from '@sveltejs/kit';
import {FACILITY_UUID} from '$lib/server/supabase-data';
export async function newsForm(request:Request,maxBytes=512*1024){
 const reader=request.body?.getReader();if(!reader)error(400,'入力がありません。');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();error(413,'入力データが大きすぎます。');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return await new Response(bytes,{headers:{'content-type':request.headers.get('content-type')??''}}).formData();}catch{error(400,'入力データを読み取れません。');}
}
export function newsInput(form:FormData){
 const title=String(form.get('title')??'').trim(),body=String(form.get('body')??'').replace(/\r\n?/g,'\n'),publishedAt=String(form.get('publishedAt')??'');
 if(!title||title.length>200)throw Error('タイトルは1〜200文字で入力してください。');
 if(body.length>100000)throw Error('本文は100,000文字以内で入力してください。');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)||Number.isNaN(Date.parse(publishedAt+'T00:00:00Z')))throw Error('掲載日を指定してください。');
 const coverImageUrl=String(form.get('coverImageUrl')??'').trim(),coverImageAlt=String(form.get('coverImageAlt')??'').trim();
 if(coverImageAlt.length>200||coverImageUrl.length>2000)throw Error('アイキャッチの入力が長すぎます。');
 if(coverImageUrl){try{const u=new URL(coverImageUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error();}catch{throw Error('アイキャッチ画像のURLを確認してください。');}}
 // 掲載施設（複数可・2026-11-22）。送られてこない（古い画面・デモ）ときは undefined＝今の施設だけ
 const sent=form.getAll('facilityIds').map(String).filter(Boolean),allowed=new Set(Object.values(FACILITY_UUID));
 if(form.has('facilityIdsSent')&&!sent.length)throw Error('掲載施設を1つ以上選んでください。');
 const facilityIds=sent.length?[...new Set(sent)].filter(id=>allowed.has(id)):undefined;
 if(facilityIds&&!facilityIds.length)throw Error('掲載施設を確認してください。');
 return {title,body,publishedAt,coverImageUrl:coverImageUrl||null,coverImageAlt,facilityIds};
}
