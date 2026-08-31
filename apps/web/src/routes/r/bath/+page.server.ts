// 貸切風呂のご予約（滞在中のお客様向け）。
//
// 入口は館内図に刷った QR（/r/c/<token>）。トークンは httpOnly Cookie（ab_stay）へ
// 交換済みなので、この画面は Cookie だけを見る。URL にトークンは出ない。
// 同じ QR をもう一度スキャンしても、ここに戻ってきて **予約済みの時間を確認できる**。
import { fail, redirect } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbBathCancel, sbBathContext, sbBathReserve } from '$lib/server/private-bath';
import type { Actions, PageServerLoad } from './$types';

const STAY_COOKIE = 'ab_stay';

export const load: PageServerLoad = async ({ cookies }) => {
	const token = cookies.get(STAY_COOKIE);
	// トークンが無い／デモ運用のときは、コード入力のある /r へ戻す。
	if (!token || DATA_SOURCE !== 'supabase') redirect(303, '/r');

	const ctx = await sbBathContext(token);
	// 失効・チェックアウト後は /r 側の「ご滞在は終了しました」に任せる（案内を1か所に寄せる）。
	if (!ctx) redirect(303, '/r');

	return { ctx };
};

export const actions: Actions = {
	reserve: async ({ request, cookies }) => {
		const token = cookies.get(STAY_COOKIE);
		if (!token) redirect(303, '/r');

		const fd = await request.formData();
		const bathId = String(fd.get('bathId') ?? '').trim() || null;
		const date = String(fd.get('date') ?? '').trim();
		const from = String(fd.get('from') ?? '').trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,2}:\d{2}$/.test(from)) {
			return fail(400, { error: 'choose' as const });
		}

		const r = await sbBathReserve(token, bathId, [{ date, from }]);
		if (!r.ok) return fail(400, { error: r.code });
		return { done: 'reserved' as const };
	},

	cancel: async ({ request, cookies }) => {
		const token = cookies.get(STAY_COOKIE);
		if (!token) redirect(303, '/r');

		const fd = await request.formData();
		const slotId = String(fd.get('slotId') ?? '').trim();
		if (!slotId) return fail(400, { error: 'other' as const });
		if (!(await sbBathCancel(token, slotId))) return fail(400, { error: 'other' as const });
		return { done: 'canceled' as const };
	}
};
