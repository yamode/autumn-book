// 管理画面: 予約時に聞く項目のテンプレート（施設ごと）。各プランの編集画面で、テンプレートかプラン独自かを選ぶ。
import { fail } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { LIVE, NOT_LIVE, currentFacilityOf, denyIfNotStaff, facilityUuidOf, messageOf } from '$lib/server/admin-content-page';
import { sbListPlanContentsAdmin } from '$lib/server/content-admin';
import {
  deleteQuestionTemplate,
  loadQuestionTemplates,
  questionTemplateErrorMessage,
  questionTemplateUsage,
  saveQuestionTemplate
} from '$lib/server/booking-questions';
import { normalizeBookingQuestions, validateBookingQuestions } from '$lib/booking-questions';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { currentFacility } = await event.parent();
  if (!LIVE) return { live: false, templates: [], usage: {} as Record<string, { id: string; name: string }[]>, loadError: NOT_LIVE };
  const uuid = facilityUuidOf(currentFacility.id);
  const client = createSupabaseServerClient(event);
  try {
    const [templates, usage, plans] = await Promise.all([
      loadQuestionTemplates(uuid, client),
      questionTemplateUsage(client, uuid),
      sbListPlanContentsAdmin(client, uuid).catch(() => ({ plans: [] as { id: string; name: string }[] }))
    ]);
    const nameOf = new Map(plans.plans.map((p) => [p.id, p.name]));
    // テンプレート id → 使っているプラン（名前つき。編集画面へのリンク用）
    const usageOut: Record<string, { id: string; name: string }[]> = {};
    for (const [tid, list] of usage) usageOut[tid] = list.map((p) => ({ id: p.id, name: nameOf.get(p.id) ?? p.slug }));
    return { live: true, templates, usage: usageOut, loadError: null as string | null };
  } catch (e) {
    return { live: true, templates: [], usage: {}, loadError: messageOf(e) };
  }
};

export const actions: Actions = {
  save: async (event) => {
    const denied = denyIfNotStaff(event);
    if (denied) return denied;
    if (!LIVE) return fail(400, { error: NOT_LIVE });
    const form = await event.request.formData();
    const id = String(form.get('id') ?? '').trim() || null;
    const name = String(form.get('name') ?? '').trim();
    let questions;
    try {
      questions = normalizeBookingQuestions(JSON.parse(String(form.get('questions') ?? '[]')));
    } catch {
      return fail(400, { error: '項目を読み取れませんでした。', id });
    }
    if (!name) return fail(400, { error: 'テンプレート名を入れてください。', id });
    const problem = validateBookingQuestions(questions);
    if (problem) return fail(400, { error: problem, id });
    try {
      const saved = await saveQuestionTemplate(createSupabaseServerClient(event), currentFacilityOf(event).uuid, {
        id,
        name,
        questions,
        sortOrder: Math.round(Number(form.get('sort_order') ?? 0)) || 0
      });
      return { saved: saved };
    } catch (e) {
      return fail(400, { error: questionTemplateErrorMessage(e), id });
    }
  },
  delete: async (event) => {
    const denied = denyIfNotStaff(event);
    if (denied) return denied;
    if (!LIVE) return fail(400, { error: NOT_LIVE });
    const id = String((await event.request.formData()).get('id') ?? '');
    try {
      await deleteQuestionTemplate(createSupabaseServerClient(event), id);
      return { deleted: true };
    } catch (e) {
      return fail(400, { error: questionTemplateErrorMessage(e), id });
    }
  }
};
