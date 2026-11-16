import { redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { getOtayoriMySummary } from '$lib/server/supabase-data';
import { listMyOtayori } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const member = event.locals.user;
	if (member?.role !== 'member') redirect(303, '/auth/login?next=%2Faccount%2Fcoupons');
	event.setHeaders({ 'cache-control': 'private, no-store' });
	if (!MEMBER_SUPABASE) return { otayori: listMyOtayori(member.id) };
	const otayori = await getOtayoriMySummary(createSupabaseServerClient(event));
	return {
		otayori: {
			balance: otayori.balance,
			ledger: otayori.ledger.map((e) => ({
				id: e.id,
				delta: e.delta,
				reason: e.reason,
				createdAt: e.created_at,
				sourcePostId: e.source_post_id ?? undefined
			})),
			posts: otayori.posts.map((p) => ({
				id: p.id,
				body: p.body,
				radioName: p.radio_name ?? undefined,
				status: p.status,
				reviewNote: p.review_note ?? undefined,
				awardedAt: p.awarded_at ?? undefined,
				createdAt: (p.created_at ?? '').slice(0, 10)
			}))
		}
	};
};
