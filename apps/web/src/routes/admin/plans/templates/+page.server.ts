// 管理画面: プラン紹介文のテンプレートブロック（book.plan_text_templates）。
// テンプレートを直すと、紹介文に {{tpl:key}} を入れた全プランの表示が変わる。
// 「置き換え」は、同じ見出し・同じ本文のブロックだけを差し込み印にする（文章が違うプランは触らない）。
import { fail } from '@sveltejs/kit';
import { createSupabaseServerClient } from '$lib/server/auth';
import { LIVE, NOT_LIVE, currentFacilityOf, denyIfNotStaff, facilityUuidOf, messageOf } from '$lib/server/admin-content-page';
import { deleteTemplate, listPlanTexts, loadPlanTemplates, plansUsing, replaceBlocks, saveTemplate, templateErrorMessage } from '$lib/server/plan-templates';
import { findBlock } from '$lib/plan-templates';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const { currentFacility } = await event.parent();
  if (!LIVE) return { live: false, templates: [], usage: {}, headings: [], loadError: NOT_LIVE };
  try {
    const client = createSupabaseServerClient(event);
    const uuid = facilityUuidOf(currentFacility.id);
    const [templates, plans] = await Promise.all([loadPlanTemplates(uuid, client), listPlanTexts(client, uuid)]);
    // テンプレートごとの使われ方（差し込み印のあるプラン／まだ文章のまま同じ見出しがあるプラン）
    const usage = Object.fromEntries(
      templates.map((t) => [
        t.id,
        {
          using: plansUsing(plans, t.key).map((p) => p.name),
          literal: plans.filter((p) => findBlock(p.description, t.title)).map((p) => p.name)
        }
      ])
    );
    // 紹介文に出てくる「■-…-■」の見出しと、その見出しで一番多い本文（テンプレートの作り始めに使う）
    const titles = [...new Set(plans.flatMap((p) => [...p.description.matchAll(/^\s*(■-[^■\n]+-■)/gm)].map((m) => m[1].trim())))];
    const headings = titles.map((title) => {
      const bodies = new Map<string, number>();
      for (const p of plans) {
        const b = findBlock(p.description, title);
        if (!b) continue;
        const body = b.body.replace(/^\n+|\s+$/g, '');
        bodies.set(body, (bodies.get(body) ?? 0) + 1);
      }
      const [body, count] = [...bodies.entries()].sort((x, y) => y[1] - x[1])[0] ?? ['', 0];
      return { title, body, count, plans: [...bodies.values()].reduce((s, n) => s + n, 0), variants: bodies.size };
    });
    return { live: true, templates, usage, headings, loadError: null as string | null };
  } catch (e) {
    return { live: true, templates: [], usage: {}, headings: [], loadError: messageOf(e) };
  }
};

const str = (form: FormData, k: string) => String(form.get(k) ?? '');

export const actions: Actions = {
  save: async (event) => {
    const denied = denyIfNotStaff(event);
    if (denied) return denied;
    if (!LIVE) return fail(400, { error: NOT_LIVE });
    const form = await event.request.formData();
    const id = str(form, 'id') || undefined;
    const kind = str(form, 'kind') === 'perk' ? 'perk' : 'body';
    try {
      await saveTemplate(createSupabaseServerClient(event), currentFacilityOf(event).uuid, {
        id,
        key: str(form, 'key').trim().toLowerCase(),
        title: str(form, 'title').trim(),
        body: str(form, 'body').replace(/\r\n?/g, '\n'),
        kind,
        bannerLabel: kind === 'perk' ? str(form, 'bannerLabel').trim() || null : null,
        sortOrder: Number(str(form, 'sortOrder')) || 0
      });
    } catch (e) {
      return fail(400, { error: templateErrorMessage(e), editing: id ?? 'new' });
    }
    return { saved: true };
  },
  delete: async (event) => {
    const denied = denyIfNotStaff(event);
    if (denied) return denied;
    if (!LIVE) return fail(400, { error: NOT_LIVE });
    const form = await event.request.formData();
    try {
      await deleteTemplate(createSupabaseServerClient(event), str(form, 'id'));
    } catch (e) {
      return fail(400, { error: templateErrorMessage(e) });
    }
    return { deleted: true };
  },
  replace: async (event) => {
    const denied = denyIfNotStaff(event);
    if (denied) return denied;
    if (!LIVE) return fail(400, { error: NOT_LIVE });
    const form = await event.request.formData();
    const client = createSupabaseServerClient(event);
    const uuid = currentFacilityOf(event).uuid;
    try {
      const template = (await loadPlanTemplates(uuid, client)).find((t) => t.id === str(form, 'id'));
      if (!template) return fail(404, { error: 'テンプレートが見つかりません。' });
      const result = await replaceBlocks(client, uuid, template);
      return { replaced: { id: template.id, ...result } };
    } catch (e) {
      return fail(500, { error: templateErrorMessage(e) });
    }
  }
};
