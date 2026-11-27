// マイページのアンバサダー画面（docs/ambassador.md §8）。アンバサダーでなければマイページへ戻す。
import { redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { myAmbassador } from '$lib/server/ambassador';
import { inviteUrl } from '$lib/ambassador';
import { qrSvg } from '$lib/qr';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	if (!MEMBER_SUPABASE) redirect(303, '/account');
	const a = await myAmbassador(createSupabaseServerClient(event)).catch((e) => {
		console.error('[account/ambassador] my_ambassador', e);
		return { isAmbassador: false as const };
	});
	if (!a.isAmbassador) redirect(303, '/account');
	const url = inviteUrl(event.url.origin, a.code);
	return { ambassador: a, url, qr: qrSvg(url) };
};
