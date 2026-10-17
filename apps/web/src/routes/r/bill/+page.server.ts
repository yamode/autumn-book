import { redirect } from '@sveltejs/kit';
import { resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { canTestInroomPayment, inroomPaymentReady, loadStayBill } from '$lib/server/inroom-bill';
import { stripePublishableKey } from '$lib/server/stripe';
import { anyBillFlag } from '$lib/inroom-bill';
import { loadDemoPreview } from '$lib/server/inroom-settings';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { PageServerLoad } from './$types';

// 客室案内の精算案内（2026-10-17）。明細・フロント案内・オンライン決済を、管理画面の出し分けどおりに出す。
// 滞在コードが紐づいていない端末・出す設定の無い滞在はトップへ戻す
export const load: PageServerLoad = async ({ cookies, url, locals }) => {
	const token = cookies.get('ab_stay');
	if (!token) redirect(303, '/r');
	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, getLocale());
	if (!stay) redirect(303, '/r');
	// 見本の滞在は、施設ごとに DB に持つ見本の出し分け（PMS の見本の館内図と Book のプレビューで共通）
	const demo = stay.isDemo === true || DATA_SOURCE !== 'supabase' ? await loadDemoPreview(stay.facility.id) : null;
	const bill = await loadStayBill(token, stay, demo?.bill ?? null);
	if (!bill || !anyBillFlag(bill.flags)) redirect(303, '/r');

	// オンライン決済は、出す設定・本物の滞在・決済の環境（鍵・service_role）が揃ったときだけ入力欄を出す
	const canPay = bill.flags.online && !bill.isDemo && inroomPaymentReady();
	// プレビュー（見本の滞在）で管理者だけ: 本番の Stripe で ¥100 のテスト決済（2026-10-17）。お客様・本物の滞在には出ない
	const testPayment = bill.flags.online && bill.isDemo && stay.isDemo === true && inroomPaymentReady() && canTestInroomPayment(locals);
	return {
		bill,
		stripeKey: canPay || testPayment ? stripePublishableKey() : null,
		testPayment,
		// 見本の滞在をスタッフ（管理者以外）が見ているとき「管理者だけが試せます」と添える
		testPaymentStaffOnly: bill.flags.online && bill.isDemo && !testPayment && locals.user?.role === 'staff',
		paymentResult: url.searchParams.get('payment'),
		headerTitle: m.inroom_bill_title(),
		headerBack: '/r'
	};
};
