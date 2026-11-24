// 会員本人に配られたクーポン（book.my_coupons）。使えるものはコード付き（2026-11-24）。
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapMyCoupon, type MyCoupon } from '$lib/my-coupons';

export async function sbMyCoupons(client: SupabaseClient): Promise<MyCoupon[]> {
	const { data, error } = await client.schema('book').rpc('my_coupons');
	if (error) throw error;
	return ((Array.isArray(data) ? data : []) as Record<string, unknown>[])
		.map(mapMyCoupon)
		.filter((c): c is MyCoupon => c !== null);
}
