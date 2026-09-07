// クーポン作成・編集フォームの読み取り（/new と /[id] で共用）。
// 最終的な妥当性検証は RPC 側（book.admin_upsert_coupon）が行う。ここは型の整形のみ。
import type { CouponInput } from '$lib/server/admin-app-data';

export function readCouponForm(form: FormData): Omit<CouponInput, 'id'> {
	const str = (k: string) => {
		const v = form.get(k);
		const s = typeof v === 'string' ? v.trim() : '';
		return s === '' ? null : s;
	};

	return {
		name: String(form.get('name') ?? '').trim(),
		description: str('description'),
		discountType: form.get('discountType') === 'percent' ? 'percent' : 'fixed',
		discountValue: Number(form.get('discountValue') ?? 0) || 0,
		minTotal: Number(form.get('minTotal') ?? 0) || 0,
		validFrom: String(form.get('validFrom') ?? ''),
		validUntil: String(form.get('validUntil') ?? ''),
		stayFrom: str('stayFrom'),
		stayUntil: str('stayUntil'),
		// 空文字＝全施設共通（coupons.facility_id は NULL 可）
		facilityId: str('facilityId'),
		isActive: form.get('isActive') === 'on'
	};
}
