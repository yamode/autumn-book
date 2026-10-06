// 管理画面: プラン紹介の編集（book.plan_contents）。
// 保存は ADMIN_SUPABASE のときだけ。それ以外は黙って成功させず NOT_LIVE を返す（/admin/bath と同じ）。
// 決済設定・翻訳はまだデモストア（メモリ）にしか繋がっていないため、デモ環境でだけ表示する。
import { error, fail } from '@sveltejs/kit';
import { planById, facilityById, roomTypeById, upsertTranslation, translationStore } from '$lib/server/store';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbFacilityByUuid } from '$lib/server/supabase-data';
import {
	PLAN_PAYMENT_METHODS,
	sbGetPlanContentAdmin,
	sbSavePlanContent,
	sbSetPlanPayment,
	type PlanPaymentMethod
} from '$lib/server/content-admin';
import {
	LIVE,
	NOT_LIVE,
	currentFacilityOf,
	demoPlanContents,
	denyIfNotStaff,
	draftFromRequest,
	facilityUuidOf,
	messageOf,
	uploadPhotoAction
} from '$lib/server/admin-content-page';
import { loadPlanTemplates } from '$lib/server/plan-templates';
import { loadPlanQuestionSetting, loadQuestionTemplates, savePlanQuestionSetting } from '$lib/server/booking-questions';
import { normalizeBookingQuestions, PLAN_QUESTION_MODES, validateBookingQuestions, type PlanQuestionMode } from '$lib/booking-questions';
import type { Actions, PageServerLoad } from './$types';

const NOT_FOUND = 'プランが見つかりません（施設を切り替えた場合は一覧から選び直してください）';

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	if (LIVE) {
		const uuid = facilityUuidOf(currentFacility.id);
		let r;
		try {
			r = await sbGetPlanContentAdmin(createSupabaseServerClient(event), uuid, event.params.id);
		} catch (e) {
			error(500, messageOf(e));
		}
		if (!r.plan) error(404, NOT_FOUND);
		const client = createSupabaseServerClient(event);
		const [f, templates, questionTemplates, questionSetting] = await Promise.all([
			sbFacilityByUuid(uuid).catch(() => undefined),
			// 紹介文のテンプレート（エディタの挿入ボタン・プレビュー用。読めなくても編集はできる）
			loadPlanTemplates(uuid, client),
			// 予約時に聞く項目（テンプレート一覧と、このプランの選択）
			loadQuestionTemplates(uuid, client),
			loadPlanQuestionSetting(client, uuid, event.params.id).catch(() => null)
		]);
		return {
			live: true as const,
			templates,
			questionTemplates,
			questionSetting,
			content: r.plan,
			namesError: r.namesError,
			previewBase: f ? `/${f.brandSlug}/${f.slug}` : null,
			demo: null
		};
	}

	// デモ環境: 紹介は閲覧のみ（保存不可）。決済設定・翻訳は従来どおりデモストアを編集する。
	const plan = planById(event.params.id);
	if (!plan) error(404, NOT_FOUND);
	const content = demoPlanContents(plan.facilityId).find((p) => p.id === plan.id)!;
	const facility = facilityById(plan.facilityId)!;
	const trMap = translationStore.get(`plan:${plan.id}`);
	return {
		live: false as const,
		content,
		namesError: null,
		previewBase: `/${facility.brandSlug}/${facility.slug}`,
		demo: {
			plan,
			facility,
			rooms: plan.roomTypeIds.map((id) => roomTypeById(id)?.name ?? id),
			translations: {
				en: trMap?.get('en') ?? null,
				'zh-TW': trMap?.get('zh-TW') ?? null
			}
		}
	};
};

export const actions: Actions = {
	save: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) return fail(503, { error: NOT_LIVE });
		const draft = await draftFromRequest(event, 'meal');
		try {
			await sbSavePlanContent(
				createSupabaseServerClient(event),
				currentFacilityOf(event).uuid,
				event.params.id,
				draft
			);
			return { saved: true };
		} catch (e) {
			return fail(400, { error: messageOf(e) });
		}
	},
	upload: (event) => uploadPhotoAction(event, 'plans'),
	// 予約時に聞く項目: なし / テンプレート / プラン独自（book.plan_contents.question_mode）
	setQuestions: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) return fail(503, { questionError: NOT_LIVE });
		const form = await event.request.formData();
		const mode = String(form.get('mode') ?? '');
		if (!(PLAN_QUESTION_MODES as readonly string[]).includes(mode)) return fail(400, { questionError: '聞き方を選んでください。' });
		const templateId = String(form.get('template_id') ?? '').trim() || null;
		if (mode === 'template' && !templateId) return fail(400, { questionError: 'テンプレートを選んでください。' });
		let questions;
		try {
			questions = normalizeBookingQuestions(JSON.parse(String(form.get('questions') ?? '[]')));
		} catch {
			return fail(400, { questionError: '項目を読み取れませんでした。' });
		}
		const problem = mode === 'custom' ? validateBookingQuestions(questions) : null;
		if (problem) return fail(400, { questionError: problem });
		try {
			await savePlanQuestionSetting(createSupabaseServerClient(event), currentFacilityOf(event).uuid, event.params.id, {
				mode: mode as PlanQuestionMode,
				templateId,
				questions,
				askGender: form.get('ask_gender') === 'on'
			});
			return { questionSaved: true };
		} catch (e) {
			return fail(400, { questionError: messageOf(e) });
		}
	},
	// 支払方法（本番）。booking.rate_plans.payment_method を Book の管理画面で決める
	setPaymentMethod: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) return fail(503, { paymentError: NOT_LIVE });
		const form = await event.request.formData();
		const method = String(form.get('method') ?? '');
		if (!(PLAN_PAYMENT_METHODS as readonly string[]).includes(method)) {
			return fail(400, { paymentError: '支払方法を選んでください。' });
		}
		// 予約時決済の割引（%・0〜20）。現地払いのみなら 0
		const pct = method === 'onsite' ? 0 : Math.round(Number(form.get('discount') ?? 0));
		if (!Number.isFinite(pct) || pct < 0 || pct > 20) {
			return fail(400, { paymentError: '予約時決済の割引は 0〜20% で選んでください。' });
		}
		try {
			await sbSetPlanPayment(createSupabaseServerClient(event), event.params.id, method as PlanPaymentMethod, pct / 100);
			return { paymentSaved: true };
		} catch (e) {
			return fail(400, { paymentError: messageOf(e) });
		}
	},
	// 決済設定（現地払い/事前決済=即時決済/PayPay/事前割引≤20%）
	// 本実装では booking.rate_plans.metadata.prepay へ書く（rms と共有・要連携）
	savePayment: async ({ params, request, locals }) => {
		if (LIVE) return fail(503, { paymentError: '本番の支払方法は上の「支払方法」で設定してください。' });
		if (locals.user?.role !== 'admin') return fail(403, { paymentError: '編集権限がありません' });
		const plan = planById(params.id);
		if (!plan) return fail(404, {});
		const form = await request.formData();
		const onsite = form.get('onsite') === 'on';
		const prepay = form.get('prepay') === 'on';
		const methods: ('card' | 'paypay')[] = [];
		if (form.get('m_card') === 'on') methods.push('card');
		if (form.get('m_paypay') === 'on') methods.push('paypay');
		const discount = Number(form.get('discount') ?? 0) / 100;

		if (!onsite && !prepay) return fail(400, { paymentError: '支払い方法を最低1つは有効にしてください' });
		if (prepay && methods.length === 0) return fail(400, { paymentError: '事前決済を有効にする場合は決済手段（カード/PayPay）を選択してください' });
		if (discount < 0 || discount > 0.2) return fail(400, { paymentError: '事前決済割引は0〜20%の範囲で設定してください' });

		plan.payment = { onsite, prepay, prepayMethods: prepay ? methods : [], prepayDiscountRate: prepay ? discount : 0 };
		return { paymentSaved: true };
	},

	saveTranslation: async ({ params, request, locals }) => {
		if (LIVE) return fail(503, { message: '翻訳はまだ実データに繋がっていません。' });
		if (locals.user?.role !== 'admin') return fail(403, { message: '編集権限がありません' });
		const plan = planById(params.id);
		if (!plan) return fail(404, {});
		const form = await request.formData();
		const locale = String(form.get('locale')) as 'en' | 'zh-TW';
		if (!['en', 'zh-TW'].includes(locale)) return fail(400, { message: '無効なロケールです' });
		const isPublished = form.get('isPublished') === 'on';
		const fields: Record<string, unknown> = {
			headline: String(form.get('headline') ?? ''),
			description: String(form.get('description') ?? ''),
			highlightTags: String(form.get('tags') ?? '')
				.split(/[,]/)
				.map((s) => s.trim())
				.filter(Boolean)
		};
		upsertTranslation('plan', plan.id, locale, fields, isPublished);
		return { translationSaved: true };
	}
};
