import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';



export const STATES: Record<string, string> = { new: '未対応', working: '対応中', waiting: 'お客様の返信待ち', done: '完了' };
export type Inquiry = { id: string; facility_id: string; tenant_id:string; name: string; email: string; subject: string; profile: Record<string,string>; status: string; assignee: string; revision: number; draft: string; draft_revision: number | null; ai_sources: Source[]; ai_model: string | null; updated_at: string; draft_version:number; draft_origin:string; draft_updated_at:string|null };
export type Message = { id: string; direction: string; body: string; subject: string; state: string; error: string | null; created_at: string; sent_at: string | null; reusable: boolean; knowledge_question: string | null; knowledge_answer: string | null; valid_until: string | null; ai_original: string | null; history_reference: boolean; history_source: Record<string,string> };
export type Source = { id: string; kind: string; question: string; answer: string; score: number; inquiry_id?: string; answered_at?: string };
export async function inquiry(db: SupabaseClient, id: string) {
 const { data, error } = await db.schema('book').from('inquiries').select('*').eq('id', id).maybeSingle();
 if (error) throw new Error('お問い合わせを取得できません。DBの更新状況をご確認ください。');
 return data as Inquiry | null;
}
export async function history(db: SupabaseClient, id: string) {
 const { data, error } = await db.schema('book').from('inquiry_messages').select('*').eq('inquiry_id', id).order('created_at');
 if (error) throw new Error('履歴を取得できません。');
 return data as Message[];
}
export function aiConfigured() { return env.DATA_SOURCE==='supabase'; }
export async function makeDraft(db: SupabaseClient, item: Inquiry) {
 if (!aiConfigured()) throw new Error('本番データ環境で利用できます。');
 const {data:result,error}=await db.functions.invoke('draft-inquiry-reply',{body:{id:item.id,revision:item.revision}});
 if(error||!result?.text)throw new Error(result?.error||'AI下書きを作成できませんでした。時間をおいて再度お試しください。');
 return result as {text:string;sources:Source[];model:string};
}
export type DraftJob={state:string;error:string|null;updated_at:string};
export async function draftJob(db:SupabaseClient,id:string){
 const {data,error}=await db.schema('book').from('inquiry_draft_jobs').select('state,error,updated_at').eq('inquiry_id',id).maybeSingle();
 if(error)throw new Error('AI下書きの状況を取得できません。');
 return data as DraftJob|null;
}