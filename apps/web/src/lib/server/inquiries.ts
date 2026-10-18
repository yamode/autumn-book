import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { listFaqsAdmin } from './faq/admin';
import { searchFaqs, type SearchableFaq } from './faq/search';

export const STATES: Record<string, string> = { new: '未対応', working: '対応中', waiting: 'お客様の返信待ち', done: '完了' };
export type Inquiry = { id: string; facility_id: string; tenant_id:string; name: string; email: string; subject: string; profile: Record<string,string>; status: string; assignee: string; revision: number; draft: string; draft_revision: number | null; ai_sources: Source[]; ai_model: string | null; updated_at: string };
export type Message = { id: string; direction: string; body: string; subject: string; state: string; error: string | null; created_at: string; sent_at: string | null; reusable: boolean; knowledge_question: string | null; knowledge_answer: string | null; valid_until: string | null; ai_original: string | null };
export type Source = { id: string; kind: string; question: string; answer: string; score: number };
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
export async function makeDraft(db: SupabaseClient, item: Inquiry, messages: Message[]) {
 if (!aiConfigured()) throw new Error('本番データ環境で利用できます。');
 const faqs = (await listFaqsAdmin(db, item.facility_id)).filter(f => f.isPublished);
 // RLS + explicit facility filter. Only staff-curated, unexpired examples are eligible.
 const { data: examples, error } = await db.schema('book').from('inquiry_messages')
  .select('id,knowledge_question,knowledge_answer,valid_until,inquiries!inner(facility_id)')
  .eq('inquiries.facility_id', item.facility_id).eq('reusable',true).eq('state','sent')
  .order('created_at',{ascending:false}).limit(300);
 if (error) throw new Error('過去回答を取得できません。');
 const today = new Date().toISOString().slice(0,10);
 const pool: SearchableFaq[] = [...faqs, ...(examples ?? []).filter(e=>!e.valid_until || e.valid_until>=today).map(e=>({id:e.id,category:'承認済み回答例',question:e.knowledge_question,answer:e.knowledge_answer,keywords:[]}))];
 const conversation = messages.filter(m=>m.direction==='in' || (m.direction==='out' && m.state==='sent')).slice(-12);
 const question = conversation.filter(m=>m.direction==='in').at(-1)?.body ?? item.subject;
 const sources: Source[] = searchFaqs(question,pool,'ja',6).map(h=>({id:h.faq.id,kind:faqs.some(f=>f.id===h.faq.id)?'FAQ':'過去回答',question:h.faq.question,answer:h.faq.answer,score:h.score}));
 const {data:result,error:invokeError}=await db.functions.invoke('draft-inquiry-reply',{body:{id:item.id,revision:item.revision,sources:sources.map(s=>({id:s.id,kind:s.kind,score:s.score}))}});
 if(invokeError || !result?.text) throw new Error(result?.error || 'AI下書きを作成できませんでした。時間をおいて再度お試しください。');
 return result as {text:string;sources:Source[];model:string};
}
