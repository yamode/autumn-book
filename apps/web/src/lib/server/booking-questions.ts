// 予約時に聞く項目（autumn-shared 20261006073112）。
//   テンプレート: book.booking_question_templates（施設ごと）。読みは公開情報なので anon、書きは RPC（施設スタッフ）。
//   プランの選択: book.plan_contents.question_mode / question_template_id / questions（スタッフ用ポリシーで更新）。
//   予約画面で聞く項目: RPC book.plan_booking_questions（プランの選択を解決して項目の配列を返す）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { DATA_SOURCE, supa } from './supabase';
import {
  answerLines,
  answersFromForm,
  mergePartnerQuestions,
  normalizeBookingQuestions,
  PLAN_QUESTION_MODES,
  resolveQuestionAnswers,
  resolveRoomGenders,
  type RoomGender,
  type BookingQuestion,
  type BookingQuestionTemplate,
  type PlanQuestionMode
} from '$lib/booking-questions';

type Row = Record<string, unknown>;
const mapTemplate = (r: Row): BookingQuestionTemplate => ({
  id: String(r.id),
  name: String(r.name ?? ''),
  questions: normalizeBookingQuestions(r.questions),
  sortOrder: Number(r.sort_order ?? 0)
});

/** 施設のテンプレート（並び順）。読めなければ空 */
export async function loadQuestionTemplates(facilityUuid: string, client?: SupabaseClient): Promise<BookingQuestionTemplate[]> {
  if (DATA_SOURCE !== 'supabase' && !client) return [];
  try {
    const db = client ? client.schema('book') : supa();
    const { data, error } = await db
      .from('booking_question_templates')
      .select('id, name, questions, sort_order')
      .eq('facility_id', facilityUuid)
      .order('sort_order')
      .order('name');
    if (error) throw error;
    return ((data ?? []) as Row[]).map(mapTemplate);
  } catch (e) {
    console.error('[booking-questions] load templates', e instanceof Error ? e.message : String(e));
    return [];
  }
}

const RPC_MESSAGES: Record<string, string> = {
  invalid_name: 'テンプレート名を60文字以内で入れてください。',
  invalid_questions: '項目は20件までです。',
  forbidden: '編集権限がありません。',
  not_found: 'テンプレートが見つかりません（ほかの画面で消された可能性があります）。'
};
export const questionTemplateErrorMessage = (e: unknown) => {
  const m = e instanceof Error ? e.message : e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  const hit = Object.keys(RPC_MESSAGES).find((k) => m.includes(k));
  return hit ? RPC_MESSAGES[hit] : m;
};

export async function saveQuestionTemplate(
  client: SupabaseClient,
  facilityUuid: string,
  t: { id?: string | null; name: string; questions: BookingQuestion[]; sortOrder: number }
): Promise<string> {
  const { data, error } = await client.schema('book').rpc('admin_save_booking_question_template', {
    p_id: t.id ?? null,
    p_facility_id: facilityUuid,
    p_name: t.name,
    p_questions: t.questions,
    p_sort_order: t.sortOrder
  });
  if (error) throw error;
  return String(data);
}

export async function deleteQuestionTemplate(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.schema('book').rpc('admin_delete_booking_question_template', { p_id: id });
  if (error) throw error;
}

/** テンプレートごとの使っているプラン（管理画面の一覧用）。テンプレート id → プラン（rate_plan_id・slug） */
export async function questionTemplateUsage(client: SupabaseClient, facilityUuid: string): Promise<Map<string, { id: string; slug: string }[]>> {
  const { data, error } = await client
    .schema('book')
    .from('plan_contents')
    .select('rate_plan_id, slug, question_template_id')
    .eq('facility_id', facilityUuid)
    .eq('question_mode', 'template');
  if (error) throw error;
  const map = new Map<string, { id: string; slug: string }[]>();
  for (const r of (data ?? []) as Row[]) {
    const t = r.question_template_id ? String(r.question_template_id) : '';
    if (!t) continue;
    map.set(t, [...(map.get(t) ?? []), { id: String(r.rate_plan_id), slug: String(r.slug ?? '') }]);
  }
  return map;
}

export type PlanQuestionSetting = { mode: PlanQuestionMode; templateId: string | null; questions: BookingQuestion[]; askGender: boolean };

/** プランの選択（管理画面）。行が無い・読めないときは「なし」 */
export async function loadPlanQuestionSetting(client: SupabaseClient, facilityUuid: string, ratePlanId: string): Promise<PlanQuestionSetting> {
  const { data, error } = await client
    .schema('book')
    .from('plan_contents')
    .select('question_mode, question_template_id, questions, ask_gender')
    .eq('facility_id', facilityUuid)
    .eq('rate_plan_id', ratePlanId)
    .maybeSingle();
  if (error) throw error;
  const r = (data ?? {}) as Row;
  const mode = (PLAN_QUESTION_MODES as readonly string[]).includes(String(r.question_mode)) ? (r.question_mode as PlanQuestionMode) : 'none';
  return {
    mode,
    templateId: r.question_template_id ? String(r.question_template_id) : null,
    questions: normalizeBookingQuestions(r.questions),
    askGender: r.ask_gender !== false
  };
}

export async function savePlanQuestionSetting(
  client: SupabaseClient,
  facilityUuid: string,
  ratePlanId: string,
  s: PlanQuestionSetting
): Promise<void> {
  const { data, error } = await client
    .schema('book')
    .from('plan_contents')
    .update({
      question_mode: s.mode,
      // テンプレートを選んでいないときも、選んでいたテンプレートは覚えておく（切り替えて戻したとき用）
      question_template_id: s.templateId,
      questions: s.questions,
      ask_gender: s.askGender,
      updated_at: new Date().toISOString()
    })
    .eq('rate_plan_id', ratePlanId)
    .eq('facility_id', facilityUuid)
    .select('rate_plan_id');
  if (error) throw error;
  if ((data ?? []).length === 0) throw new Error('対象のプランが見つからないか、編集する権限がありません。');
}

export type BookingForm = { questions: BookingQuestion[]; askGender: boolean };

/**
 * 予約画面で聞くプランの項目と、部屋ごとの男女の内訳を聞くか（RPC book.plan_booking_form・autumn-shared 20261006075659）。
 * プランは rate_plan_id（公式サイト）か rate_plans.code（取引先予約の「コード■プラン名」）で指す。
 * 読めなければ項目なし・男女は聞く（既定。予約は止めない）。db は省略時 anon。
 */
export async function planBookingForm(
  facilityUuid: string,
  plan: { ratePlanId?: string; code?: string },
  db?: SupabaseClient
): Promise<BookingForm> {
  if (DATA_SOURCE !== 'supabase' && !db) return { questions: [], askGender: true };
  try {
    const client = db ? db.schema('book') : supa();
    const { data, error } = await client.rpc('plan_booking_form', {
      p_facility: facilityUuid,
      p_rate_plan_id: plan.ratePlanId ?? null,
      p_code: plan.code ?? null
    });
    if (error) throw error;
    const r = (data ?? {}) as Row;
    return { questions: normalizeBookingQuestions(r.questions), askGender: r.ask_gender !== false };
  } catch (e) {
    console.error('[booking-questions] plan form', e instanceof Error ? e.message : String(e));
    return { questions: [], askGender: true };
  }
}

/** 取引先予約で聞く項目: プランの項目 → 取引先ごとの項目（id は p-／x- 付き）と、男女の内訳を聞くか */
export async function partnerBookingForm(
  db: SupabaseClient,
  partner: { facility_id: string; booking_settings: { options: BookingQuestion[] } },
  planCode: string,
  planName: string
): Promise<BookingForm> {
  const f = await planBookingForm(partner.facility_id, { code: `${planCode}■${planName}` }, db);
  return { questions: mergePartnerQuestions(f.questions, partner.booking_settings.options), askGender: f.askGender };
}

/**
 * 公式サイトの予約（1予約1室）: プランの項目への回答（opt_<key>）と男女の内訳（male_0 / female_0）を検証し、
 * 回答は「項目名: 回答」の行で備考（宿への申し送り＝PMS の備考）の先頭に、男女は guest.male / female に入れる
 * （DB の電文が rooms[0].male / female として PMS へ渡す）。
 * 現地払いの確定（/booking/hold ?/submit）とオンライン決済（/booking/pay prepare）で同じものを通す。
 */
export async function applyPlanAnswers<G extends { notes?: string }>(
  form: FormData,
  facilityUuid: string,
  ratePlanId: string,
  adults: number,
  guest: G
): Promise<{ ok: true; guest: G & Partial<RoomGender> } | { ok: false; message: string }> {
  const { questions, askGender } = await planBookingForm(facilityUuid, { ratePlanId });
  let out: G & Partial<RoomGender> = guest;
  if (askGender) {
    const g = resolveRoomGenders([adults], (k) => form.get(k) as string | null);
    if (!g.ok) return g;
    out = { ...out, ...g.rooms[0] };
  }
  if (!questions.length) return { ok: true, guest: out };
  const r = resolveQuestionAnswers(questions, answersFromForm(form, questions, 1), 1);
  if (!r.ok) return r;
  if (!r.values.length) return { ok: true, guest: out };
  return { ok: true, guest: { ...out, notes: [answerLines(r.values), out.notes].filter(Boolean).join('\n') } };
}
