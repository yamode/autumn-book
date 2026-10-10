// 貸切風呂のご予約の前のコード入力（2026-10-10）。
// 館内案内からコードなしで「貸切風呂」を開いたお客様に、先に6桁コードを入れてもらい、滞在に紐づいてから予約フォーム（/r/bath）へ進める。
// 館内図の QR（/r/c/<token>?next=bath）はトークン入りなので、ここは通らない。
import { redirect } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { claimStayFromForm } from '$lib/server/stay-claim';
import * as m from '$lib/paraglide/messages';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	if (DATA_SOURCE !== 'supabase') redirect(303, '/r');
	// 有効な滞在に紐づいていれば、そのまま予約フォームへ
	const token = cookies.get('ab_stay');
	if (token && (await sbResolveStay(token))) redirect(303, '/r/bath');
	return { headerTitle: m.bath_title(), headerBack: '/r' };
};

export const actions: Actions = {
	claim: async (event) => {
		const failed = await claimStayFromForm(event);
		if (failed) return failed;
		redirect(303, '/r/bath');
	}
};
