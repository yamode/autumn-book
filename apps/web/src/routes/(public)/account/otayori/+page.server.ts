import { listMyOtayori } from '$lib/server/store';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { getOtayoriMySummary } from '$lib/server/supabase-data';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const { locals } = event;
	// account レイアウトで member ガード済み（locals.user は member）

	if (MEMBER_SUPABASE) {
		const summary = await getOtayoriMySummary(createSupabaseServerClient(event));
		return {
			balance: summary.balance,
			ledger: summary.ledger.map((e) => ({
				id: e.id,
				delta: e.delta,
				reason: e.reason,
				createdAt: (e.created_at ?? '').slice(0, 10)
			})),
			posts: summary.posts.map((p) => ({
				id: p.id,
				body: p.body,
				radioName: p.radio_name ?? undefined,
				status: p.status,
				reviewNote: p.review_note ?? undefined,
				createdAt: (p.created_at ?? '').slice(0, 10),
				reviewedAt: p.reviewed_at ?? undefined
			}))
		};
	}

	const { balance, ledger, posts } = listMyOtayori(locals.user!.id);
	return { balance, ledger, posts };
};
