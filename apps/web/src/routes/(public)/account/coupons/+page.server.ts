// マイページ「クーポン」: 会員に配られたクーポンの一覧（2026-11-24）。使えるものはクーポンコードも出す。
// それまでこの画面にはおたよりしか入っていなかった（おたよりはポイントの側へ移した: /account/points/otayori）。
// クーポンとポイントは別物: クーポンは配られた割引券、おたよりは紹介1通ごとのポイント付与（指示）。
//
// 読み出しは book.my_coupons（本人の分だけ・コードは使えるものだけ）。コードの表（book.coupon_codes）は
// 会員が直接読めないので、この関数を通す。
import { redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { sbMyCoupons } from '$lib/server/my-coupons';
import type { MyCoupon } from '$lib/my-coupons';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const member = event.locals.user;
	if (member?.role !== 'member') redirect(303, '/auth/login?next=%2Faccount%2Fcoupons');
	event.setHeaders({ 'cache-control': 'private, no-store' });
	// デモの会員にはクーポンのデータが無い
	if (!MEMBER_SUPABASE) return { coupons: [] as MyCoupon[], unavailable: false };
	try {
		return { coupons: await sbMyCoupons(createSupabaseServerClient(event)), unavailable: false };
	} catch (e) {
		console.error('[account/coupons]', e instanceof Error ? e.message : String((e as { message?: unknown })?.message ?? e));
		return { coupons: [] as MyCoupon[], unavailable: true };
	}
};
