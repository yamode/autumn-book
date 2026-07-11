import { error, fail } from '@sveltejs/kit';
import { bookings, facilityById, planById, roomTypeById, cancelBooking, computeCancelFee } from '$lib/server/store';
import { todayStr } from '$lib/format';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const booking = bookings.get(params.code);
	if (!booking) error(404, '予約が見つかりません');
	const isStaff = locals.user?.role === 'staff';
	return {
		booking: isStaff
			? { ...booking, guest: { ...booking.guest, phone: '***-****-****', email: '（権限がありません）' } } // staff は連絡先マスク（設計書 §4.8）
			: booking,
		canOperate: locals.user?.role === 'admin',
		facility: facilityById(booking.facilityId)!,
		plan: planById(booking.planId)!,
		room: roomTypeById(booking.roomTypeId)!,
		// スタッフ画面のキャンセル料プレビュー（グレード別ルール表準拠・実課金額と一致）
		feePreview: booking.status === 'reserved' ? (computeCancelFee(params.code, todayStr())?.fee ?? null) : null
	};
};

export const actions: Actions = {
	cancel: async ({ params, request, locals }) => {
		if (locals.user?.role !== 'admin') return fail(403, { message: '権限がありません' });
		const form = await request.formData();
		const waive = form.get('waive') === 'on';
		const reason = String(form.get('reason') ?? '').trim();
		if (!reason) return fail(400, { message: 'キャンセル理由を入力してください（監査ログに記録されます）' });
		const result = cancelBooking(params.code, { waiveFee: waive, actor: locals.user.name, reason });
		if ('error' in result) return fail(400, { message: 'この予約はキャンセルできません' });
		return { cancelled: true };
	},
	resend: async () => {
		// デモ：本実装は確定メールの再送（Resend）
		return { resent: true };
	}
};
