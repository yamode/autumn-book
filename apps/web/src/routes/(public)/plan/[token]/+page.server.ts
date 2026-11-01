// プランの専用 URL（/plan/<token>・シークレットプラン）。管理画面のプラン編集で発行・コピーする。
// トークンが有効なら Cookie に覚えてプラン詳細へ移る（URL 限定のプランも、以後この端末では見られて予約できる）。
// 会員限定・グレードの条件はプラン詳細と仮押さえで判定する（ここでは URL を開いたことだけを覚える）。
//
// プランが販売中でないとき（停止中・販売開始前・期間終了・rms で直販対象外）は「リンクが無効」と出さず、理由ごとに案内する。
// スタッフ（admin / staff）は販売ページのプレビュー（?preview=1）へ移す（v0.229.0）。
import { redirect } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbFacilityByUuid } from '$lib/server/supabase-data';
import { facilityById } from '$lib/server/store';
import { planOfShareToken, rememberLinkToken, shareTokenPlanRow } from '$lib/server/secret-plans';
import { planSaleState } from '$lib/plan-sale';
import type { PageServerLoad } from './$types';

const facilityOf = (id: string) => (DATA_SOURCE === 'supabase' ? sbFacilityByUuid(id).catch(() => undefined) : Promise.resolve(facilityById(id)));

export const load: PageServerLoad = async ({ params, cookies, setHeaders, locals }) => {
	// トークン入りの URL を検索エンジン・共有キャッシュに残さない
	setHeaders({ 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
	const plan = await planOfShareToken(params.token).catch(() => undefined);
	if (plan) {
		const facility = await facilityOf(plan.facilityId);
		if (facility) {
			rememberLinkToken(cookies, params.token);
			redirect(303, `/${facility.brandSlug}/${facility.slug}/plans/${plan.slug}`);
		}
	}

	// トークンは有効だが販売中でない
	const row = plan ? undefined : await shareTokenPlanRow(params.token).catch(() => undefined);
	const facility = row ? await facilityOf(row.facilityId) : undefined;
	if (!row || !facility) return { state: 'invalid' as const };
	const role = locals.user?.role;
	if (role === 'admin' || role === 'staff') {
		rememberLinkToken(cookies, params.token);
		redirect(303, `/${facility.brandSlug}/${facility.slug}/plans/${row.slug}?preview=1`);
	}
	// 販売スイッチも期間も満たしているのに読めない＝rms で直販対象外など。お客様には「販売していません」と同じに見せる
	const sale = planSaleState(row.isPublished, row.bookingStart, row.bookingEnd);
	return {
		state: sale === 'before' ? ('before' as const) : sale === 'ended' ? ('ended' as const) : ('off' as const),
		bookingStart: row.bookingStart,
		facilityName: facility.name,
		plansHref: `/${facility.brandSlug}/${facility.slug}/plans`
	};
};
