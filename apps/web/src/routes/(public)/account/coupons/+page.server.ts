// マイページ「クーポン」: 会員に配られたクーポン（book.member_coupons）の一覧（2026-11-24）。
// それまでこの画面にはおたよりしか入っていなかった（おたよりはポイントの側へ移した: /account/points/otayori）。
// クーポンとポイントは別物: クーポンは配られた割引券、おたよりは紹介1通ごとのポイント付与（指示）。
//
// 読み出しは会員本人の権限のまま（member_coupons は本人の行だけ・coupons は有効なものだけ読める RLS）。
// クーポンコード（book.coupon_codes）は会員に読む権限が無いので、ここでは出さない。
import { redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export type MyCoupon = {
	id: string;
	status: 'issued' | 'used' | 'expired' | 'revoked';
	issuedAt: string;
	usedAt: string | null;
	name: string;
	description: string | null;
	discountType: 'percent' | 'fixed';
	discountValue: number;
	minTotal: number;
	validUntil: string | null;
	stayFrom: string | null;
	stayUntil: string | null;
};

type Row = {
	id: string;
	status: MyCoupon['status'];
	issued_at: string;
	used_at: string | null;
	coupon: {
		name: string;
		description: string | null;
		discount_type: string;
		discount_value: number;
		min_total: number | null;
		valid_until: string | null;
		stay_from: string | null;
		stay_until: string | null;
	} | null;
};

export const load: PageServerLoad = async (event) => {
	const member = event.locals.user;
	if (member?.role !== 'member') redirect(303, '/auth/login?next=%2Faccount%2Fcoupons');
	event.setHeaders({ 'cache-control': 'private, no-store' });
	// デモの会員にはクーポンのデータが無い
	if (!MEMBER_SUPABASE) return { coupons: [] as MyCoupon[], unavailable: false };

	const { data, error } = await createSupabaseServerClient(event)
		.schema('book')
		.from('member_coupons')
		.select('id, status, issued_at, used_at, coupon:coupons(name, description, discount_type, discount_value, min_total, valid_until, stay_from, stay_until)')
		.order('issued_at', { ascending: false })
		.limit(100);
	if (error) {
		console.error('[account/coupons]', error.message);
		return { coupons: [] as MyCoupon[], unavailable: true };
	}
	const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
	const coupons: MyCoupon[] = ((data ?? []) as unknown as Row[])
		// 無効にされたクーポン（coupons が読めない）は名前も出せないので並べない
		.filter((r) => r.coupon)
		.map((r) => {
			const c = r.coupon!;
			// 期限を過ぎた「使える」は期限切れとして見せる（DB の状態は配布時のまま）
			const expired = r.status === 'issued' && !!c.valid_until && c.valid_until < today;
			return {
				id: r.id,
				status: expired ? 'expired' : r.status,
				issuedAt: r.issued_at,
				usedAt: r.used_at,
				name: c.name,
				description: c.description,
				discountType: c.discount_type === 'percent' ? 'percent' : 'fixed',
				discountValue: c.discount_value,
				minTotal: c.min_total ?? 0,
				validUntil: c.valid_until,
				stayFrom: c.stay_from,
				stayUntil: c.stay_until
			};
		});
	return { coupons, unavailable: false };
};
