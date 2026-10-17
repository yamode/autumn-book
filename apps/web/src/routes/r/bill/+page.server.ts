import { redirect } from '@sveltejs/kit';
import { resolveStay } from '$lib/server/store';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { inroomPaymentReady, loadStayBill } from '$lib/server/inroom-bill';
import { stripePublishableKey } from '$lib/server/stripe';
import { anyBillFlag, parsePreviewBillFlags, PREVIEW_BILL_COOKIE } from '$lib/inroom-bill';
import { getLocale } from '$lib/paraglide/runtime';
import * as m from '$lib/paraglide/messages';
import type { PageServerLoad } from './$types';

// 客室案内の精算案内（2026-10-17）。明細・フロント案内・オンライン決済を、管理画面の出し分けどおりに出す。
// 滞在コードが紐づいていない端末・出す設定の無い滞在はトップへ戻す
export const load: PageServerLoad = async ({ cookies, url }) => {
	const token = cookies.get('ab_stay');
	if (!token) redirect(303, '/r');
	const stay = DATA_SOURCE === 'supabase' ? await sbResolveStay(token) : resolveStay(token, getLocale());
	if (!stay) redirect(303, '/r');
	// 管理画面のプレビューで選んだ出し分けは見本の滞在にだけ効く
	const bill = await loadStayBill(token, stay, parsePreviewBillFlags(cookies.get(PREVIEW_BILL_COOKIE)));
	if (!bill || !anyBillFlag(bill.flags)) redirect(303, '/r');

	// オンライン決済は、出す設定・本物の滞在・決済の環境（鍵・service_role）が揃ったときだけ入力欄を出す
	const canPay = bill.flags.online && !bill.isDemo && inroomPaymentReady();
	return {
		bill,
		stripeKey: canPay ? stripePublishableKey() : null,
		paymentResult: url.searchParams.get('payment'),
		headerTitle: m.inroom_bill_title(),
		headerBack: '/r'
	};
};
