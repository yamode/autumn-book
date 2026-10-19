import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { partnerServiceClient } from '$lib/server/partners/admin-client';
import { FACILITY_UUID } from '$lib/server/supabase-data';

// Server-to-server only: the HP verifies Turnstile and rate limits before signing.
export const POST: RequestHandler = async ({request,params}) => {
 if(params.facility!=='nishiwaga' || env.INQUIRY_NISHIWAGA_ENABLED!=='true') error(404,'Not found');
 const secret=env.INQUIRY_HP_SECRET;
 if(!secret) error(503,'受付準備中です。');
 const timestamp=request.headers.get('x-inquiry-timestamp')??'';
 const signature=request.headers.get('x-inquiry-signature')??'';
 if(!/^\d{10}$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp))>300 || !/^[a-f0-9]{64}$/.test(signature)) error(401,'Unauthorized');
 const reader=request.body?.getReader();
 if(!reader) error(400,'Empty body');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>64000){await reader.cancel();error(413,'Too large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const raw=new TextDecoder().decode(bytes);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const sig=Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16));
 if(!await crypto.subtle.verify('HMAC',key,sig,new TextEncoder().encode(`${timestamp}.${raw}`)))error(401,'Unauthorized');
 let input:Record<string,unknown>;try{input=JSON.parse(raw);}catch{error(400,'Invalid JSON');}
 const field=(name:string,max:number)=>typeof input[name]==='string'?String(input[name]).trim().slice(0,max):'';
 const name=field('name',100),email=field('email',254),subject=field('subject',200)||'お問い合わせ',body=field('body',10000),id=field('requestKey',36);
 if(!name || !body || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))error(400,'Invalid input');
 const db=partnerServiceClient();if(!db)error(503,'受付準備中です。');
 const inquiryType=field('inquiryType',20)||'guest';
 if(!['guest','business','media'].includes(inquiryType))error(400,'Invalid inquiry type');
 const profile:Record<string,string>={inquiry_type:inquiryType};for(const [k,max] of [['kana',100],['tel',30],['address',300]] as const)profile[k]=field(k,max);
 const {data,error:e}=await db.schema('book').rpc('inquiry_accept',{p_facility:FACILITY_UUID['f-nishiwaga'],p_key:id,p_name:name,p_email:email,p_subject:subject,p_body:body,p_profile:profile,p_notice:'info@yamado.co.jp'});
 if(e){console.error('[inquiry] accept failed',e.code);error(503,'受付処理に失敗しました。時間をおいて再度お試しください。');}
 return json({ok:true,id:data},{headers:{'cache-control':'no-store'}});
};
