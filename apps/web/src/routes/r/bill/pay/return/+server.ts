import { redirect } from '@sveltejs/kit';
import { DATA_SOURCE } from '$lib/server/supabase';
import { sbResolveStay } from '$lib/server/supabase-data';
import { waitUntilOf } from '$lib/server/access-log-core';
import { paymentIdOfIntent } from "$lib/server/inroom-receipt";
import { confirmInroomIntent } from '$lib/server/inroom-bill';
import type { RequestHandler } from './$types';

// 3Dセキュア等でリダイレクトが必要な決済の戻り先（2026-10-17）。画面からの確定と同じ処理をして、精算案内へ戻す
export const GET: RequestHandler = async ({ cookies, url, platform }) => {
	let outcome = 'pending';
	let paymentId: string | null = null;
	const token = cookies.get('ab_stay');
	if (token && DATA_SOURCE === 'supabase') {
		try {
			const stay = await sbResolveStay(token);
			const r = await confirmInroomIntent(url.searchParams.get('payment_intent') ?? '', stay?.tokenId, waitUntilOf(platform));
			// test はプレビューでのテスト決済（画面で「返金は手で」と出す）
			outcome = r === 'paid' || r === 'already' ? 'paid' : r;
			if (outcome === 'paid' && stay) paymentId = await paymentIdOfIntent(stay.tokenId, url.searchParams.get('payment_intent') ?? '').catch(() => null);
		} catch {
			outcome = 'pending';
		}
	}
	redirect(303, `/r/bill?payment=${outcome}${paymentId ? `&pid=${paymentId}` : ''}`);
};
