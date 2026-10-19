import {error,type RequestEvent} from '@sveltejs/kit';
import {createSupabaseServerClient,ADMIN_SUPABASE} from '$lib/server/auth';
import {inquiry} from '$lib/server/inquiries';
import {FACILITY_UUID} from '$lib/server/supabase-data';

export async function inquiryContext(event:RequestEvent,mutation=false){
 if(mutation&&event.request.headers.get('origin')!==event.url.origin)error(403,'許可されていないアクセスです。');
 if(!ADMIN_SUPABASE||!['admin','staff'].includes(event.locals.user?.role??''))error(401,'スタッフとしてログインしてください。');
 const db=createSupabaseServerClient(event),item=await inquiry(db,event.params.id??'');
 if(!item||item.facility_id!==FACILITY_UUID['f-nishiwaga'])error(404,'お問い合わせが見つかりません。');
 return {db,item};
}
export async function limitedInquiryBytes(request:Request,limit:number){
 const reader=request.body?.getReader();if(!reader)error(400,'入力がありません。');
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();error(413,'添付ファイルが大きすぎます。合計5MBまでです。');}chunks.push(value);}
 const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}return all;
}
