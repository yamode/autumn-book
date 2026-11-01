// 管理画面: プラン紹介の編集（book.plan_contents）。
// 保存は ADMIN_SUPABASE のときだけ。それ以外は黙って成功させず NOT_LIVE を返す（/admin/bath と同じ）。
// 決済設定・翻訳はまだデモストア（メモリ）にしか繋がっていないため、デモ環境でだけ表示する。
import { error, fail } from '@sveltejs/kit';
import { planById, facilityById, roomTypeById, upsertTranslation, translationStore } from '$lib/server/store';
import { createSupabaseServerClient } from '$lib/server/auth';
import { sbFacilityByUuid } from '$lib/server/supabase-data';
import {
	sbGetPlanContentAdmin,
	sbSavePlanContent,
	sbSetPlanSale,
	sbSetPlanMeals,
	sbListDinnerCourses,
	sbAutoDinnerCourse,
	sbSetPlanAccess,
	sbSetPlanLimits,
	sbSetPlanStayClosed,
	sbListRoomContentsAdmin,
	sbPlanShareToken
} from '$lib/server/content-admin';
import { PLAN_PAY_OPTIONS, normalizeOptions } from '$lib/direct-payment';
import { sbSetPlanPaymentOptions } from '$lib/server/payment-settings';
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
import { customerLinkOrigin } from '$lib/server/public-origin';
import { demoShareToken } from '$lib/server/secret-plans';
import { planLimitsFromForm, stayClosedFromForm } from '$lib/plan-limits';
import { planSaleFromForm } from '$lib/plan-sale';
import { defaultPlanMeals, planMealsFromForm, type DinnerCourseOption } from '$lib/plan-meals';
import { RANK_CODES, isRankCode, planShareLinkPath, type PlanAccess } from '$lib/plan-access';
import type { Actions, PageServerLoad } from './$types';

const NOT_FOUND = 'プランが見つかりません（施設を切り替えた場合は一覧から選び直してください）';

/** フォーム → 公開範囲（予約できる人: anyone / members / rank、一覧に出さない: link_only） */
function accessFromForm(form: FormData): PlanAccess | null {
	const who = String(form.get('who') ?? '');
	const linkOnly = form.get('link_only') === 'on';
	if (who === 'anyone') return { audience: 'public', minRank: null, linkOnly };
	if (who === 'members') return { audience: 'members', minRank: null, linkOnly };
	if (who === 'rank') {
		const rank = String(form.get('min_rank') ?? '');
		return isRankCode(rank) && rank !== 'standard' ? { audience: 'members', minRank: rank, linkOnly } : null;
	}
	return null;
}

export const load: PageServerLoad = async (event) => {
	const { currentFacility } = await event.parent();
	// 専用 URL（/plan/<token>）。お客様へ渡すリンクなので本番ドメインで組み立てる
	const shareUrlOf = (token: string | null) => (token ? customerLinkOrigin(event.url) + planShareLinkPath(token) : null);
	if (LIVE) {
		const uuid = facilityUuidOf(currentFacility.id);
		const client = createSupabaseServerClient(event);
		// プランの中身とテンプレート等は URL の id だけで引けるので同時に投げる（2026-10-18 高速化）。
		// 500 / 404 の判定は従来どおりプランの中身を先に受け取ってから行う
		const restLoad = Promise.all([
			sbFacilityByUuid(uuid).catch(() => undefined),
			// 紹介文のテンプレート（エディタの挿入ボタン・プレビュー用。読めなくても編集はできる）
			loadPlanTemplates(uuid, client),
			// 予約時に聞く項目（テンプレート一覧と、このプランの選択）
			loadQuestionTemplates(uuid, client),
			loadPlanQuestionSetting(client, uuid, event.params.id).catch(() => null)
		]);
		restLoad.catch(() => {});
		let r;
		try {
			r = await sbGetPlanContentAdmin(client, uuid, event.params.id);
		} catch (e) {
			error(500, messageOf(e));
		}
		if (!r.plan) error(404, NOT_FOUND);
		const [f, templates, questionTemplates, questionSetting] = await restLoad;
		// 専用 URL は初めて開いたときに作る（どのプランにも 1 本。作り直すまで変わらない）
		// 絞り込みの部屋タイプ候補（同一施設の pms.room_types。読めなくても他は編集できる）
		const limitRooms = await sbListRoomContentsAdmin(client, uuid)
			.then((rs) => rs.map((x) => ({ id: x.id, name: x.name, isActive: x.isActive })))
			.catch(() => []);
		const shareToken = await sbPlanShareToken(client, event.params.id).catch(() => null);
		// お食事の設定: RMS の夕食コース（選択肢）と、未設定のときの初期値（料金テンプレートから推定）
		const [dinnerCourses, autoCourse] = await Promise.all([
			sbListDinnerCourses(client, uuid).catch(() => [] as DinnerCourseOption[]),
			r.plan.meals ? Promise.resolve(null) : sbAutoDinnerCourse(client, event.params.id)
		]);
		const mealsForm = r.plan.meals ?? defaultPlanMeals(r.plan.mealPlan, autoCourse, dinnerCourses);
		return {
			live: true as const,
			dinnerCourses,
			mealsForm,
			shareUrl: shareUrlOf(shareToken),
			limitRooms,
			ranks: RANK_CODES,
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
		dinnerCourses: [] as DinnerCourseOption[],
		mealsForm: defaultPlanMeals(plan.mealPlan, null, []),
		shareUrl: shareUrlOf(demoShareToken(plan.id)),
		limitRooms: [] as { id: string; name: string; isActive: boolean }[],
		ranks: RANK_CODES,
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
	// 公開範囲（シークレットプラン）: 予約できる人（誰でも / 会員 / グレード以上）と、一覧に出さない（URL 限定）
	setAccess: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		const access = accessFromForm(await event.request.formData());
		if (!access) return fail(400, { accessError: '予約できる人を選んでください（グレードを指定する場合はシルバー以上）。' });
		if (!LIVE) {
			// デモ: メモリ上のプランに書く（公開側の見え方を確かめる用）
			const plan = planById(event.params.id);
			if (!plan) return fail(404, { accessError: NOT_FOUND });
			plan.access = access;
			return { accessSaved: true };
		}
		try {
			await sbSetPlanAccess(createSupabaseServerClient(event), event.params.id, access);
			return { accessSaved: true };
		} catch (e) {
			return fail(400, { accessError: messageOf(e) });
		}
	},
	// 販売スイッチ（販売中／停止中）と販売表示期間（予約を受け付ける期間）。公式サイトでの出し分けは DB の book.plan_on_sale
	setSale: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) return fail(503, { saleError: NOT_LIVE });
		const parsed = planSaleFromForm(await event.request.formData());
		if ('error' in parsed) return fail(400, { saleError: parsed.error });
		try {
			await sbSetPlanSale(createSupabaseServerClient(event), currentFacilityOf(event).uuid, event.params.id, parsed);
			return { saleSaved: true };
		} catch (e) {
			return fail(400, { saleError: messageOf(e) });
		}
	},
	// お食事（朝食の有無・夕食は RMS のどの食事コースか）。表示と申し送り用で、料金（rms の meal_plan）は変えない
	setMeals: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) return fail(503, { mealsError: NOT_LIVE });
		const client = createSupabaseServerClient(event);
		const uuid = currentFacilityOf(event).uuid;
		const courses = await sbListDinnerCourses(client, uuid).catch(() => [] as DinnerCourseOption[]);
		const parsed = planMealsFromForm(await event.request.formData(), courses);
		if ('error' in parsed) return fail(400, { mealsError: parsed.error });
		try {
			await sbSetPlanMeals(client, uuid, event.params.id, parsed.meals);
			return { mealsSaved: true };
		} catch (e) {
			return fail(400, { mealsError: messageOf(e) });
		}
	},
	// 絞り込み（宿泊可能期間・宿泊不可の期間と曜日・人数・部屋タイプ）。料金はテンプレート側で共有し、ここでは狭めるだけ
	setLimits: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) return fail(503, { limitsError: NOT_LIVE });
		const formData = await event.request.formData();
		const parsed = planLimitsFromForm(formData);
		if ('error' in parsed) return fail(400, { limitsError: parsed.error });
		const closed = stayClosedFromForm(formData);
		if ('error' in closed) return fail(400, { limitsError: closed.error });
		try {
			const client = createSupabaseServerClient(event);
			await sbSetPlanLimits(client, event.params.id, parsed.limits);
			await sbSetPlanStayClosed(client, event.params.id, closed.stayClosed);
			return { limitsSaved: true };
		} catch (e) {
			return fail(400, { limitsError: messageOf(e) });
		}
	},
	// 専用 URL を作り直す（古い URL・それで開いた端末の Cookie は使えなくなる）
	rotateLink: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) {
			demoShareToken(event.params.id, true);
			return { linkRotated: true };
		}
		try {
			await sbPlanShareToken(createSupabaseServerClient(event), event.params.id, true);
			return { linkRotated: true };
		} catch (e) {
			return fail(400, { accessError: messageOf(e) });
		}
	},
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
	// 支払方法（本番）。支払方法の組み合わせ（book.plan_contents.payment_options・2026-11-02）を Book の管理画面で決める
	setPaymentMethod: async (event) => {
		const denied = denyIfNotStaff(event);
		if (denied) return denied;
		if (!LIVE) return fail(503, { paymentError: NOT_LIVE });
		const form = await event.request.formData();
		const options = normalizeOptions(PLAN_PAY_OPTIONS, form.getAll('opt').map(String));
		if (options.length === 0) return fail(400, { paymentError: '支払方法を1つ以上選んでください。' });
		// 予約時決済の割引（%・0〜20）。オンライン（予約時）が無ければ 0
		const pct = options.includes('online_now') ? Math.round(Number(form.get('discount') ?? 0)) : 0;
		if (!Number.isFinite(pct) || pct < 0 || pct > 20) {
			return fail(400, { paymentError: '予約時決済の割引は 0〜20% で選んでください。' });
		}
		try {
			await sbSetPlanPaymentOptions(createSupabaseServerClient(event), event.params.id, options, pct / 100);
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
