import {error} from '@sveltejs/kit';
export async function newsForm(request:Request,maxBytes=512*1024){
 const reader=request.body?.getReader();if(!reader)error(400,'入力がありません。');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();error(413,'入力データが大きすぎます。');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return await new Response(bytes,{headers:{'content-type':request.headers.get('content-type')??''}}).formData();}catch{error(400,'入力データを読み取れません。');}
}
export function newsInput(form:FormData){
 const title=String(form.get('title')??'').trim(),body=String(form.get('body')??''),publishedAt=String(form.get('publishedAt')??'');
 if(!title||title.length>200)throw Error('タイトルは1〜200文字で入力してください。');
 if(body.length>100000)throw Error('本文は100,000文字以内で入力してください。');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt)||Number.isNaN(Date.parse(publishedAt+'T00:00:00Z')))throw Error('掲載日を指定してください。');
 return {title,body,publishedAt};
}
