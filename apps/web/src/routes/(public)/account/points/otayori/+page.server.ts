// マイページ「おたよりの記録」（北風放送で紹介されたおたより・投稿したおたより）。
// 2026-11-24 にクーポンの画面（/account/coupons）からポイントの配下へ移した。おたよりはクーポンではなく、
// 紹介1通ごとに通常のポイントを1,000ポイント付ける仕組みなので、記録はポイントの側に紐づく（指示）。
// メニューの「ポイント」が選ばれた状態になり、ポイントの画面の「おたより」の欄からここへ来る。
import { redirect } from '@sveltejs/kit';
import { MEMBER_SUPABASE, createSupabaseServerClient } from '$lib/server/auth';
import { getOtayoriMySummary } from '$lib/server/supabase-data';
import { listMyOtayori } from '$lib/server/store';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const member = event.locals.user;
	if (member?.role !== 'member') redirect(303, '/auth/login?next=%2Faccount%2Fpoints%2Fotayori');
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
